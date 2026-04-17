// src/server.js
'use strict';

require('dotenv').config();
const express = require('express');
const { fetchConversations } = require('./supabase');
const { isProfessional } = require('./filter');
const { classifyConversations } = require('./stage-detector');
const { computeMetrics } = require('./metrics');
const { parsePrompt } = require('./prompt-parser');
const { generateReport } = require('./report-writer');
const repository = require('./repository');
const cache = require('./cache');
const { authMiddleware } = require('./auth');
const { apiError } = require('./errors');

const app = express();
app.use(express.json({ limit: '2mb' }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val) {
  return typeof val === 'string' && UUID_RE.test(val);
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function isValidISO(val) {
  return typeof val === 'string' && !isNaN(Date.parse(val));
}

// ───────────────────────────────────────────────────
// Health check — no auth required
// ───────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// ───────────────────────────────────────────────────
// Auth middleware — all routes below require token
// ───────────────────────────────────────────────────

app.use(authMiddleware);

// ───────────────────────────────────────────────────
// Utility / Cache routes
// ───────────────────────────────────────────────────

app.get('/cache', (_req, res) => res.json(cache.list()));

app.delete('/cache/:hash', (req, res) => {
  cache.del(req.params.hash);
  res.json({ deleted: req.params.hash });
});

// ───────────────────────────────────────────────────
// POST /funnel/build
// ───────────────────────────────────────────────────

app.post('/funnel/build', async (req, res) => {
  const { prompt, account_id } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'prompt must be a non-empty string', { field: 'prompt' });
  }
  if (account_id !== undefined && !isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID when provided', { field: 'account_id' });
  }

  try {
    const { stageConfig, cacheHit, hash } = await parsePrompt(prompt);

    let config_id = null;
    if (account_id) {
      try {
        const saved = await repository.saveConfig(account_id, hash, stageConfig);
        config_id = saved?.id || null;
      } catch (persistErr) {
        console.error('[repository] saveConfig failed:', persistErr.message);
      }
    }

    res.json({ stageConfig, cacheHit, hash, config_id });
  } catch (err) {
    console.error(err);
    apiError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ───────────────────────────────────────────────────
// POST /analyze
// ───────────────────────────────────────────────────

app.post('/analyze', async (req, res) => {
  const { account_id, config_id, start_date, end_date } = req.body || {};

  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }

  if (config_id !== undefined && !isValidUUID(config_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'config_id must be a valid UUID', { field: 'config_id' });
  }

  const hasStart = start_date !== undefined;
  const hasEnd = end_date !== undefined;
  if (hasStart !== hasEnd) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'start_date and end_date must both be provided or both omitted', { field: hasStart ? 'end_date' : 'start_date' });
  }
  if (hasStart && !isValidISO(start_date)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'start_date must be a valid ISO 8601 date string', { field: 'start_date' });
  }
  if (hasEnd && !isValidISO(end_date)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'end_date must be a valid ISO 8601 date string', { field: 'end_date' });
  }

  try {
    let configRecord;
    if (config_id) {
      configRecord = await repository.getConfigById(config_id);
      if (!configRecord) {
        return apiError(res, 404, 'NOT_FOUND', 'config_id não encontrado', { field: 'config_id', value: config_id });
      }
    } else {
      configRecord = await repository.getConfig(account_id);
      if (!configRecord) {
        return apiError(res, 400, 'CONFIG_NOT_FOUND', 'Nenhuma configuração de funil encontrada. Use POST /funnel/build primeiro ou forneça config_id.');
      }
    }

    const stageConfig = configRecord.stage_config;
    const dateRange = hasStart ? { startDate: start_date, endDate: end_date } : undefined;

    const { chats, messagesByChat, totalMessages } = await fetchConversations(account_id, dateRange);

    const professionalChatMap = {};
    let personalCount = 0;
    for (const [chatId, msgs] of Object.entries(messagesByChat)) {
      if (isProfessional(msgs, stageConfig)) professionalChatMap[chatId] = msgs;
      else personalCount++;
    }

    const classified = classifyConversations(professionalChatMap, stageConfig);
    const metrics = computeMetrics(classified);
    const report_md = await generateReport(metrics, account_id);

    const meta = {
      account_id,
      analyzed_at:    new Date().toISOString(),
      total_chats:    chats.length,
      professional:   classified.length,
      personal:       personalCount,
      total_messages: totalMessages,
      period:         hasStart ? { start: start_date, end: end_date } : null
    };

    const warnings = [];
    let run_id = null;
    try {
      run_id = await repository.saveRun({
        accountId:    account_id,
        configId:     configRecord.id,
        analysisType: 'funnel',
        meta,
        metrics,
        classified,
        reportMd:     report_md
      });
    } catch (persistErr) {
      console.error('[repository] saveRun failed:', persistErr.message);
      warnings.push(`persist_failed: ${persistErr.message}`);
    }

    const response = {
      meta,
      funnel:       metrics,
      stage_config: stageConfig,
      report_md,
      run_id
    };
    if (warnings.length > 0) response.warnings = warnings;

    res.json(response);
  } catch (err) {
    console.error(err);
    apiError(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ───────────────────────────────────────────────────
// GET /configs/:account_id
// ───────────────────────────────────────────────────

app.get('/configs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }
  try {
    const config = await repository.getConfig(account_id);
    if (!config) return apiError(res, 404, 'NOT_FOUND', 'config not found for this account_id');
    res.json(config);
  } catch (err) {
    console.error(err);
    apiError(res, 503, 'DATABASE_ERROR', 'database unavailable', { detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// PUT /configs/:account_id
// ───────────────────────────────────────────────────

app.put('/configs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  const { stage_config, prompt_hash = 'manual' } = req.body || {};

  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }
  if (!isPlainObject(stage_config) || !Array.isArray(stage_config.stages)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'stage_config must be an object with a stages array', { field: 'stage_config' });
  }

  try {
    const saved = await repository.saveConfig(account_id, prompt_hash, stage_config);
    res.json(saved);
  } catch (err) {
    console.error(err);
    apiError(res, 503, 'DATABASE_ERROR', 'database unavailable', { detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// GET /runs/:account_id
// ───────────────────────────────────────────────────

app.get('/runs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }
  const { from, to, limit, type: analysisType } = req.query;

  if (from && !isValidISO(from)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'from must be a valid ISO 8601 date string', { field: 'from' });
  }
  if (to && !isValidISO(to)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'to must be a valid ISO 8601 date string', { field: 'to' });
  }
  if (limit !== undefined && (isNaN(parseInt(limit, 10)) || parseInt(limit, 10) <= 0)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'limit must be a positive number', { field: 'limit' });
  }

  try {
    const runs = await repository.getRuns(account_id, {
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 50,
      analysisType
    });
    res.json(runs);
  } catch (err) {
    console.error(err);
    apiError(res, 503, 'DATABASE_ERROR', 'database unavailable', { detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// GET /runs/:account_id/:run_id
// ───────────────────────────────────────────────────

app.get('/runs/:account_id/:run_id', async (req, res) => {
  const { account_id, run_id } = req.params;
  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }
  if (!isValidUUID(run_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'run_id must be a valid UUID', { field: 'run_id' });
  }
  try {
    const detail = await repository.getRunDetail(run_id);
    if (!detail) return apiError(res, 404, 'NOT_FOUND', 'run not found');
    res.json(detail);
  } catch (err) {
    console.error(err);
    apiError(res, 503, 'DATABASE_ERROR', 'database unavailable', { detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`funnel-analyzer listening on http://localhost:${PORT}`));
}

module.exports = app;
