# Separate Funnel Build from Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the all-in-one `/analyze` endpoint into two independent routes — `POST /funnel/build` for one-time LLM prompt parsing, and `POST /analyze` for repeated conversation analysis using a pre-built `stageConfig` — and expand the professional/personal classifier regex dictionary.

**Architecture:** `POST /funnel/build` handles OpenAI prompt parsing and returns a `stageConfig` JSON that the caller saves and re-uses. `POST /analyze` receives `stageConfig` directly, skipping LLM parsing entirely. The `parsePrompt` import is removed from `analyze`. `filter.js` gets a richer regex dictionary so fewer legitimate clinical conversations fall through as personal. No changes to `stage-detector.js` or `metrics.js`.

**Tech Stack:** Node.js 18+, Express 4, Jest 29, Supertest

---

## File Map

| File | Action | Reason |
|---|---|---|
| `src/server.js` | Modify | Add `/funnel/build`; refactor `/analyze` to remove prompt parsing |
| `src/filter.js` | Modify | Expand hardcoded `DEFAULT_PROCEDURE`, `DEFAULT_CLINICAL`, `COMMERCIAL` regex terms |
| `tests/server.test.js` | Create | Integration tests for both endpoints using Supertest |
| `tests/filter.test.js` | Modify | Add cases for new regex terms |
| `package.json` | Modify | Add `supertest` devDependency |

---

## Task 1: Install Supertest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Supertest**

```bash
npm install -D supertest
```

- [ ] **Step 2: Verify it appears in devDependencies**

Open `package.json`:
```json
"devDependencies": {
  "jest": "^29.7.0",
  "supertest": "^7.0.0"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supertest dev dependency"
```

---

## Task 2: Create server integration test file with mocks at top-level

**Files:**
- Create: `tests/server.test.js`

Jest hoists `jest.mock()` calls to the top of the file at compile time. All mocks **must** be declared at the top-level of the file, outside any `describe` or `it` blocks.

- [ ] **Step 1: Create `tests/server.test.js`**

```javascript
// tests/server.test.js
'use strict';

const request = require('supertest');

// All jest.mock() calls MUST be at top-level — Jest hoists these before imports
jest.mock('../src/prompt-parser', () => ({
  parsePrompt: jest.fn().mockResolvedValue({
    stageConfig: {
      clinical_terms: ['papada', 'flacidez'],
      procedure_terms: ['botox', 'lifting'],
      greeting_patterns: ['oi', 'olá'],
      previous_treatment_terms: ['já fiz'],
      price_pattern: 'R\\$\\s*[\\d.,]+',
      objection_terms: ['caro'],
      contact_capture_terms: ['whatsapp'],
      forbidden_words: [],
      handoff_triggers: ['agendar']
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
  })
}));

jest.mock('../src/report-writer', () => ({
  generateReport: jest.fn().mockResolvedValue('# Mock Report')
}));

const app = require('../src/server');

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_STAGE_CONFIG = {
  clinical_terms: ['papada'],
  procedure_terms: ['botox'],
  greeting_patterns: ['oi'],
  previous_treatment_terms: ['já fiz'],
  price_pattern: 'R\\$\\s*[\\d.,]+',
  objection_terms: ['caro'],
  contact_capture_terms: ['whatsapp'],
  forbidden_words: [],
  handoff_triggers: ['agendar']
};

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
    expect(Array.isArray(res.body.stageConfig.procedure_terms)).toBe(true);
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
  it('returns analysis when account_id and stageConfig are valid', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('stage_config');
    expect(res.body.meta.account_id).toBe(VALID_UUID);
    expect(res.body.meta.total_chats).toBe(1);
    expect(res.body.stage_config.procedure_terms[0]).toBe('botox');
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
```

- [ ] **Step 2: Run tests to confirm they all FAIL**

```bash
npx jest tests/server.test.js --no-coverage
```

Expected output: Multiple failures — `Cannot find module`, `404 Not Found` on `/funnel/build`, and validation failures on `/analyze`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/server.test.js
git commit -m "test: add failing integration tests for funnel/build and analyze endpoints"
```

---

## Task 3: Add `POST /funnel/build` and refactor `POST /analyze` in server.js

**Files:**
- Modify: `src/server.js`

Replace the entire contents of `src/server.js` with the following. The changes are:
1. Add `POST /funnel/build` route
2. Remove `parsePrompt` from `/analyze` — it now expects `stageConfig` directly
3. Fix `stageConfig` validation to reject arrays
4. Remove `prompt_cache_hit` and `prompt_hash` from the response (they are not applicable here)

- [ ] **Step 1: Replace `src/server.js`**

```javascript
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
```

- [ ] **Step 2: Run server tests to confirm they pass**

```bash
npx jest tests/server.test.js --no-coverage
```

Expected output:
```
PASS tests/server.test.js
  GET /health
    ✓ returns ok
  POST /funnel/build
    ✓ returns stageConfig, cacheHit and hash when given a valid prompt
    ✓ returns 400 when prompt is missing
    ✓ returns 400 when prompt is an empty string
  POST /analyze
    ✓ returns analysis when account_id and stageConfig are valid
    ✓ returns 400 when account_id is missing
    ✓ returns 400 when account_id is not a valid UUID
    ✓ returns 400 when stageConfig is missing
    ✓ returns 400 when stageConfig is an array (not a plain object)
    ✓ does NOT include prompt or prompt_hash in the response meta

Test Suites: 1 passed, 1 total
```

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: add /funnel/build endpoint and decouple parsePrompt from /analyze"
```

---

## Task 4: Expand `filter.js` regex dictionaries

**Files:**
- Modify: `src/filter.js`
- Modify: `tests/filter.test.js`

The current regex dictionaries are too narrow and cause legitimate clinical conversations to be classified as personal. This task widens them.

Key additions:
- `DEFAULT_PROCEDURE`: add skin/laser/body procedures common in Brazilian aesthetic clinics
- `DEFAULT_CLINICAL`: add body complaints (barriga, braço, quadril, celulite, etc.) and skin terms
- `COMMERCIAL`: add booking/scheduling terms (horário, disponibilidade, orçamento, valores)

- [ ] **Step 1: Add failing tests for expanded terms to `tests/filter.test.js`**

Append these tests to the end of the existing `tests/filter.test.js` file (do not remove any existing tests):

```javascript
// ── Expanded DEFAULT_PROCEDURE terms ──
test('Tier 2: "lipo" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Nosso protocolo inclui lipoaspiração de alta definição.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 2: "laser" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Usamos laser fracionado para rejuvenescimento facial.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 2: "peeling" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('O peeling químico melhora muito a textura da pele.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 2: "toxina" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('A aplicação de toxina botulínica é minimamente invasiva.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

// ── Expanded DEFAULT_CLINICAL terms ──
test('Tier 3: "celulite" in patient inbound + substantive response → PROFESSIONAL', () => {
  const msgs = [
    patient('Tenho muita celulite nas coxas e bumbum'),
    human('Entendo, isso é muito comum e temos ótimos protocolos para tratar.')
  ];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 3: "barriga" in patient inbound + substantive response → PROFESSIONAL', () => {
  const msgs = [
    patient('Quero eliminar essa barriga depois da gravidez'),
    human('Perfeito, temos opções de tratamento não invasivo para essa região.')
  ];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 3: "gordura localizada" in patient inbound + substantive response → PROFESSIONAL', () => {
  const msgs = [
    patient('tenho gordura localizada no abdômen que não sai com dieta'),
    human('Nossa equipe pode te ajudar com protocolos de alta tecnologia para isso.')
  ];
  expect(isProfessional(msgs, {})).toBe(true);
});

// ── Expanded COMMERCIAL terms ──
test('Tier 2: "orçamento" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Vou te passar o orçamento completo do procedimento.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 2: "horário" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Temos horário disponível para segunda e quarta-feira.')];
  expect(isProfessional(msgs, {})).toBe(true);
});

test('Tier 2: "valores" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Posso te passar os valores do tratamento completo.')];
  expect(isProfessional(msgs, {})).toBe(true);
});
```

- [ ] **Step 2: Run filter tests to confirm new tests FAIL**

```bash
npx jest tests/filter.test.js --no-coverage
```

Expected: the 10 new tests fail. The original tests still pass.

- [ ] **Step 3: Replace the regex constants in `src/filter.js`**

Replace only the top 4 const declarations (lines 1–4). Everything from `function buildRegex` onwards stays unchanged.

```javascript
// src/filter.js — replace the top const block only

const DEFAULT_PROCEDURE = /fastlifting|full[\s.-]?face|deep[\s.-]?plane|lifting|minilipo|abdominoplastia|mastopexia|ginecomastia|lipoescultura|lipoaspira[çc][aã]o|lipo\b|toxina\s*botul[ií]nica|botox|preenchimento|bichectomia|rinoplastia|blefaroplastia|mentoplastia|laser\s*fracion|laser\s*co2|laser\b|peeling|fios\s*de\s*pdo|fios\s*susten|fios\b|endolaser|fotona|morpheus|thermage|ultherapy|sculpsure|criolip[ó]lise|ultrassom\s*focalizado|radiofrequ[eê]ncia|microagulhamento|skinbooster|bioestimulador|sculptra|radiesse|harmoniza[çc][aã]o\s*facial|harmoniza[çc][aã]o\b/i;

const DEFAULT_CLINICAL = /papada|flacid|bigode|mandí?bula|ma[çc][aã]\s*do\s*rosto|olhos?|p[aá]lpebra|sobrancelh|pesco[çc]o|rosto|face|facial|rugas?|rejuvenescimento|est[eé]tic|cicatriz|manchas?|melasma|poros?\s*abertos?|acne|espinhas?|oleosidade|olheiras?|c[aé]rculos?\s*escuros?|celulite|barriga|abdômen|abdomen|flancos?|culote|gordura\s*localizada|bra[çc]o|perna|coxa|bumbum|glúteos?|seios?|mama|protru|envelhecimento|caimento\s*da\s*pele|pele\s*fina|pele\s*ressecada|perda\s*de\s*volume|perda\s*de\s*colágeno/i;

const COMMERCIAL = /consulta|investimento|agendamento|se\s*interessou|procedimento|cirurgia|recupera[çc][aã]o|anestesia|orçamento|or[çc]amento|valores?\b|valor\s*do|pacote|protocolo|tratamento|sess[oõ]es?|disponibilidade|horário|hor[aá]rio|agendar|marcar|agenda\b|atendimento|avalia[çc][aã]o\s*gratuita|primeira\s*consulta/i;

const PRICE = /R\$\s*[\d.,]+\s*(mil|k)?|a\s*partir\s*de\s*R\$|parcelas?\s*de\s*R\$/i;
```

- [ ] **Step 4: Run all filter tests to confirm all pass**

```bash
npx jest tests/filter.test.js --no-coverage
```

Expected output:
```
PASS tests/filter.test.js
  ✓ always PERSONAL: no outbound messages
  ... (all original tests pass)
  ✓ Tier 2: "lipo" in outbound → PROFESSIONAL
  ✓ Tier 2: "laser" in outbound → PROFESSIONAL
  ✓ Tier 2: "peeling" in outbound → PROFESSIONAL
  ✓ Tier 2: "toxina" in outbound → PROFESSIONAL
  ✓ Tier 3: "celulite" in patient inbound + substantive response → PROFESSIONAL
  ✓ Tier 3: "barriga" in patient inbound + substantive response → PROFESSIONAL
  ✓ Tier 3: "gordura localizada" in patient inbound + substantive response → PROFESSIONAL
  ✓ Tier 2: "orçamento" in outbound → PROFESSIONAL
  ✓ Tier 2: "horário" in outbound → PROFESSIONAL
  ✓ Tier 2: "valores" in outbound → PROFESSIONAL

Test Suites: 1 passed, 1 total
```

- [ ] **Step 5: Commit**

```bash
git add src/filter.js tests/filter.test.js
git commit -m "feat: expand classifier regex dictionary to reduce false personal classifications"
```

---

## Task 5: Full test suite green check

**Files:** None modified.

- [ ] **Step 1: Run entire test suite**

```bash
npx jest --no-coverage
```

Expected output:
```
PASS tests/cache.test.js
PASS tests/filter.test.js
PASS tests/metrics.test.js
PASS tests/stage-detector.test.js
PASS tests/server.test.js

Test Suites: 5 passed, 5 total
Tests:       XX passed, XX total
```

If any test fails, fix the root cause before proceeding.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: all tests green after funnel/analyze decoupling and filter expansion"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `POST /funnel/build` endpoint created — Task 3
- [x] `POST /analyze` decoupled from `parsePrompt` — Task 3
- [x] `stageConfig` array validation bug fixed (`isPlainObject`) — Task 3
- [x] `prompt_cache_hit`/`prompt_hash` removed from response (not left as `null`) — Task 3
- [x] Jest mocks at top-level (hoisting safe) — Task 2
- [x] `filter.js` regex expanded for clinical, procedure, and commercial terms — Task 4

**Placeholder scan:** None found. All steps have complete code.

**Type consistency:** `stageConfig` is consistently a plain object throughout tasks 2, 3, and 4. `parsePrompt` return shape `{ stageConfig, cacheHit, hash }` matches both the mock in Task 2 and the real implementation in `prompt-parser.js`.
