# funnel-analyzer

Local REST API that analyzes the sales funnel of an AI-assisted WhatsApp/Instagram chatbot account from Supabase messaging data.

## Setup

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY
```

## Run

```bash
npm start        # production
npm run dev      # auto-restart on file changes (Node 18+)
```

## Endpoints

### `POST /funnel/build`

Parses an AI assistant prompt and returns a `stageConfig`. This should be called once per prompt. The returned `stageConfig` should be saved and passed to `POST /analyze`.

**Request:**
```json
{
  "prompt": "full text content of the AI assistant's prompt"
}
```

**Response:**
```json
{
  "stageConfig": { ... },
  "cacheHit": false,
  "hash": "abc123"
}
```

### `POST /analyze`

Analyzes all conversations for an account using a pre-built `stageConfig`. Returns funnel data + markdown report.

**Request:**
```json
{
  "account_id": "4ba6a619-594e-48f8-82e2-16a9df9bc438",
  "stageConfig": { ... }
}
```

**Response:**
```json
{
  "meta": {
    "account_id": "...",
    "analyzed_at": "ISO timestamp",
    "total_chats": 509,
    "professional": 290,
    "personal": 219,
    "total_messages": 4586
  },
  "funnel": {
    "overview": { "total": 290 },
    "tracks": {
      "pure_ia":    { "count": 30,  "captura_pct": 40.0 },
      "pure_human": { "count": 193, "captura_pct": 1.0  },
      "hybrid":     { "count": 65,  "captura_pct": 49.2 },
      "no_outbound":{ "count": 2,   "captura_pct": 0.0  }
    },
    "stages": [ { "code": "SAUDACAO", "reach": 235, "reach_pct": 81.0, "by_ia": 44, "by_human": 191 } ],
    "conversion": [ { "from": "SAUDACAO", "to": "QUEIXA_DECLARADA", "rate_pct": 43.0 } ],
    "top_sequences": [ { "sequence": "SAUDACAO>APRESENTACAO_TECNICA", "count": 47 } ],
    "anomalies": {
      "price_before_complaint": 6,
      "handoff_before_booking": 20,
      "tech_without_triage": 118
    }
  },
  "stage_config": { ... },
  "report_md": "## Visão Geral\n..."
}
```

### `GET /health`
Returns `{ "ok": true }`.

### `GET /cache`
Lists all cached prompt parses (each entry: `hash`, `created_at`, `size_bytes`).

### `DELETE /cache/:hash`
Invalidates a cached prompt parse. Use this when the client's AI prompt changes.

## Funnel Stages

| Code | Triggered by | What it means |
|---|---|---|
| `CONTATO_INICIAL` | Patient | First inbound message |
| `SAUDACAO` | IA / Human | Greeting sent to patient |
| `APRESENTACAO_TECNICA` | IA / Human | Procedure explained (often proactively) |
| `QUEIXA_DECLARADA` | Patient | Patient described their complaint |
| `TRIAGEM_CLINICA` | IA / Human | Asked about previous treatments |
| `INVESTIMENTO` | IA / Human | Price/investment discussed |
| `OBJECAO` | Patient | Patient raised objection (distance, cost, fear) |
| `CAPTURA_CONTATO` | IA / Human | Name + phone requested |
| `HANDOFF_HUMANO` | System | Human attendant took over after IA |

## How It Works

1. **Funnel Building** — `/funnel/build` uses `gpt-4o-mini` to read the client's AI prompt and extract stage keywords (`stageConfig`). Results are cached by MD5 hash.
2. **Analysis** — `/analyze` receives the `stageConfig` and `account_id`. It fetches data from Supabase and performs analysis deterministically without further LLM calls for stage detection.
3. **Filtering** — Each conversation classified as professional or personal via an expanded 3-tier rule engine (no LLM needed).
4. **Stage detection** — Each professional conversation tagged with funnel stage events using pure regex against the `stageConfig`.
5. **Metrics computed** — Reach %, conversion rates, track split (IA/Human/Hybrid), anomalies calculated deterministically.
6. **Report generated** — `gpt-4o-mini` writes the markdown narrative from the computed metrics JSON (~600 tokens in, ~1000 tokens out).

## LLM Cost Per Run

| Step | Model | Tokens (approx) | Cost (approx) |
|---|---|---|---|
| Prompt parse (`/funnel/build`) | gpt-4o-mini | ~3000 in + 500 out | ~$0.0005 |
| Prompt parse (cached) | — | 0 | $0 |
| Report generation | gpt-4o-mini | ~600 in + 1000 out | ~$0.0003 |

Total per analysis: **~$0.0008** (first build) / **~$0.0003** (subsequent analysis).

## Tests

```bash
npm test
```

Tests cover: cache (7), filter (21), stage-detector (17), metrics (8), server (10) = **63 tests**.
