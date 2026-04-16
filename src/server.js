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

const app = express();
app.use(express.json({ limit: '2mb' }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val) {
  return typeof val === 'string' && UUID_RE.test(val);
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

// ───────────────────────────────────────────────────
// Utility / Cache routes
// ───────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/cache', (_req, res) => res.json(cache.list()));

app.delete('/cache/:hash', (req, res) => {
  cache.del(req.params.hash);
  res.json({ deleted: req.params.hash });
});

// ───────────────────────────────────────────────────
// POST /funnel/build
// Parses an AI assistant prompt and returns a stageConfig.
// Optional: pass account_id to persist the config to Supabase.
// Call once per prompt; save the returned stageConfig and
// pass it directly to POST /analyze for repeated runs.
// ───────────────────────────────────────────────────

app.post('/funnel/build', async (req, res) => {
  const { prompt, account_id } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt must be a non-empty string' });
  }
  if (account_id !== undefined && !isValidUUID(account_id)) {
    return res.status(400).json({ error: 'account_id must be a valid UUID when provided' });
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
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────
// POST /analyze
// Analyzes conversations for a given account using a
// pre-built stageConfig from /funnel/build.
// Does NOT call the LLM — stageConfig must be provided by the caller.
// Returns same response as before + run_id (if persisted) + warnings.
// ───────────────────────────────────────────────────

app.post('/analyze', async (req, res) => {
  const { account_id, stageConfig } = req.body || {};

  if (!isValidUUID(account_id)) {
    return res.status(400).json({ error: 'account_id must be a valid UUID' });
  }
  if (!isPlainObject(stageConfig)) {
    return res.status(400).json({ error: 'stageConfig must be a plain object (use /funnel/build to generate one)' });
  }

  try {
    const { chats, messagesByChat, totalMessages } = await fetchConversations(account_id);

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
      total_messages: totalMessages
    };

    // Persist — falha silenciosa, nunca bloqueia a response
    const warnings = [];
    let run_id = null;
    try {
      run_id = await repository.saveRun({
        accountId:    account_id,
        configId:     null,
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
    res.status(500).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────
// GET /configs/:account_id
// Returns the saved stageConfig for a client account.
// ───────────────────────────────────────────────────

app.get('/configs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  if (!isValidUUID(account_id)) {
    return res.status(400).json({ error: 'account_id must be a valid UUID' });
  }
  try {
    const config = await repository.getConfig(account_id);
    if (!config) return res.status(404).json({ error: 'config not found for this account_id' });
    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: 'database unavailable', detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// PUT /configs/:account_id
// Upserts a stageConfig for a client account.
// Body: { stage_config, prompt_hash? }
// ───────────────────────────────────────────────────

app.put('/configs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  const { stage_config, prompt_hash = 'manual' } = req.body || {};

  if (!isValidUUID(account_id)) {
    return res.status(400).json({ error: 'account_id must be a valid UUID' });
  }
  if (!isPlainObject(stage_config) || !Array.isArray(stage_config.stages)) {
    return res.status(400).json({ error: 'stage_config must be an object with a stages array' });
  }

  try {
    const saved = await repository.saveConfig(account_id, prompt_hash, stage_config);
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: 'database unavailable', detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// GET /runs/:account_id
// Lists analysis runs for a client.
// Query params: from (ISO date), to (ISO date), limit (number), type (string)
// ───────────────────────────────────────────────────

app.get('/runs/:account_id', async (req, res) => {
  const { account_id } = req.params;
  if (!isValidUUID(account_id)) {
    return res.status(400).json({ error: 'account_id must be a valid UUID' });
  }
  const { from, to, limit, type: analysisType } = req.query;
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
    res.status(503).json({ error: 'database unavailable', detail: err.message });
  }
});

// ───────────────────────────────────────────────────
// GET /runs/:account_id/:run_id
// Returns full detail of a single analysis run
// (includes conversations and events).
// ───────────────────────────────────────────────────

app.get('/runs/:account_id/:run_id', async (req, res) => {
  const { account_id, run_id } = req.params;
  if (!isValidUUID(account_id) || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'account_id and run_id must be valid UUIDs' });
  }
  try {
    const detail = await repository.getRunDetail(run_id);
    if (!detail) return res.status(404).json({ error: 'run not found' });
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: 'database unavailable', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`funnel-analyzer listening on http://localhost:${PORT}`));
}

module.exports = app;
