# Supabase Persistence & Funnel Config Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar camada de persistência no Supabase para salvar análises e stageConfigs, sem alterar a lógica de análise existente.

**Architecture:** Novo módulo `repository.js` centraliza toda a escrita no banco via REST API do Supabase. O `server.js` chama o repository após cada análise. Falhas de persistência nunca bloqueiam a resposta da análise — retornam `warnings` no JSON.

**Tech Stack:** Node.js, Express, Supabase REST API (fetch nativo), Jest, supertest.

---

## Mapeamento de Arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/repository.js` | **Criar** | Toda a persistência: saveConfig, saveRun, getRuns, getRunDetail, getConfig |
| `src/supabase.js` | **Modificar** | Extrair `supabaseRequest()` helper reutilizável |
| `src/server.js` | **Modificar** | Integrar repository nos endpoints existentes + 4 novos endpoints |
| `tests/repository.test.js` | **Criar** | Testes unitários do repository com mocks de fetch |
| `tests/server.test.js` | **Modificar** | Adicionar mock do repository + testes dos novos endpoints |

---

## Task 1: Extrair helper `supabaseRequest` do `supabase.js`

**Contexto:** `supabase.js` tem a função `fetchJSON` que faz chamadas autenticadas ao Supabase. O `repository.js` vai precisar da mesma lógica para POST/PATCH. Extrai o helper para ser compartilhado, mantendo compatibilidade total.

**Files:**
- Modify: `src/supabase.js`

- [ ] **Step 1: Adicionar `supabaseRequest` e exportar junto com `fetchConversations`**

  Substitua o conteúdo completo de `src/supabase.js` por:

  ```js
  // src/supabase.js
  'use strict';

  const BATCH_SIZE = 100;

  /**
   * Generic Supabase REST request helper.
   * method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
   * path: e.g. '/rest/v1/funnel_configs'
   * query: e.g. '?account_id=eq.<uuid>'
   * body: JS object (serialized to JSON for non-GET)
   * extraHeaders: additional headers (e.g. Prefer: resolution=merge-duplicates)
   */
  async function supabaseRequest({ method = 'GET', path, query = '', body, extraHeaders = {} }) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    const fullUrl = `${url}${path}${query}`;

    const headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    };

    const options = { method, headers };
    if (body !== undefined) options.body = JSON.stringify(body);

    const res = await fetch(fullUrl, options);
    if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);

    // 204 No Content → return empty object
    if (res.status === 204) return {};
    return res.json();
  }

  async function fetchAllChats(accountId) {
    return supabaseRequest({
      path: '/rest/v1/wa_chats',
      query: `?account_id=eq.${accountId}&select=id,chat_type,contact_id,created_at,last_message_at&order=last_message_at.desc&limit=2000`
    });
  }

  async function fetchMessagesForChats(chatIds) {
    const allMessages = [];
    for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
      const batch = chatIds.slice(i, i + BATCH_SIZE);
      const filter = batch.join(',');
      const msgs = await supabaseRequest({
        path: '/rest/v1/wa_messages',
        query: `?chat_id=in.(${filter})&select=id,chat_id,direction,sent_by,content_text,created_at,message_type&order=created_at.asc&limit=10000`
      });
      allMessages.push(...msgs);
    }
    return allMessages;
  }

  function groupMessagesByChat(messages) {
    const map = {};
    for (const m of messages) {
      if (!map[m.chat_id]) map[m.chat_id] = [];
      map[m.chat_id].push(m);
    }
    return map;
  }

  async function fetchConversations(accountId) {
    const chats = await fetchAllChats(accountId);
    const chatIds = chats.map(c => c.id);
    const messages = await fetchMessagesForChats(chatIds);
    const messagesByChat = groupMessagesByChat(messages);
    return { chats, messagesByChat, totalMessages: messages.length };
  }

  module.exports = { fetchConversations, supabaseRequest };
  ```

- [ ] **Step 2: Rodar testes existentes para confirmar nenhuma regressão**

  ```
  npm test -- --testPathPattern=server
  ```

  Esperado: todos os testes do `server.test.js` passando (o mock de supabase não muda de contrato).

- [ ] **Step 3: Commit**

  ```
  git add src/supabase.js
  git commit -m "refactor: extract supabaseRequest helper from supabase.js"
  ```

---

## Task 2: Criar `src/repository.js` com as funções de persistência

**Contexto:** O `repository.js` é o único módulo que escreve nas novas tabelas do Supabase. Usa `supabaseRequest` do `supabase.js`. Segue o mesmo padrão de REST API já estabelecido no projeto.

**As 4 tabelas:**
- `funnel_configs` — stageConfig por account_id (upsert via `account_id`)
- `analysis_runs` — resultado agregado de cada execução
- `analysis_conversations` — uma linha por conversa analisada
- `analysis_events` — um evento por stage detectada numa conversa

**Files:**
- Create: `src/repository.js`

- [ ] **Step 1: Criar `src/repository.js`**

  ```js
  // src/repository.js
  'use strict';

  const { supabaseRequest } = require('./supabase');

  /**
   * Salva ou atualiza o stageConfig de um cliente.
   * Faz upsert por account_id (única config por cliente).
   * Retorna o registro salvo (com id).
   */
  async function saveConfig(accountId, promptHash, stageConfig) {
    const rows = await supabaseRequest({
      method: 'POST',
      path: '/rest/v1/funnel_configs',
      query: '?on_conflict=account_id&select=id,account_id,updated_at',
      body: {
        account_id: accountId,
        prompt_hash: promptHash,
        stage_config: stageConfig,
        updated_at: new Date().toISOString()
      },
      extraHeaders: {
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /**
   * Busca o stageConfig salvo para um cliente.
   * Retorna null se não encontrado.
   */
  async function getConfig(accountId) {
    const rows = await supabaseRequest({
      path: '/rest/v1/funnel_configs',
      query: `?account_id=eq.${accountId}&select=id,account_id,prompt_hash,stage_config,created_at,updated_at&limit=1`
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  /**
   * Persiste uma execução completa de análise.
   * Insere analysis_runs, depois analysis_conversations em batch,
   * depois analysis_events em batch.
   * Retorna o run_id gerado.
   *
   * runData: {
   *   accountId: string,
   *   configId: string | null,
   *   analysisType: string,  // 'funnel' por padrão
   *   meta: { total_chats, professional, personal, total_messages },
   *   metrics: { tracks, stages, conversion, top_sequences, anomalies },
   *   classified: Array<{ chatId, msgCount, inboundCount, track, furthest,
   *                         stages, outboundIA, outboundHuman, events }>,
   *   reportMd: string
   * }
   */
  async function saveRun(runData) {
    const {
      accountId, configId, analysisType = 'funnel',
      meta, metrics, classified, reportMd
    } = runData;

    // 1. Inserir o run agregado
    const runRows = await supabaseRequest({
      method: 'POST',
      path: '/rest/v1/analysis_runs',
      query: '?select=id',
      body: {
        account_id:        accountId,
        funnel_config_id:  configId || null,
        analysis_type:     analysisType,
        total_chats:       meta.total_chats,
        professional_count: meta.professional,
        personal_count:    meta.personal,
        total_messages:    meta.total_messages,
        tracks:            metrics.tracks,
        stages_summary:    metrics.stages,
        conversion:        metrics.conversion,
        top_sequences:     metrics.top_sequences,
        anomalies:         metrics.anomalies,
        report_md:         reportMd,
        analyzed_at:       new Date().toISOString()
      },
      extraHeaders: { 'Prefer': 'return=representation' }
    });
    const runId = Array.isArray(runRows) ? runRows[0].id : runRows.id;

    // 2. Inserir conversas em batch
    if (classified && classified.length > 0) {
      const convRows = classified.map(c => ({
        run_id:         runId,
        chat_id:        c.chatId,
        msg_count:      c.msgCount,
        inbound_count:  c.inboundCount,
        track:          c.track,
        furthest_stage: c.furthest,
        stages:         c.stages || [],
        outbound_ia:    c.outboundIA,
        outbound_human: c.outboundHuman
      }));

      const savedConvs = await supabaseRequest({
        method: 'POST',
        path: '/rest/v1/analysis_conversations',
        query: '?select=id,chat_id',
        body: convRows,
        extraHeaders: { 'Prefer': 'return=representation' }
      });

      // 3. Inserir eventos em batch (monta mapa chatId → conv.id)
      const chatToConvId = {};
      for (const conv of (Array.isArray(savedConvs) ? savedConvs : [])) {
        chatToConvId[conv.chat_id] = conv.id;
      }

      const eventRows = [];
      for (const c of classified) {
        const convId = chatToConvId[c.chatId];
        if (!convId) continue;
        for (const ev of (c.events || [])) {
          eventRows.push({
            conversation_id:  convId,
            stage:            ev.stage,
            sender:           ev.sender,
            event_timestamp:  ev.timestamp,
            preview:          ev.preview
          });
        }
      }

      if (eventRows.length > 0) {
        await supabaseRequest({
          method: 'POST',
          path: '/rest/v1/analysis_events',
          body: eventRows,
          extraHeaders: { 'Prefer': 'return=minimal' }
        });
      }
    }

    return runId;
  }

  /**
   * Lista execuções de análise de um cliente, da mais recente para a mais antiga.
   * filters: { from?: ISO string, to?: ISO string, limit?: number, analysisType?: string }
   */
  async function getRuns(accountId, filters = {}) {
    const { from, to, limit = 50, analysisType } = filters;
    let query = `?account_id=eq.${accountId}`;
    query += '&select=id,account_id,analysis_type,total_chats,professional_count,personal_count,total_messages,analyzed_at';
    if (from)         query += `&analyzed_at=gte.${from}`;
    if (to)           query += `&analyzed_at=lte.${to}`;
    if (analysisType) query += `&analysis_type=eq.${analysisType}`;
    query += `&order=analyzed_at.desc&limit=${limit}`;

    return supabaseRequest({ path: '/rest/v1/analysis_runs', query });
  }

  /**
   * Retorna o detalhe completo de uma execução, incluindo conversas e eventos.
   */
  async function getRunDetail(runId) {
    const runs = await supabaseRequest({
      path: '/rest/v1/analysis_runs',
      query: `?id=eq.${runId}&select=*&limit=1`
    });
    if (!Array.isArray(runs) || runs.length === 0) return null;
    const run = runs[0];

    // busca conversas com seus eventos aninhados via select embedding
    const conversations = await supabaseRequest({
      path: '/rest/v1/analysis_conversations',
      query: `?run_id=eq.${runId}&select=*,analysis_events(*)&order=furthest_stage.asc`
    });

    return { ...run, conversations: Array.isArray(conversations) ? conversations : [] };
  }

  module.exports = { saveConfig, getConfig, saveRun, getRuns, getRunDetail };
  ```

- [ ] **Step 2: Commit**

  ```
  git add src/repository.js
  git commit -m "feat: add repository.js with Supabase persistence layer"
  ```

---

## Task 3: Testes unitários do `repository.js`

**Contexto:** O repository usa `supabaseRequest` que faz calls HTTP. Nos testes, mockamos o módulo inteiro de `supabase.js` para interceptar as chamadas. Cada função é testada isoladamente.

**Files:**
- Create: `tests/repository.test.js`

- [ ] **Step 1: Criar `tests/repository.test.js`**

  ```js
  // tests/repository.test.js
  'use strict';

  // Mock supabaseRequest antes de importar repository
  const mockSupabaseRequest = jest.fn();
  jest.mock('../src/supabase', () => ({
    fetchConversations: jest.fn(),
    supabaseRequest: (...args) => mockSupabaseRequest(...args)
  }));

  const repository = require('../src/repository');

  const ACCOUNT_ID = '123e4567-e89b-12d3-a456-426614174000';
  const CONFIG_ID  = '223e4567-e89b-12d3-a456-426614174001';
  const RUN_ID     = '323e4567-e89b-12d3-a456-426614174002';
  const CONV_ID    = '423e4567-e89b-12d3-a456-426614174003';

  const STAGE_CONFIG = {
    stages: [
      { code: 'SAUDACAO', keywords: ['oi'], indicates_professional: false },
      { code: 'QUEIXA',   keywords: ['papada'], indicates_professional: true }
    ]
  };

  beforeEach(() => mockSupabaseRequest.mockReset());

  // ─────────────────────────────────────────────
  // saveConfig
  // ─────────────────────────────────────────────
  describe('saveConfig', () => {
    it('faz upsert e retorna o registro salvo', async () => {
      mockSupabaseRequest.mockResolvedValue([{ id: CONFIG_ID, account_id: ACCOUNT_ID, updated_at: '2026-01-01T00:00:00Z' }]);

      const result = await repository.saveConfig(ACCOUNT_ID, 'abc123', STAGE_CONFIG);

      expect(mockSupabaseRequest).toHaveBeenCalledTimes(1);
      const call = mockSupabaseRequest.mock.calls[0][0];
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/rest/v1/funnel_configs');
      expect(call.body.account_id).toBe(ACCOUNT_ID);
      expect(call.body.prompt_hash).toBe('abc123');
      expect(call.body.stage_config).toEqual(STAGE_CONFIG);
      expect(call.extraHeaders['Prefer']).toContain('merge-duplicates');
      expect(result.id).toBe(CONFIG_ID);
    });
  });

  // ─────────────────────────────────────────────
  // getConfig
  // ─────────────────────────────────────────────
  describe('getConfig', () => {
    it('retorna o config quando encontrado', async () => {
      mockSupabaseRequest.mockResolvedValue([{ id: CONFIG_ID, account_id: ACCOUNT_ID, stage_config: STAGE_CONFIG }]);

      const result = await repository.getConfig(ACCOUNT_ID);

      expect(result.id).toBe(CONFIG_ID);
      expect(result.stage_config).toEqual(STAGE_CONFIG);
    });

    it('retorna null quando não encontrado', async () => {
      mockSupabaseRequest.mockResolvedValue([]);
      const result = await repository.getConfig(ACCOUNT_ID);
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // saveRun
  // ─────────────────────────────────────────────
  describe('saveRun', () => {
    const baseRunData = {
      accountId:    ACCOUNT_ID,
      configId:     CONFIG_ID,
      analysisType: 'funnel',
      meta:         { total_chats: 5, professional: 3, personal: 2, total_messages: 100 },
      metrics:      { tracks: {}, stages: [], conversion: [], top_sequences: [], anomalies: { out_of_order_count: 0 } },
      classified:   [],
      reportMd:     '# Report'
    };

    it('insere o run e retorna o run_id quando classified está vazio', async () => {
      mockSupabaseRequest.mockResolvedValue([{ id: RUN_ID }]);

      const runId = await repository.saveRun(baseRunData);

      expect(runId).toBe(RUN_ID);
      expect(mockSupabaseRequest).toHaveBeenCalledTimes(1);
      const call = mockSupabaseRequest.mock.calls[0][0];
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/rest/v1/analysis_runs');
      expect(call.body.account_id).toBe(ACCOUNT_ID);
      expect(call.body.total_chats).toBe(5);
      expect(call.body.professional_count).toBe(3);
    });

    it('insere conversas e eventos quando classified tem dados', async () => {
      const classified = [{
        chatId:       'chat-1',
        msgCount:     10,
        inboundCount: 5,
        track:        'pure_ia',
        furthest:     'QUEIXA',
        stages:       ['SAUDACAO', 'QUEIXA'],
        outboundIA:   5,
        outboundHuman: 0,
        events: [
          { stage: 'SAUDACAO', sender: 'IA',    timestamp: '2026-01-01T10:00', preview: 'Olá!' },
          { stage: 'QUEIXA',   sender: 'PATIENT', timestamp: '2026-01-01T10:01', preview: 'Papada' }
        ]
      }];

      // 3 calls: insert run, insert convs, insert events
      mockSupabaseRequest
        .mockResolvedValueOnce([{ id: RUN_ID }])             // analysis_runs insert
        .mockResolvedValueOnce([{ id: CONV_ID, chat_id: 'chat-1' }]) // analysis_conversations insert
        .mockResolvedValueOnce({});                           // analysis_events insert

      const runId = await repository.saveRun({ ...baseRunData, classified });

      expect(runId).toBe(RUN_ID);
      expect(mockSupabaseRequest).toHaveBeenCalledTimes(3);

      // Verifica insert de events
      const eventsCall = mockSupabaseRequest.mock.calls[2][0];
      expect(eventsCall.path).toBe('/rest/v1/analysis_events');
      expect(eventsCall.body).toHaveLength(2);
      expect(eventsCall.body[0].stage).toBe('SAUDACAO');
      expect(eventsCall.body[0].conversation_id).toBe(CONV_ID);
    });
  });

  // ─────────────────────────────────────────────
  // getRuns
  // ─────────────────────────────────────────────
  describe('getRuns', () => {
    it('retorna lista de runs com filtros de data', async () => {
      const mockRuns = [{ id: RUN_ID, analyzed_at: '2026-04-16T00:00:00Z' }];
      mockSupabaseRequest.mockResolvedValue(mockRuns);

      const result = await repository.getRuns(ACCOUNT_ID, { from: '2026-04-01', limit: 10 });

      expect(result).toEqual(mockRuns);
      const call = mockSupabaseRequest.mock.calls[0][0];
      expect(call.query).toContain(`account_id=eq.${ACCOUNT_ID}`);
      expect(call.query).toContain('analyzed_at=gte.2026-04-01');
      expect(call.query).toContain('limit=10');
    });
  });

  // ─────────────────────────────────────────────
  // getRunDetail
  // ─────────────────────────────────────────────
  describe('getRunDetail', () => {
    it('retorna null quando run não encontrado', async () => {
      mockSupabaseRequest.mockResolvedValue([]);
      const result = await repository.getRunDetail(RUN_ID);
      expect(result).toBeNull();
    });

    it('retorna run com conversas quando encontrado', async () => {
      const mockRun = { id: RUN_ID, account_id: ACCOUNT_ID, total_chats: 5 };
      const mockConvs = [{ id: CONV_ID, chat_id: 'chat-1', analysis_events: [] }];

      mockSupabaseRequest
        .mockResolvedValueOnce([mockRun])
        .mockResolvedValueOnce(mockConvs);

      const result = await repository.getRunDetail(RUN_ID);

      expect(result.id).toBe(RUN_ID);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(CONV_ID);
    });
  });
  ```

- [ ] **Step 2: Rodar os testes para confirmar que passam**

  ```
  npm test -- --testPathPattern=repository
  ```

  Esperado: todos os 8 testes passando.

- [ ] **Step 3: Commit**

  ```
  git add tests/repository.test.js
  git commit -m "test: add repository.js unit tests with supabaseRequest mocks"
  ```

---

## Task 4: Integrar repository no `server.js` + novos endpoints

**Contexto:** Três mudanças no `server.js`:
1. Após `/funnel/build` parsear o prompt: se `account_id` for passado, salva o config (falha silenciosa)
2. Após `/analyze` terminar: salva a run (falha silenciosa, adiciona `warnings`)
3. Quatro novos endpoints: `GET /configs/:id`, `PUT /configs/:id`, `GET /runs/:id`, `GET /runs/:id/:run_id`

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Substituir `src/server.js` pelo conteúdo atualizado**

  ```js
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
  // Analyzes conversations for a given account.
  // Returns the same response as before + run_id (if persisted) + warnings.
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
        analyzed_at: new Date().toISOString(),
        total_chats: chats.length,
        professional: classified.length,
        personal: personalCount,
        total_messages: totalMessages
      };

      // Persist — falha silenciosa, nunca bloqueia a response
      const warnings = [];
      let run_id = null;
      try {
        run_id = await repository.saveRun({
          accountId:    account_id,
          configId:     null, // caller pode passar config_id no corpo no futuro
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
  // Upserts a stageConfig for a client. Body: { stage_config, prompt_hash? }
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
  // Lists analysis runs for a client. Query: from, to, limit, type
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
  // Returns full detail of a single analysis run (+ conversations + events)
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
  ```

- [ ] **Step 2: Commit**

  ```
  git add src/server.js
  git commit -m "feat: integrate repository into server.js and add config/runs endpoints"
  ```

---

## Task 5: Atualizar `tests/server.test.js` para cobrir novos endpoints e comportamento de persistência

**Contexto:** O `server.js` agora importa `repository`. Precisamos mockar o repository nos testes existentes (para que os testes atuais não quebrem) e adicionar novos testes para os 4 novos endpoints e o comportamento de falha silenciosa.

**Files:**
- Modify: `tests/server.test.js`

- [ ] **Step 1: Substituir `tests/server.test.js` pelo conteúdo atualizado**

  ```js
  // tests/server.test.js
  'use strict';

  const request = require('supertest');

  const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
  const RUN_ID     = '323e4567-e89b-12d3-a456-426614174002';
  const CONFIG_ID  = '223e4567-e89b-12d3-a456-426614174001';

  // All jest.mock() calls MUST be at top-level — Jest hoists these before imports
  jest.mock('../src/prompt-parser', () => ({
    parsePrompt: jest.fn().mockResolvedValue({
      stageConfig: {
        stages: [
          { code: 'SAUDACAO',    keywords: ['oi', 'olá'],         indicates_professional: false },
          { code: 'QUEIXA',      keywords: ['papada', 'flacidez'], indicates_professional: true  },
          { code: 'INVESTIMENTO',keywords: ['R\\$\\s*[\\d.,]+'],  indicates_professional: true  }
        ]
      },
      cacheHit: false,
      hash: 'abc123'
    })
  }));

  jest.mock('../src/supabase', () => ({
    fetchConversations: jest.fn().mockResolvedValue({
      chats: [{ id: 'chat-1' }],
      messagesByChat: {},
      totalMessages: 0
    }),
    supabaseRequest: jest.fn()
  }));

  jest.mock('../src/report-writer', () => ({
    generateReport: jest.fn().mockResolvedValue('# Mock Report')
  }));

  // Mock repository — por padrão saveRun e saveConfig funcionam normalmente
  const mockRepository = {
    saveConfig:    jest.fn().mockResolvedValue({ id: CONFIG_ID }),
    getConfig:     jest.fn().mockResolvedValue(null),
    saveRun:       jest.fn().mockResolvedValue(RUN_ID),
    getRuns:       jest.fn().mockResolvedValue([]),
    getRunDetail:  jest.fn().mockResolvedValue(null)
  };
  jest.mock('../src/repository', () => mockRepository);

  const app = require('../src/server');

  const VALID_STAGE_CONFIG = {
    stages: [
      { code: 'SAUDACAO',    keywords: ['oi', 'olá'],         indicates_professional: false },
      { code: 'QUEIXA',      keywords: ['papada', 'rugas'],   indicates_professional: true  },
      { code: 'INVESTIMENTO',keywords: ['R\\$\\s*[\\d.,]+'],  indicates_professional: true  }
    ]
  };

  beforeEach(() => {
    mockRepository.saveRun.mockResolvedValue(RUN_ID);
    mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID });
    mockRepository.getConfig.mockResolvedValue(null);
    mockRepository.getRuns.mockResolvedValue([]);
    mockRepository.getRunDetail.mockResolvedValue(null);
  });

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /funnel/build', () => {
    it('returns stageConfig, cacheHit and hash when given a valid prompt', async () => {
      const res = await request(app)
        .post('/funnel/build')
        .send({ prompt: 'Você é um assistente de vendas da clínica...' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stageConfig');
      expect(res.body).toHaveProperty('cacheHit', false);
      expect(res.body).toHaveProperty('hash', 'abc123');
      expect(Array.isArray(res.body.stageConfig.stages)).toBe(true);
      expect(res.body.stageConfig.stages[0]).toHaveProperty('code', 'SAUDACAO');
    });

    it('salva config quando account_id válido é passado', async () => {
      const res = await request(app)
        .post('/funnel/build')
        .send({ prompt: 'prompt válido', account_id: VALID_UUID });

      expect(res.status).toBe(200);
      expect(mockRepository.saveConfig).toHaveBeenCalledWith(VALID_UUID, 'abc123', expect.any(Object));
      expect(res.body.config_id).toBe(CONFIG_ID);
    });

    it('não salva config quando account_id não é passado', async () => {
      await request(app)
        .post('/funnel/build')
        .send({ prompt: 'prompt sem account_id' });

      expect(mockRepository.saveConfig).not.toHaveBeenCalled();
    });

    it('retorna 400 quando account_id fornecido é inválido', async () => {
      const res = await request(app)
        .post('/funnel/build')
        .send({ prompt: 'prompt', account_id: 'nao-um-uuid' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await request(app).post('/funnel/build').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when prompt is an empty string', async () => {
      const res = await request(app).post('/funnel/build').send({ prompt: '   ' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /analyze', () => {
    it('returns analysis with run_id when account_id and stageConfig are valid', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('meta');
      expect(res.body).toHaveProperty('funnel');
      expect(res.body).toHaveProperty('stage_config');
      expect(res.body).toHaveProperty('run_id', RUN_ID);
      expect(res.body.meta.account_id).toBe(VALID_UUID);
      expect(res.body.meta.total_chats).toBe(1);
    });

    it('chama saveRun com os dados corretos', async () => {
      await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

      expect(mockRepository.saveRun).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId:    VALID_UUID,
          analysisType: 'funnel',
          reportMd:     '# Mock Report'
        })
      );
    });

    it('retorna 200 com warnings quando saveRun falha (falha silenciosa)', async () => {
      mockRepository.saveRun.mockRejectedValueOnce(new Error('DB offline'));

      const res = await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('warnings');
      expect(res.body.warnings[0]).toContain('persist_failed');
      expect(res.body.run_id).toBeNull();
    });

    it('returns 400 when account_id is missing', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ stageConfig: VALID_STAGE_CONFIG });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/account_id/);
    });

    it('returns 400 when account_id is not a valid UUID', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ account_id: 'not-a-uuid', stageConfig: VALID_STAGE_CONFIG });
      expect(res.status).toBe(400);
    });

    it('returns 400 when stageConfig is missing', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/stageConfig/);
    });

    it('returns 400 when stageConfig is an array (not a plain object)', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID, stageConfig: ['botox'] });
      expect(res.status).toBe(400);
    });

    it('does NOT include prompt or prompt_hash in the response meta', async () => {
      const res = await request(app)
        .post('/analyze')
        .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });
      expect(res.status).toBe(200);
      expect(res.body.meta).not.toHaveProperty('prompt_cache_hit');
      expect(res.body.meta).not.toHaveProperty('prompt_hash');
    });
  });

  describe('GET /configs/:account_id', () => {
    it('retorna 404 quando config não existe', async () => {
      mockRepository.getConfig.mockResolvedValue(null);
      const res = await request(app).get(`/configs/${VALID_UUID}`);
      expect(res.status).toBe(404);
    });

    it('retorna o config quando encontrado', async () => {
      mockRepository.getConfig.mockResolvedValue({ id: CONFIG_ID, account_id: VALID_UUID, stage_config: VALID_STAGE_CONFIG });
      const res = await request(app).get(`/configs/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(CONFIG_ID);
    });

    it('retorna 400 para UUID inválido', async () => {
      const res = await request(app).get('/configs/nao-um-uuid');
      expect(res.status).toBe(400);
    });

    it('retorna 503 quando o banco está indisponível', async () => {
      mockRepository.getConfig.mockRejectedValueOnce(new Error('connection refused'));
      const res = await request(app).get(`/configs/${VALID_UUID}`);
      expect(res.status).toBe(503);
    });
  });

  describe('PUT /configs/:account_id', () => {
    it('faz upsert e retorna o config salvo', async () => {
      mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID, account_id: VALID_UUID });
      const res = await request(app)
        .put(`/configs/${VALID_UUID}`)
        .send({ stage_config: VALID_STAGE_CONFIG });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(CONFIG_ID);
    });

    it('retorna 400 quando stage_config é inválido', async () => {
      const res = await request(app)
        .put(`/configs/${VALID_UUID}`)
        .send({ stage_config: { not_stages: [] } });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /runs/:account_id', () => {
    it('retorna lista vazia quando não há runs', async () => {
      mockRepository.getRuns.mockResolvedValue([]);
      const res = await request(app).get(`/runs/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('retorna runs quando existem', async () => {
      mockRepository.getRuns.mockResolvedValue([{ id: RUN_ID, analyzed_at: '2026-04-16T00:00:00Z' }]);
      const res = await request(app).get(`/runs/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('retorna 400 para UUID inválido', async () => {
      const res = await request(app).get('/runs/nao-um-uuid');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /runs/:account_id/:run_id', () => {
    it('retorna 404 quando run não existe', async () => {
      mockRepository.getRunDetail.mockResolvedValue(null);
      const res = await request(app).get(`/runs/${VALID_UUID}/${RUN_ID}`);
      expect(res.status).toBe(404);
    });

    it('retorna o detalhe do run quando encontrado', async () => {
      const mockDetail = { id: RUN_ID, account_id: VALID_UUID, conversations: [] };
      mockRepository.getRunDetail.mockResolvedValue(mockDetail);
      const res = await request(app).get(`/runs/${VALID_UUID}/${RUN_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(RUN_ID);
    });

    it('retorna 400 quando run_id não é UUID válido', async () => {
      const res = await request(app).get(`/runs/${VALID_UUID}/nao-um-uuid`);
      expect(res.status).toBe(400);
    });
  });
  ```

- [ ] **Step 2: Rodar todos os testes para confirmar que passam**

  ```
  npm test
  ```

  Esperado: todos os testes passando (repository + server + filter + metrics + stage-detector).

- [ ] **Step 3: Commit**

  ```
  git add tests/server.test.js
  git commit -m "test: update server tests to mock repository and add new endpoint tests"
  ```

---

## Task 6: Criar as tabelas no Supabase

**Contexto:** As 4 tabelas precisam existir no banco antes de qualquer análise ser persistida. A migration SQL é idempotente (usa IF NOT EXISTS).

**Obs:** Esta task requer acesso ao projeto Supabase. Execute a SQL via Supabase Dashboard → SQL Editor, ou via MCP se disponível.

- [ ] **Step 1: Executar a migration SQL no Supabase**

  ```sql
  -- Migration: create persistence tables for funnel-analyzer
  -- Idempotente: usa IF NOT EXISTS

  CREATE TABLE IF NOT EXISTS funnel_configs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   uuid UNIQUE NOT NULL,
    prompt_hash  text NOT NULL,
    stage_config jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id         uuid NOT NULL,
    funnel_config_id   uuid REFERENCES funnel_configs(id) ON DELETE SET NULL,
    analysis_type      text NOT NULL DEFAULT 'funnel',
    total_chats        int  NOT NULL,
    professional_count int  NOT NULL,
    personal_count     int  NOT NULL,
    total_messages     int  NOT NULL,
    tracks             jsonb,
    stages_summary     jsonb,
    conversion         jsonb,
    top_sequences      jsonb,
    anomalies          jsonb,
    report_md          text,
    custom_data        jsonb,
    analyzed_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_analysis_runs_account_id   ON analysis_runs(account_id);
  CREATE INDEX IF NOT EXISTS idx_analysis_runs_analyzed_at  ON analysis_runs(analyzed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_analysis_runs_type         ON analysis_runs(analysis_type);

  CREATE TABLE IF NOT EXISTS analysis_conversations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    chat_id        uuid NOT NULL,
    msg_count      int  NOT NULL,
    inbound_count  int  NOT NULL,
    track          text NOT NULL,
    furthest_stage text,
    stages         text[],
    outbound_ia    int  NOT NULL DEFAULT 0,
    outbound_human int  NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_analysis_conversations_run_id  ON analysis_conversations(run_id);
  CREATE INDEX IF NOT EXISTS idx_analysis_conversations_chat_id ON analysis_conversations(chat_id);

  CREATE TABLE IF NOT EXISTS analysis_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid NOT NULL REFERENCES analysis_conversations(id) ON DELETE CASCADE,
    stage            text NOT NULL,
    sender           text NOT NULL,
    event_timestamp  text,
    preview          text
  );

  CREATE INDEX IF NOT EXISTS idx_analysis_events_conv_id ON analysis_events(conversation_id);

  -- RLS: habilitado em todas as tabelas (service_role tem bypass por padrão)
  ALTER TABLE funnel_configs         ENABLE ROW LEVEL SECURITY;
  ALTER TABLE analysis_runs          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE analysis_conversations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE analysis_events        ENABLE ROW LEVEL SECURITY;
  ```

- [ ] **Step 2: Verificar que as tabelas foram criadas**

  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('funnel_configs','analysis_runs','analysis_conversations','analysis_events')
  ORDER BY table_name;
  ```

  Esperado: 4 linhas retornadas.

- [ ] **Step 3: Commit da documentação**

  ```
  git add docs/
  git commit -m "docs: migration SQL for persistence tables in spec"
  ```

---

## Verificação Final

- [ ] Rodar suite completa: `npm test` — todos os testes passando
- [ ] Confirmar que `analysis_runs`, `funnel_configs`, `analysis_conversations`, `analysis_events` existem no Supabase
- [ ] Fazer uma chamada de teste ao `/funnel/build` com `account_id` e confirmar que `config_id` é retornado
- [ ] Fazer uma chamada de teste ao `/analyze` e confirmar que `run_id` é retornado (não nulo)
- [ ] Confirmar que `GET /configs/:id` retorna o config salvo
- [ ] Confirmar que `GET /runs/:id` lista as execuções salvas
