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
const cache = require('./cache');

const app = express();
app.use(express.json({ limit: '2mb' }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// Call once per prompt; save the returned stageConfig and
// pass it directly to POST /analyze for repeated runs.
// ───────────────────────────────────────────────────

app.post('/funnel/build', async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt must be a non-empty string' });
  }

  try {
    const { stageConfig, cacheHit, hash } = await parsePrompt(prompt);
    res.json({ stageConfig, cacheHit, hash });
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
// ───────────────────────────────────────────────────

app.post('/analyze', async (req, res) => {
  const { account_id, stageConfig } = req.body || {};

  if (!account_id || !UUID_RE.test(account_id)) {
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

    res.json({
      meta: {
        account_id,
        analyzed_at: new Date().toISOString(),
        total_chats: chats.length,
        professional: classified.length,
        personal: personalCount,
        total_messages: totalMessages
      },
      funnel: metrics,
      stage_config: stageConfig,
      report_md
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`funnel-analyzer listening on http://localhost:${PORT}`));
}

module.exports = app;
