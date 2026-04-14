# Design Spec — Funnel Analyzer API

**Date:** 2026-04-14
**Status:** Approved
**Project path:** `Documents/GitHub/funnel-analyzer/`

---

## Problem

Identifying the real sales funnel of an AI-assisted WhatsApp/Instagram attendant requires analyzing hundreds of conversations from a Supabase messaging database. Doing this manually is expensive and slow. The goal is a reusable REST API that accepts an `account_id` and the client's AI prompt, then returns the complete funnel data and a narrative report.

---

## Scope

- **Phase 1 (this spec):** Local REST API, single Supabase project, deterministic analysis + minimal LLM use.
- **Phase 2 (future):** Multi-tenant Supabase credentials, scheduled runs, dashboard.

---

## Architecture

### Request Flow

```
POST /analyze
  { account_id, prompt }
        │
        ▼
┌─────────────────┐
│  prompt-parser  │ ← LLM (4o-mini), runs ONCE per unique prompt, result cached by MD5 hash
│                 │   Output: stage_config JSON (keywords per stage, forbidden words,
│                 │   clinical terms, handoff triggers, price patterns)
└────────┬────────┘
         │ stage_config
         │
         │  NOTE: prompt-parser and supabase run in parallel (Promise.all).
         │  Both results merge before filter.js.
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  prompt-parser  │     │   supabase.js   │ Fetches all chats + messages (batches of 100)
│  (stage_config) │     │  (raw messages) │
└────────┬────────┘     └────────┬────────┘
         └──────────┬────────────┘
                    ▼
┌─────────────────┐
│   filter.js     │ Classifies each conversation: PROFESSIONAL or PERSONAL (see below)
└────────┬────────┘
         │ professional conversations only
         ▼
┌─────────────────┐
│ stage-detector  │ Tags each conversation with stage events (deterministic regex)
│    .js          │ Uses stage_config from prompt-parser for keywords
└────────┬────────┘
         │ classified conversations
         ▼
┌─────────────────┐
│   metrics.js    │ Computes: reach %, conversion rates, track split, anomalies, sequences
└────────┬────────┘
         │ metrics JSON
         ▼
┌─────────────────┐
│ report-writer   │ ← LLM (4o-mini), runs ONCE per analysis
│    .js          │   Input: metrics JSON (small) → Output: markdown narrative report
└────────┬────────┘
         │
         ▼
   Response JSON
   { meta, funnel, report_md, stage_config }
```

---

## Module Specifications

### `server.js`
Express server on port `3000` (configurable via `PORT` env var).

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/analyze` | Main analysis endpoint |
| `GET` | `/health` | Health check |
| `GET` | `/cache` | List cached prompt parses |
| `DELETE` | `/cache/:hash` | Invalidate a cached prompt |

**Input validation:** `account_id` must be a valid UUID. `prompt` must be a non-empty string.

---

### `supabase.js`
Fetches all data for the account using Supabase PostgREST REST API.

- Credentials from `.env`: `SUPABASE_URL`, `SUPABASE_KEY`
- Fetches `wa_chats` filtered by `account_id`
- Fetches `wa_messages` in batches of 100 chat IDs (URL length limit)
- Fields fetched from `wa_messages`: `id, chat_id, direction, sent_by, content_text, created_at, message_type`
- Messages sorted `ascending` by `created_at` within each chat
- No LLM, pure HTTP calls

---

### `filter.js`
Classifies each conversation as `PROFESSIONAL` or `PERSONAL` using three confidence tiers. Uses `stage_config.clinical_terms` and `stage_config.procedure_terms` from the parsed prompt.

**Tier 1 — Strong signal (certain):**
- Any message has `sent_by = 'IA'` → **PROFESSIONAL**

**Tier 2 — Medium signal (human confirmed professional context):**
- Any `outbound` message matches: procedure terms, clinical anatomy, commercial templates ("se interessou", "consulta", "investimento"), or price pattern (`R$ XX mil`)
- → **PROFESSIONAL**

**Tier 3 — Weak signal (patient mentioned clinical topic, human responded):**
- Any `inbound` message matches clinical terms AND length > 10 chars
- AND at least one `outbound` message has length > 30 chars
- → **PROFESSIONAL**

**Always PERSONAL (overrides all tiers):**
- Zero outbound messages (nobody replied)
- All messages from same sender (monologue)
- Only 1 message total with < 5 chars

---

### `stage-detector.js`
Scans each professional conversation chronologically. Tags stage events using the `stage_config` extracted from the client's prompt. Returns ordered events per conversation.

**Stage schema:**

| Code | Triggered by | Detection |
|---|---|---|
| `CONTATO_INICIAL` | Patient | Always: first inbound message |
| `SAUDACAO` | IA / Human | First outbound matching greeting pattern |
| `APRESENTACAO_TECNICA` | IA / Human | Outbound containing procedure/technique terms |
| `QUEIXA_DECLARADA` | Patient | Inbound with clinical complaint terms (length > 3) |
| `TRIAGEM_CLINICA` | IA / Human | Outbound asking about previous treatments |
| `INVESTIMENTO` | IA / Human | Any message with price pattern |
| `OBJECAO` | Patient | Inbound with objection keywords (distance, fear, cost) |
| `CAPTURA_CONTATO` | IA / Human | Outbound requesting name + phone/WhatsApp |
| `HANDOFF_HUMANO` | System | `sent_by=null` outbound message after at least one `sent_by=IA` message in same chat |

**Per event, records:** `{ stage, sender (IA/HUMAN/PATIENT), timestamp, message_preview (80 chars) }`

**Stage ordering rule:** Each stage fires at most once per conversation (first occurrence). Exception: `OBJECAO` can fire multiple times (different objections).

---

### `metrics.js`
Pure computation, no external calls. Produces all funnel metrics from classified conversations.

**Outputs:**

```json
{
  "overview": {
    "total_chats": 509,
    "professional": 290,
    "personal": 219
  },
  "tracks": {
    "pure_ia":    { "count": 30,  "captura_pct": 40.0 },
    "pure_human": { "count": 193, "captura_pct": 1.0  },
    "hybrid":     { "count": 65,  "captura_pct": 49.2 },
    "no_outbound":{ "count": 2 }
  },
  "stages": [
    { "code": "SAUDACAO", "reach": 235, "reach_pct": 81.0, "by_ia": 44, "by_human": 191 }
  ],
  "conversion": [
    { "from": "SAUDACAO", "to": "QUEIXA_DECLARADA", "rate_pct": 43.0 }
  ],
  "top_sequences": [
    { "sequence": "SAUDACAO>APRESENTACAO_TECNICA", "count": 47 }
  ],
  "anomalies": {
    "price_before_complaint": 6,
    "handoff_before_booking":  20,
    "tech_without_triage":    118
  }
}
```

---

### `prompt-parser.js`
**LLM call #1.** Reads the client's AI prompt and extracts a `stage_config` JSON.

- Model: `gpt-4o-mini`
- Cache: MD5 hash of prompt text → stored in `cache/` folder as `{hash}.json`
- On cache hit: returns stored JSON, zero LLM cost
- System prompt instructs the LLM to output strictly valid JSON, no prose

**Output `stage_config` shape:**
```json
{
  "clinical_terms": ["papada", "flacidez", "mandíbula", ...],
  "procedure_terms": ["fastlifting", "full face", "área 1", ...],
  "greeting_patterns": ["oi", "olá", "bom dia", ...],
  "previous_treatment_terms": ["botox", "preenchimento", "fio", ...],
  "price_pattern": "R\\$\\s*[\\d.,]+\\s*(mil|k)?",
  "objection_terms": ["longe", "medo", "caro", "distância", ...],
  "contact_capture_terms": ["whatsapp", "equipe vai entrar", "minha equipe", ...],
  "forbidden_words": ["corte", "harmonização", "preço", "valor", ...],
  "handoff_triggers": ["quero agendar", "marcar consulta", "como faço para", ...]
}
```

---

### `report-writer.js`
**LLM call #2.** Receives the computed `metrics` JSON and generates the markdown narrative report.

- Model: `gpt-4o-mini`
- Input: metrics JSON (~600 tokens)
- Output: markdown report (~800-1200 tokens)
- Always runs (not cached) — metrics change per analysis run
- System prompt: instructs the model to write in Portuguese, analytical tone, identify the biggest opportunity, format as markdown with sections

---

### `cache.js`
Simple file-based cache in `cache/` directory at project root.

- `get(hash)` → returns parsed JSON or null
- `set(hash, data)` → writes `cache/{hash}.json`
- `list()` → returns array of `{ hash, created_at, size_bytes }`
- `delete(hash)` → removes file

---

## API Response Format

```json
{
  "meta": {
    "account_id": "uuid",
    "analyzed_at": "ISO timestamp",
    "total_chats": 509,
    "professional": 290,
    "personal": 219,
    "prompt_cache_hit": true
  },
  "funnel": {
    "tracks": { ... },
    "stages": [ ... ],
    "conversion": [ ... ],
    "top_sequences": [ ... ],
    "anomalies": { ... }
  },
  "stage_config": { ... },
  "report_md": "# Relatório de Funil\n..."
}
```

---

## Environment Variables

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
OPENAI_API_KEY=sk-...
PORT=3000
```

---

## Project Structure

```
funnel-analyzer/
├── src/
│   ├── server.js
│   ├── supabase.js
│   ├── filter.js
│   ├── stage-detector.js
│   ├── metrics.js
│   ├── prompt-parser.js
│   ├── report-writer.js
│   └── cache.js
├── cache/                  ← gitignored, stores prompt parse results
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-14-funnel-analyzer-design.md
├── .env                    ← gitignored
├── .env.example
├── .gitignore
└── package.json
```

---

## Constraints

- No database writes — read-only Supabase access
- LLM calls: maximum 2 per `/analyze` request (1 for prompt parse if cache miss + 1 for report)
- LLM model: `gpt-4o-mini` only
- Node.js runtime (v18+)
- No frontend — pure REST API
- Local only (Phase 1) — no auth, no HTTPS required
