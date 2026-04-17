# API Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the funnel-analyzer API for VPS deployment with date filtering, config resolution by ID/account, auth middleware, standardized errors, and separated documentation.

**Architecture:** Express middleware chain adds auth before routes. Error helper standardizes all responses. `/analyze` resolves stageConfig from DB instead of receiving it in the body. `supabase.js` gains date filtering on `wa_messages`. Documentation is split into `docs/database-schema.md` and `docs/api-endpoints.md`.

**Tech Stack:** Node.js, Express, Supabase REST API, Jest + Supertest, crypto (timingSafeEqual)

---

### Task 1: Create error helper (`src/errors.js`)

**Files:**
- Create: `src/errors.js`
- Create: `tests/errors.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/errors.test.js
'use strict';

const { apiError } = require('../src/errors');

describe('apiError', () => {
  it('sends JSON response with error, code, and details', () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'account_id must be a valid UUID',
      code: 'VALIDATION_ERROR',
      details: { field: 'account_id' }
    });
  });

  it('omits details when not provided', () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    apiError(res, 401, 'AUTH_ERROR', 'Token inválido');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Token inválido',
      code: 'AUTH_ERROR'
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/errors.test.js --verbose`
Expected: FAIL — `Cannot find module '../src/errors'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/errors.js
'use strict';

/**
 * Envia uma resposta de erro padronizada.
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {string} code - Código de erro (VALIDATION_ERROR, NOT_FOUND, AUTH_ERROR, etc.)
 * @param {string} message - Mensagem descritiva do erro
 * @param {Object} [details] - Detalhes adicionais (campo, motivo, etc.)
 */
function apiError(res, status, code, message, details) {
  const body = { error: message, code };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

module.exports = { apiError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/errors.test.js --verbose`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/errors.js tests/errors.test.js
git commit -m "feat: add standardized apiError helper"
```

---

### Task 2: Create auth middleware (`src/auth.js`)

**Files:**
- Create: `src/auth.js`
- Create: `tests/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/auth.test.js
'use strict';

const crypto = require('crypto');

// Salva o valor original para restaurar entre testes
const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  process.env.API_TOKEN = 'test-secret-token-abc123';
});

afterAll(() => {
  if (originalToken !== undefined) process.env.API_TOKEN = originalToken;
  else delete process.env.API_TOKEN;
});

const { authMiddleware } = require('../src/auth');

function mockReqRes(authHeader) {
  const req = { headers: {} };
  if (authHeader !== undefined) req.headers['authorization'] = authHeader;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('authMiddleware', () => {
  it('calls next() when token matches', () => {
    const { req, res, next } = mockReqRes('Bearer test-secret-token-abc123');
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next } = mockReqRes(undefined);
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTH_ERROR' })
    );
  });

  it('returns 401 when token is wrong', () => {
    const { req, res, next } = mockReqRes('Bearer wrong-token');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when Authorization header has no Bearer prefix', () => {
    const { req, res, next } = mockReqRes('test-secret-token-abc123');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 500 when API_TOKEN is not configured', () => {
    delete process.env.API_TOKEN;
    const { req, res, next } = mockReqRes('Bearer anything');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_ERROR' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth.test.js --verbose`
Expected: FAIL — `Cannot find module '../src/auth'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/auth.js
'use strict';

const crypto = require('crypto');
const { apiError } = require('./errors');

/**
 * Middleware de autenticação por token fixo.
 * Valida o header Authorization: Bearer <token> contra process.env.API_TOKEN.
 * Usa comparação de tempo constante para prevenir timing attacks.
 */
function authMiddleware(req, res, next) {
  const envToken = process.env.API_TOKEN;
  if (!envToken) {
    return apiError(res, 500, 'INTERNAL_ERROR', 'Autenticação não configurada no servidor');
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return apiError(res, 401, 'AUTH_ERROR', 'Token de autenticação não fornecido. Use o header Authorization: Bearer <token>');
  }

  const token = authHeader.slice(7);

  // Comparação de tempo constante — ambos buffers devem ter o mesmo comprimento
  const tokenBuf = Buffer.from(token);
  const envBuf = Buffer.from(envToken);

  if (tokenBuf.length !== envBuf.length || !crypto.timingSafeEqual(tokenBuf, envBuf)) {
    return apiError(res, 401, 'AUTH_ERROR', 'Token de autenticação inválido');
  }

  next();
}

module.exports = { authMiddleware };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/auth.test.js --verbose`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/auth.js tests/auth.test.js
git commit -m "feat: add auth middleware with fixed token validation"
```

---

### Task 3: Add `getConfigById` to repository

**Files:**
- Modify: `src/repository.js`
- Modify: `tests/repository.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/repository.test.js`, after the `getConfig` describe block:

```js
// ─────────────────────────────────────────────
// getConfigById
// ─────────────────────────────────────────────
describe('getConfigById', () => {
  it('retorna o config quando encontrado por id', async () => {
    mockSupabaseRequest.mockResolvedValue([{
      id: CONFIG_ID, account_id: ACCOUNT_ID, stage_config: STAGE_CONFIG
    }]);

    const result = await repository.getConfigById(CONFIG_ID);

    expect(result.id).toBe(CONFIG_ID);
    expect(result.stage_config).toEqual(STAGE_CONFIG);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain(`id=eq.${CONFIG_ID}`);
  });

  it('retorna null quando não encontrado (array vazio)', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    const result = await repository.getConfigById(CONFIG_ID);
    expect(result).toBeNull();
  });

  it('retorna null quando supabase retorna null', async () => {
    mockSupabaseRequest.mockResolvedValue(null);
    const result = await repository.getConfigById(CONFIG_ID);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/repository.test.js --verbose --testNamePattern="getConfigById"`
Expected: FAIL — `repository.getConfigById is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/repository.js`, after the `getConfig` function:

```js
/**
 * Busca um stageConfig pelo ID do registro.
 * Retorna null se não encontrado.
 */
async function getConfigById(configId) {
  const rows = await supabaseRequest({
    path: '/rest/v1/funnel_configs',
    query: `?id=eq.${configId}&select=id,account_id,prompt_hash,stage_config,created_at,updated_at&limit=1`
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}
```

Update the `module.exports` line to include `getConfigById`:

```js
module.exports = { saveConfig, getConfig, getConfigById, saveRun, getRuns, getRunDetail };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/repository.test.js --verbose`
Expected: PASS — all tests including 3 new `getConfigById` tests

- [ ] **Step 5: Commit**

```bash
git add src/repository.js tests/repository.test.js
git commit -m "feat: add getConfigById to repository"
```

---

### Task 4: Add date filtering to `supabase.js`

**Files:**
- Modify: `src/supabase.js`
- Create: `tests/supabase.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/supabase.test.js
'use strict';

// Mock fetch globalmente
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Configura env necessário
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const { fetchConversations } = require('../src/supabase');

beforeEach(() => mockFetch.mockReset());

function mockFetchResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(data))
  };
}

describe('fetchConversations with date filters', () => {
  it('adds date filters to wa_messages query when startDate and endDate are provided', async () => {
    // Mock chats response
    mockFetch.mockResolvedValueOnce(mockFetchResponse([{ id: 'chat-1' }]));
    // Mock messages response
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'msg-1', chat_id: 'chat-1', direction: 'inbound', content_text: 'oi', created_at: '2026-04-10T10:00:00Z' }
    ]));

    await fetchConversations('123e4567-e89b-12d3-a456-426614174000', {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });

    // Segunda chamada = mensagens
    const messagesUrl = mockFetch.mock.calls[1][0];
    expect(messagesUrl).toContain('created_at=gte.2026-04-01T00:00:00Z');
    expect(messagesUrl).toContain('created_at=lte.2026-04-15T23:59:59Z');
  });

  it('does not add date filters when dateRange is not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse([{ id: 'chat-1' }]));
    mockFetch.mockResolvedValueOnce(mockFetchResponse([]));

    await fetchConversations('123e4567-e89b-12d3-a456-426614174000');

    const messagesUrl = mockFetch.mock.calls[1][0];
    expect(messagesUrl).not.toContain('created_at=gte.');
    expect(messagesUrl).not.toContain('created_at=lte.');
  });

  it('filters out chats with no messages in the date range', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'chat-1' },
      { id: 'chat-2' }
    ]));
    // Only chat-1 has messages in range
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'msg-1', chat_id: 'chat-1', content_text: 'oi', created_at: '2026-04-10T10:00:00Z' }
    ]));

    const result = await fetchConversations('123e4567-e89b-12d3-a456-426614174000', {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });

    // messagesByChat should only contain chat-1
    expect(Object.keys(result.messagesByChat)).toEqual(['chat-1']);
    // chats should be filtered to only those with messages
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].id).toBe('chat-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/supabase.test.js --verbose`
Expected: FAIL — `fetchConversations` does not accept a second argument, date filters not applied

- [ ] **Step 3: Write minimal implementation**

Modify `src/supabase.js`:

Update `fetchMessagesForChats` to accept a `dateRange` parameter:

```js
async function fetchMessagesForChats(chatIds, dateRange) {
  const allMessages = [];
  for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE);
    const filter = batch.join(',');
    let query = `?chat_id=in.(${filter})&select=id,chat_id,direction,sent_by,content_text,created_at,message_type&order=created_at.asc&limit=10000`;
    if (dateRange) {
      query += `&created_at=gte.${dateRange.startDate}&created_at=lte.${dateRange.endDate}`;
    }
    const msgs = await supabaseRequest({
      path: '/rest/v1/wa_messages',
      query
    });
    allMessages.push(...msgs);
  }
  return allMessages;
}
```

Update `fetchConversations` to accept and pass `dateRange`:

```js
async function fetchConversations(accountId, dateRange) {
  const chats = await fetchAllChats(accountId);
  const chatIds = chats.map(c => c.id);
  const messages = await fetchMessagesForChats(chatIds, dateRange);
  const messagesByChat = groupMessagesByChat(messages);

  // When filtering by date, only include chats that have messages in range
  const filteredChats = dateRange
    ? chats.filter(c => messagesByChat[c.id] && messagesByChat[c.id].length > 0)
    : chats;

  return { chats: filteredChats, messagesByChat, totalMessages: messages.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/supabase.test.js --verbose`
Expected: PASS — 3 tests

- [ ] **Step 5: Run all existing tests to ensure no regression**

Run: `npx jest --verbose`
Expected: All tests pass (existing tests don't pass `dateRange` so behavior is unchanged)

- [ ] **Step 6: Commit**

```bash
git add src/supabase.js tests/supabase.test.js
git commit -m "feat: add date range filtering to fetchConversations"
```

---

### Task 5: Update `POST /analyze` — config resolution + date filtering

**Files:**
- Modify: `src/server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the `describe('POST /analyze', ...)` block in `tests/server.test.js` with the new tests. First, update the mock at the top to add `getConfigById`:

In the `mockRepository` object at the top of the file, add:

```js
getConfigById: jest.fn().mockResolvedValue(null),
```

In the `beforeEach` block, add:

```js
mockRepository.getConfigById.mockResolvedValue(null);
```

Now replace the entire `describe('POST /analyze', ...)` block with:

```js
// ─────────────────────────────────────────────
describe('POST /analyze', () => {
  const MOCK_STAGE_CONFIG = {
    stages: [
      { code: 'SAUDACAO', keywords: ['oi', 'olá'], indicates_professional: false },
      { code: 'QUEIXA', keywords: ['papada', 'rugas'], indicates_professional: true }
    ]
  };

  const MOCK_CONFIG_RECORD = {
    id: CONFIG_ID,
    account_id: VALID_UUID,
    stage_config: MOCK_STAGE_CONFIG
  };

  it('resolves config by config_id when provided', async () => {
    mockRepository.getConfigById.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID, config_id: CONFIG_ID });

    expect(res.status).toBe(200);
    expect(mockRepository.getConfigById).toHaveBeenCalledWith(CONFIG_ID);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('stage_config');
    expect(res.body.stage_config).toEqual(MOCK_STAGE_CONFIG);
    expect(res.body).toHaveProperty('run_id', RUN_ID);
  });

  it('resolves config by account_id when config_id is not provided', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(mockRepository.getConfig).toHaveBeenCalledWith(VALID_UUID);
    expect(res.body.stage_config).toEqual(MOCK_STAGE_CONFIG);
  });

  it('returns 400 when config_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID, config_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when config_id does not exist', async () => {
    mockRepository.getConfigById.mockResolvedValue(null);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID, config_id: CONFIG_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 when no config found for account_id', async () => {
    mockRepository.getConfig.mockResolvedValue(null);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONFIG_NOT_FOUND');
  });

  it('passes date range to fetchConversations when start_date and end_date are provided', async () => {
    const { fetchConversations } = require('../src/supabase');
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({
        account_id: VALID_UUID,
        start_date: '2026-04-01T00:00:00Z',
        end_date: '2026-04-15T23:59:59Z'
      });

    expect(res.status).toBe(200);
    expect(fetchConversations).toHaveBeenCalledWith(VALID_UUID, {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });
    expect(res.body.meta.period).toEqual({
      start: '2026-04-01T00:00:00Z',
      end: '2026-04-15T23:59:59Z'
    });
  });

  it('does not pass date range when start_date and end_date are omitted', async () => {
    const { fetchConversations } = require('../src/supabase');
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(fetchConversations).toHaveBeenCalledWith(VALID_UUID, undefined);
    expect(res.body.meta.period).toBeNull();
  });

  it('returns 400 when only start_date is provided (without end_date)', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID, start_date: '2026-04-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when start_date is not a valid ISO date', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID, start_date: 'not-a-date', end_date: '2026-04-15T23:59:59Z' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when account_id is missing', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when account_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('returns 200 with warnings and run_id null when saveRun fails', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);
    mockRepository.saveRun.mockRejectedValueOnce(new Error('DB offline'));

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('warnings');
    expect(res.body.warnings[0]).toContain('persist_failed');
    expect(res.body.run_id).toBeNull();
  });

  it('passes configId to saveRun when config was resolved', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    await request(app)
      .post('/analyze')
      .set('Authorization', `Bearer ${process.env.API_TOKEN}`)
      .send({ account_id: VALID_UUID });

    expect(mockRepository.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: VALID_UUID,
        configId: CONFIG_ID,
        analysisType: 'funnel'
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/server.test.js --verbose --testNamePattern="POST /analyze"`
Expected: FAIL — multiple failures because `/analyze` still expects `stageConfig` in body

- [ ] **Step 3: Update `server.js` — add auth + rewrite `/analyze`**

Modify `src/server.js`:

Add imports at the top (after the existing requires):

```js
const { authMiddleware } = require('./auth');
const { apiError } = require('./errors');
```

Add auth middleware after `app.use(express.json(...))`, before the routes — but after `/health`:

Move the `/health` route to be **before** the auth middleware, then add auth:

The new structure of `server.js` should be:

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
// Resolves stageConfig from DB by config_id or account_id.
// Optional date filtering via start_date / end_date.
// ───────────────────────────────────────────────────

app.post('/analyze', async (req, res) => {
  const { account_id, config_id, start_date, end_date } = req.body || {};

  // Validate account_id
  if (!isValidUUID(account_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });
  }

  // Validate config_id if provided
  if (config_id !== undefined && !isValidUUID(config_id)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'config_id must be a valid UUID', { field: 'config_id' });
  }

  // Validate date range — both or neither
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
    // Resolve stageConfig from DB
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

    // Persist — silent failure
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
```

- [ ] **Step 4: Update `tests/server.test.js` — add auth header to all existing tests**

Every test request (except `/health`) needs `.set('Authorization', `Bearer ${process.env.API_TOKEN}`)`.

At the top of the test file, before the mocks, add:

```js
process.env.API_TOKEN = 'test-token-for-jest';
```

Add `.set('Authorization', 'Bearer test-token-for-jest')` to every `request(app)` call that hits a protected route (all except `GET /health`).

Also update the `POST /funnel/build` tests to use `apiError` format — existing tests check `res.body.error` which still works since `apiError` includes an `error` field.

Add new auth-specific tests in a new describe block:

```js
// ─────────────────────────────────────────────
describe('Authentication', () => {
  it('GET /health does not require auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 when no Authorization header on protected route', async () => {
    const res = await request(app).get(`/configs/${VALID_UUID}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_ERROR');
  });

  it('returns 401 when token is invalid on protected route', async () => {
    const res = await request(app)
      .get(`/configs/${VALID_UUID}`)
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server.js tests/server.test.js
git commit -m "feat: update /analyze with config resolution, date filtering, auth middleware, and standardized errors"
```

---

### Task 6: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJ...
OPENAI_API_KEY=sk-...
PORT=3000
CACHE_DIR=./cache
API_TOKEN=your-secret-token-here
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add API_TOKEN to .env.example"
```

---

### Task 7: Create `docs/database-schema.md`

**Files:**
- Create: `docs/database-schema.md`

- [ ] **Step 1: Write the database schema documentation**

```markdown
# Database Schema

O funnel-analyzer trabalha com dois grupos de tabelas no Supabase:

---

## Tabelas de Chat (leitura — dados externos)

Essas tabelas são populadas por integrações externas (WhatsApp, Instagram, etc.) e o funnel-analyzer **apenas lê** seus dados para análise.

### `wa_chats`

Representa uma conversa individual com um contato.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | Identificador único do chat |
| `account_id` | uuid | ID da conta/empresa dona do chat |
| `chat_type` | text | Tipo do chat (whatsapp, instagram, etc.) |
| `contact_id` | uuid | ID do contato associado |
| `created_at` | timestamptz | Data de criação do chat |
| `last_message_at` | timestamptz | Data da última mensagem |

**Campos usados pelo sistema:** `id`, `account_id`, `created_at`, `last_message_at`

### `wa_messages`

Mensagens individuais dentro de um chat.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | Identificador único da mensagem |
| `chat_id` | uuid | FK para `wa_chats.id` |
| `direction` | text | `inbound` (do contato) ou `outbound` (da empresa) |
| `sent_by` | text | Quem enviou: `IA`, `null` (humano), etc. |
| `content_text` | text | Conteúdo textual da mensagem |
| `created_at` | timestamptz | Data/hora da mensagem |
| `message_type` | text | Tipo da mensagem (text, image, etc.) |

**Campos usados pelo sistema:** `id`, `chat_id`, `direction`, `sent_by`, `content_text`, `created_at`

**Classificação de remetente:**
- `IA` = `sent_by === 'IA'`
- `HUMAN` = `direction === 'outbound'` e `sent_by` não definido
- `PATIENT` = `direction === 'inbound'`

---

## Tabelas do Sistema (leitura/escrita)

Essas tabelas são criadas e gerenciadas pelo funnel-analyzer para persistir configurações e resultados de análises.

### `funnel_configs`

Configuração de funil por conta (relação 1:1 com `account_id`).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | PK, gerado automaticamente |
| `account_id` | uuid | UNIQUE — ID da conta do cliente |
| `prompt_hash` | text | MD5 do prompt que gerou este config |
| `stage_config` | jsonb | Objeto `{ stages: [...] }` com as etapas do funil |
| `created_at` | timestamptz | Data de criação |
| `updated_at` | timestamptz | Última atualização |

**Índices:** `account_id` (unique)

**Estrutura do `stage_config`:**
```json
{
  "stages": [
    {
      "code": "SAUDACAO",
      "keywords": ["oi", "olá", "bom dia"],
      "indicates_professional": false
    }
  ]
}
```

### `analysis_runs`

Uma linha por execução de análise — contém métricas agregadas e relatório.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | PK |
| `account_id` | uuid | Conta analisada |
| `funnel_config_id` | uuid | FK para `funnel_configs.id` (nullable) |
| `analysis_type` | text | Tipo da análise (default: `funnel`) |
| `total_chats` | int | Total de chats encontrados |
| `professional_count` | int | Chats classificados como profissionais |
| `personal_count` | int | Chats classificados como pessoais |
| `total_messages` | int | Total de mensagens processadas |
| `tracks` | jsonb | Distribuição por track (pure_ia, pure_human, hybrid, no_outbound) |
| `stages_summary` | jsonb | Array de stages com reach% e contagens |
| `conversion` | jsonb | Taxas de conversão entre stages |
| `top_sequences` | jsonb | Top 15 sequências de stages mais frequentes |
| `anomalies` | jsonb | `{ out_of_order_count: N }` |
| `report_md` | text | Relatório em markdown gerado por LLM |
| `custom_data` | jsonb | Reservado para extensões futuras |
| `analyzed_at` | timestamptz | Data/hora da execução |

**Índices:** `account_id`, `analyzed_at DESC`, `analysis_type`

### `analysis_conversations`

Uma linha por conversa classificada dentro de um run.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | PK |
| `run_id` | uuid | FK para `analysis_runs.id` (CASCADE delete) |
| `chat_id` | uuid | ID original do `wa_chats` |
| `msg_count` | int | Total de mensagens na conversa |
| `inbound_count` | int | Mensagens do contato |
| `track` | text | `pure_ia`, `pure_human`, `hybrid`, ou `no_outbound` |
| `furthest_stage` | text | Stage mais avançada atingida |
| `stages` | text[] | Array de stages na ordem detectada |
| `outbound_ia` | int | Mensagens enviadas pela IA |
| `outbound_human` | int | Mensagens enviadas por humanos |

**Índices:** `run_id`, `chat_id`

### `analysis_events`

Um evento por stage detectada em uma conversa (nível máximo de detalhe).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | PK |
| `conversation_id` | uuid | FK para `analysis_conversations.id` (CASCADE delete) |
| `stage` | text | Código da stage detectada |
| `sender` | text | `IA`, `HUMAN`, ou `PATIENT` |
| `event_timestamp` | text | Timestamp ISO da mensagem original |
| `preview` | text | Primeiros 80 caracteres da mensagem |

**Índices:** `conversation_id`

---

## Relacionamentos

```
funnel_configs (1:1 account_id)
    │
    └──< analysis_runs (N:1 funnel_config_id)
              │
              └──< analysis_conversations (N:1 run_id, CASCADE)
                        │
                        └──< analysis_events (N:1 conversation_id, CASCADE)
```

**Cascata de deleção:** deletar um `analysis_run` remove automaticamente suas `analysis_conversations` e `analysis_events`.

---

## RLS (Row Level Security)

Todas as tabelas do sistema têm RLS habilitado. Atualmente o sistema usa a chave `service_role` do Supabase que bypassa RLS. Políticas de acesso podem ser adicionadas futuramente para acesso por `account_id`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/database-schema.md
git commit -m "docs: add database schema documentation"
```

---

### Task 8: Create `docs/api-endpoints.md`

**Files:**
- Create: `docs/api-endpoints.md`

- [ ] **Step 1: Write the API endpoints documentation**

```markdown
# API Endpoints

Todas as rotas (exceto `GET /health`) requerem autenticação via header:

```
Authorization: Bearer <API_TOKEN>
```

O `API_TOKEN` é definido no `.env` do servidor.

---

## `GET /health`

Health check — sem autenticação.

```bash
curl http://localhost:3000/health
```

**Response (200):**
```json
{ "ok": true }
```

---

## `POST /funnel/build`

Lê o prompt do assistente de IA e extrai as etapas do funil automaticamente.

```bash
curl -X POST http://localhost:3000/funnel/build \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Você é um assistente de vendas da Clínica XPTO...",
    "account_id": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

### Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `prompt` | string | Sim | Prompt do assistente de IA |
| `account_id` | uuid | Não | Se fornecido, salva o config no Supabase |

### Response (200)

```json
{
  "stageConfig": {
    "stages": [
      { "code": "SAUDACAO", "keywords": ["oi", "olá"], "indicates_professional": false },
      { "code": "QUEIXA", "keywords": ["flacidez", "papada"], "indicates_professional": true }
    ]
  },
  "cacheHit": false,
  "hash": "d41d8cd98f00b204e...",
  "config_id": "223e4567-e89b-12d3-a456-426614174001"
}
```

> `config_id` é `null` quando `account_id` não foi fornecido ou houve falha ao salvar.

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | `prompt` ausente ou vazio |
| 400 | `VALIDATION_ERROR` | `account_id` fornecido mas não é UUID válido |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 500 | `INTERNAL_ERROR` | Falha na chamada OpenAI |

---

## `POST /analyze`

Analisa conversas de uma conta usando o stageConfig salvo no banco. Persiste o resultado automaticamente.

```bash
# Usando o último config da conta
curl -X POST http://localhost:3000/analyze \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "123e4567-e89b-12d3-a456-426614174000"
  }'

# Com config específico e filtro de data
curl -X POST http://localhost:3000/analyze \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "123e4567-e89b-12d3-a456-426614174000",
    "config_id": "223e4567-e89b-12d3-a456-426614174001",
    "start_date": "2026-04-01T00:00:00Z",
    "end_date": "2026-04-15T23:59:59Z"
  }'
```

### Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `account_id` | uuid | Sim | ID da conta a ser analisada |
| `config_id` | uuid | Não | ID do config específico. Se omitido, usa o último config salvo para o `account_id` |
| `start_date` | ISO 8601 | Não | Início do período de mensagens. Se fornecido, `end_date` é obrigatório |
| `end_date` | ISO 8601 | Não | Fim do período de mensagens. Se fornecido, `start_date` é obrigatório |

**Resolução do stageConfig:**
1. Se `config_id` fornecido → busca por ID
2. Se apenas `account_id` → busca o último config salvo da conta
3. Se nenhum config encontrado → retorna erro

### Response (200)

```json
{
  "meta": {
    "account_id": "123e4567-...",
    "analyzed_at": "2026-04-17T18:00:00.000Z",
    "total_chats": 509,
    "professional": 290,
    "personal": 219,
    "total_messages": 4586,
    "period": { "start": "2026-04-01T00:00:00Z", "end": "2026-04-15T23:59:59Z" }
  },
  "funnel": { "overview": {}, "tracks": {}, "stages": [], "conversion": [], "top_sequences": [], "anomalies": {} },
  "stage_config": { "stages": [] },
  "report_md": "## Análise do Funil\n...",
  "run_id": "323e4567-e89b-12d3-a456-426614174002"
}
```

> `meta.period` é `null` quando não há filtro de data. `run_id` é `null` se a persistência falhar (nesse caso `warnings` aparece na resposta).

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | `account_id` ausente ou não é UUID |
| 400 | `VALIDATION_ERROR` | `config_id` fornecido mas não é UUID |
| 400 | `VALIDATION_ERROR` | `start_date` sem `end_date` (ou vice-versa) |
| 400 | `VALIDATION_ERROR` | `start_date` ou `end_date` não é ISO 8601 válido |
| 400 | `CONFIG_NOT_FOUND` | Nenhum config salvo para o `account_id` |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 404 | `NOT_FOUND` | `config_id` não encontrado no banco |
| 500 | `INTERNAL_ERROR` | Falha ao buscar dados ou gerar relatório |

---

## `GET /configs/:account_id`

Retorna o stageConfig salvo para uma conta.

```bash
curl http://localhost:3000/configs/123e4567-e89b-12d3-a456-426614174000 \
  -H "Authorization: Bearer $API_TOKEN"
```

### Response (200)

```json
{
  "id": "223e4567-...",
  "account_id": "123e4567-...",
  "prompt_hash": "d41d8cd...",
  "stage_config": { "stages": [] },
  "created_at": "2026-04-16T12:00:00Z",
  "updated_at": "2026-04-16T12:00:00Z"
}
```

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | UUID inválido |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 404 | `NOT_FOUND` | Config não encontrado |
| 503 | `DATABASE_ERROR` | Banco indisponível |

---

## `PUT /configs/:account_id`

Cria ou atualiza o stageConfig de uma conta manualmente.

```bash
curl -X PUT http://localhost:3000/configs/123e4567-e89b-12d3-a456-426614174000 \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "stage_config": {
      "stages": [
        { "code": "SAUDACAO", "keywords": ["oi"], "indicates_professional": false }
      ]
    },
    "prompt_hash": "opcional-identificador"
  }'
```

### Body

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `stage_config` | object | Sim | Objeto com `stages` array |
| `prompt_hash` | string | Não | Identificador do prompt (default: `"manual"`) |

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | UUID inválido ou `stage_config` inválido |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 503 | `DATABASE_ERROR` | Banco indisponível |

---

## `GET /runs/:account_id`

Lista o histórico de análises de uma conta.

```bash
curl "http://localhost:3000/runs/123e4567-e89b-12d3-a456-426614174000?from=2026-04-01&to=2026-04-30&limit=10" \
  -H "Authorization: Bearer $API_TOKEN"
```

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `from` | ISO date | Não | Filtra execuções a partir desta data |
| `to` | ISO date | Não | Filtra execuções até esta data |
| `limit` | number | Não | Quantidade máxima (default: `50`) |
| `type` | string | Não | Tipo de análise (ex: `funnel`) |

### Response (200)

Array de execuções resumidas (sem métricas detalhadas).

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | UUID inválido, `from`/`to` não é ISO válido, ou `limit` não é número positivo |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 503 | `DATABASE_ERROR` | Banco indisponível |

---

## `GET /runs/:account_id/:run_id`

Retorna o detalhe completo de uma execução com conversas e eventos.

```bash
curl http://localhost:3000/runs/123e4567-.../323e4567-... \
  -H "Authorization: Bearer $API_TOKEN"
```

### Erros

| Status | Code | Motivo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | UUID inválido |
| 401 | `AUTH_ERROR` | Token ausente ou inválido |
| 404 | `NOT_FOUND` | Run não encontrado |
| 503 | `DATABASE_ERROR` | Banco indisponível |

---

## `GET /cache`

Lista todos os prompts cacheados localmente.

```bash
curl http://localhost:3000/cache \
  -H "Authorization: Bearer $API_TOKEN"
```

### Response (200)

```json
[
  { "hash": "d41d8cd...", "created_at": "2026-04-16T12:00:00Z", "size_bytes": 1234 }
]
```

---

## `DELETE /cache/:hash`

Remove uma entrada do cache. Use quando o prompt do cliente mudar.

```bash
curl -X DELETE http://localhost:3000/cache/d41d8cd... \
  -H "Authorization: Bearer $API_TOKEN"
```

### Response (200)

```json
{ "deleted": "d41d8cd..." }
```

---

## Formato padrão de erro

Todas as respostas de erro seguem este formato:

```json
{
  "error": "Mensagem descritiva do erro",
  "code": "VALIDATION_ERROR",
  "details": { "field": "account_id", "reason": "UUID inválido" }
}
```

O campo `details` é opcional e presente apenas quando há informações adicionais relevantes.

### Códigos de erro

| Code | Descrição |
|------|-----------|
| `VALIDATION_ERROR` | Campo ausente, formato inválido |
| `NOT_FOUND` | Recurso não encontrado |
| `AUTH_ERROR` | Token ausente ou inválido |
| `CONFIG_NOT_FOUND` | Nenhum config salvo para a conta |
| `DATABASE_ERROR` | Supabase indisponível |
| `INTERNAL_ERROR` | Erro inesperado |
```

- [ ] **Step 2: Commit**

```bash
git add docs/api-endpoints.md
git commit -m "docs: add comprehensive API endpoints documentation"
```

---

### Task 9: Slim down README and add links

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README**

Replace the full content of `README.md` with a slimmed-down version that links to the docs:

```markdown
# funnel-analyzer

REST API para análise de funil de vendas de chatbots de IA (WhatsApp/Instagram/etc), usando dados de mensagens do Supabase. **100% agnóstico de nicho** — funciona com qualquer segmento porque o próprio prompt do assistente define as etapas do funil.

Os resultados de cada análise são **persistidos automaticamente no Supabase** — prontos para dashboards ou consulta via API.

## Como funciona

1. **`POST /funnel/build`** — Envia o prompt do assistente com o `account_id`. O sistema extrai as etapas do funil e salva no banco.

2. **`POST /analyze`** — Envia `account_id` (e opcionalmente `config_id` + filtro de datas). O backend busca o config do banco, analisa as conversas e persiste tudo automaticamente.

> **Fluxo:** chame `/funnel/build` uma vez por prompt, depois use `/analyze` com apenas o `account_id`.

## Setup

```bash
npm install
cp .env.example .env
# Preencha as variáveis no .env
```

### Migration do banco (execute uma vez no SQL Editor do Supabase)

Veja o schema completo em [`docs/database-schema.md`](docs/database-schema.md).

```sql
-- As tabelas necessárias estão documentadas em docs/database-schema.md
-- Execute o SQL de criação no Supabase SQL Editor
```

## Executar

```bash
npm run dev   # desenvolvimento (Node 18+)
npm start     # produção
npm test      # rodar testes
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_KEY` | Sim | Chave service_role do Supabase |
| `OPENAI_API_KEY` | Sim | Chave da API OpenAI |
| `API_TOKEN` | Sim | Token fixo para autenticação das requisições |
| `PORT` | Não | Porta do servidor (padrão: `3000`) |
| `CACHE_DIR` | Não | Diretório do cache (padrão: `./cache`) |

## Documentação

- **[Endpoints da API](docs/api-endpoints.md)** — Todos os endpoints com exemplos de request/response e erros
- **[Schema do Banco](docs/database-schema.md)** — Tabelas, colunas, índices e relacionamentos

## Arquitetura

```
POST /funnel/build {prompt, account_id?}
  ├── prompt-parser.js   → OpenAI gpt-4o-mini → stageConfig
  ├── cache.js           → MD5 hash (cache local)
  └── repository.js      → salva funnel_configs no Supabase

POST /analyze {account_id, config_id?, start_date?, end_date?}
  ├── repository.js      → resolve stageConfig do banco
  ├── supabase.js        → busca wa_chats + wa_messages (com filtro de data)
  ├── filter.js          → classifica: professional | personal
  ├── stage-detector.js  → detecta etapas via regex
  ├── metrics.js         → reach%, conversion, tracks, anomalias
  ├── report-writer.js   → gpt-4o-mini → relatório markdown
  └── repository.js      → persiste análise completa
```

| Módulo | Responsabilidade |
|--------|-----------------|
| `server.js` | Rotas Express, validação, auth middleware |
| `auth.js` | Autenticação por token fixo |
| `errors.js` | Helper de erros padronizados |
| `prompt-parser.js` | Extrai stages do prompt via OpenAI |
| `filter.js` | Classifica conversa como profissional/pessoal |
| `stage-detector.js` | Detecta etapas atingidas em cada conversa |
| `metrics.js` | Agrega métricas de funil |
| `report-writer.js` | Gera relatório markdown |
| `cache.js` | Cache local por hash MD5 |
| `supabase.js` | Busca conversas + helper de requests |
| `repository.js` | Persistência de configs e runs |

## Testes

```bash
npm test
```

## Custo por execução (LLM)

| Operação | Custo |
|----------|-------|
| `/funnel/build` — novo prompt | ~$0.0005 |
| `/funnel/build` — prompt cacheado | $0 |
| `/analyze` — relatório | ~$0.0003 |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: slim down README and add links to detailed docs"
```

---

### Task 10: Run all tests and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 2: Verify test count**

Ensure test count has increased with the new tests (auth, errors, supabase date filtering, new analyze tests).

- [ ] **Step 3: Final commit (if any fixes needed)**

If any tests needed fixing, commit the fixes:

```bash
git add -A
git commit -m "fix: address test failures from restructuring"
```
