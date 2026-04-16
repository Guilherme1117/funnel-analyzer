# funnel-analyzer

REST API local para análise de funil de vendas de chatbots de IA (WhatsApp/Instagram/etc), usando dados de mensagens do Supabase. **100% agnóstico de nicho** — funciona com qualquer segmento (clínicas, imobiliárias, escolas, etc.) porque o próprio prompt do seu assistente define as etapas do funil.

Os resultados de cada análise são **persistidos automaticamente no Supabase** — incluindo métricas agregadas, conversas classificadas e eventos de stage detectados — prontos para dashboards (Metabase, Grafana) ou consulta via API.

## Como funciona

O sistema opera em **duas etapas desacopladas**:

1. **`POST /funnel/build`** — Envia o prompt do seu assistente de IA (com o `account_id` do cliente). O `gpt-4o-mini` lê o prompt e extrai automaticamente as etapas do funil (`stageConfig`), que é **salvo no Supabase** e **cacheado por hash** — prompt igual = zero custo de OpenAI.

2. **`POST /analyze`** — Envia `account_id` + o `stageConfig`. O backend busca todas as conversas do Supabase, classifica cada uma **localmente via regex** (sem LLM), gera relatório, e **persiste tudo no banco automaticamente**.

> **Fluxo recomendado:** chame `/funnel/build` uma vez por prompt (quando o assistente mudar) e use o `stageConfig` retornado em todas as chamadas subsequentes de `/analyze`. O histórico completo fica disponível em `/runs/:account_id`.

---

## Setup

```bash
npm install
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY no .env
```

### Migration do banco (execute uma vez no SQL Editor do Supabase)

```sql
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

CREATE INDEX IF NOT EXISTS idx_analysis_runs_account_id  ON analysis_runs(account_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_analyzed_at ON analysis_runs(analyzed_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_analysis_conversations_run_id ON analysis_conversations(run_id);

CREATE TABLE IF NOT EXISTS analysis_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES analysis_conversations(id) ON DELETE CASCADE,
  stage            text NOT NULL,
  sender           text NOT NULL,
  event_timestamp  text,
  preview          text
);

CREATE INDEX IF NOT EXISTS idx_analysis_events_conv_id ON analysis_events(conversation_id);

ALTER TABLE funnel_configs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_events        ENABLE ROW LEVEL SECURITY;
```

## Executar

```bash
npm run dev   # desenvolvimento (auto-restart, Node 18+)
npm start     # produção
npm test      # rodar testes
```

---

## Endpoints

### `POST /funnel/build`

Lê o prompt do seu assistente e extrai as etapas do funil. Passe `account_id` para salvar o config no banco.

**Request:**
```json
{
  "prompt": "Você é um assistente de vendas da Clínica XPTO. Seu objetivo é saudar o cliente, identificar a queixa estética (flacidez, gordura, papada), apresentar os procedimentos disponíveis (Botox, Lipo, Lifting) e capturar o WhatsApp para agendamento.",
  "account_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

> `account_id` é **opcional**. Se omitido, retorna o `stageConfig` sem salvar no banco.

**Response:**
```json
{
  "stageConfig": {
    "stages": [
      { "code": "SAUDACAO",    "keywords": ["oi", "olá", "bom dia"],          "indicates_professional": false },
      { "code": "QUEIXA",      "keywords": ["flacidez", "gordura", "papada"], "indicates_professional": true  },
      { "code": "PROCEDIMENTO","keywords": ["botox", "lipo", "lifting"],       "indicates_professional": true  },
      { "code": "AGENDAMENTO", "keywords": ["whatsapp", "agendar"],            "indicates_professional": true  }
    ]
  },
  "cacheHit": false,
  "hash": "d41d8cd98f00b204e...",
  "config_id": "223e4567-e89b-12d3-a456-426614174001"
}
```

> `config_id` é `null` quando `account_id` não foi fornecido ou houve falha ao salvar (não bloqueia a resposta).

**Erros:**
| Status | Motivo |
|--------|--------|
| `400` | Campo `prompt` ausente ou vazio |
| `400` | `account_id` fornecido mas não é UUID válido |
| `500` | Falha na chamada OpenAI |

---

### `POST /analyze`

Analisa todas as conversas de uma conta e **persiste o resultado completo no Supabase automaticamente**.

**Request:**
```json
{
  "account_id": "123e4567-e89b-12d3-a456-426614174000",
  "stageConfig": {
    "stages": [
      { "code": "SAUDACAO",    "keywords": ["oi", "olá"],        "indicates_professional": false },
      { "code": "QUEIXA",      "keywords": ["flacidez", "papada"],"indicates_professional": true  },
      { "code": "INVESTIMENTO","keywords": ["R$ \\d+", "preço"],  "indicates_professional": true  }
    ]
  }
}
```

**Response:**
```json
{
  "meta": {
    "account_id": "123e4567-...",
    "analyzed_at": "2026-04-16T18:00:00.000Z",
    "total_chats": 509,
    "professional": 290,
    "personal": 219,
    "total_messages": 4586
  },
  "funnel": {
    "overview": { "total": 290 },
    "tracks": {
      "pure_ia":     { "count": 30,  "engagement_pct": 40.0 },
      "pure_human":  { "count": 193, "engagement_pct": 1.0  },
      "hybrid":      { "count": 65,  "engagement_pct": 49.2 },
      "no_outbound": { "count": 2,   "engagement_pct": 0.0  }
    },
    "stages": [
      { "code": "SAUDACAO",    "reach": 235, "reach_pct": 81.0, "by_ia": 44, "by_human": 191 },
      { "code": "QUEIXA",      "reach": 120, "reach_pct": 41.4, "by_ia": 80, "by_human": 40  },
      { "code": "INVESTIMENTO","reach": 55,  "reach_pct": 18.9, "by_ia": 30, "by_human": 25  }
    ],
    "conversion": [
      { "from": "SAUDACAO", "to": "QUEIXA", "rate_pct": 51.1 }
    ],
    "top_sequences": [
      { "sequence": "SAUDACAO>QUEIXA", "count": 85 }
    ],
    "anomalies": { "out_of_order_count": 12 }
  },
  "stage_config": { "stages": [ "..." ] },
  "report_md": "## Análise do Funil\n...",
  "run_id": "323e4567-e89b-12d3-a456-426614174002",
  "warnings": []
}
```

> `run_id` é o ID da execução persistida no banco — use para consultar detalhe via `GET /runs/:account_id/:run_id`. Se a persistência falhar (banco indisponível), `run_id` será `null` e `warnings` conterá a mensagem de erro — **a análise não é bloqueada**.

**Erros:**
| Status | Motivo |
|--------|--------|
| `400` | `account_id` ausente ou não é UUID válido |
| `400` | `stageConfig` ausente ou não é um objeto simples |
| `500` | Falha ao buscar dados do Supabase ou gerar relatório |

---

### `GET /configs/:account_id`

Retorna o `stageConfig` salvo para um cliente.

**Response:**
```json
{
  "id": "223e4567-...",
  "account_id": "123e4567-...",
  "prompt_hash": "d41d8cd...",
  "stage_config": { "stages": [ "..." ] },
  "created_at": "2026-04-16T12:00:00Z",
  "updated_at": "2026-04-16T12:00:00Z"
}
```

**Erros:** `400` (UUID inválido) · `404` (config não encontrado) · `503` (banco indisponível)

---

### `PUT /configs/:account_id`

Cria ou atualiza o `stageConfig` de um cliente manualmente (sem precisar chamar `/funnel/build`).

**Request:**
```json
{
  "stage_config": {
    "stages": [
      { "code": "SAUDACAO", "keywords": ["oi"], "indicates_professional": false }
    ]
  },
  "prompt_hash": "opcional-identificador"
}
```

**Erros:** `400` (UUID inválido ou `stage_config` inválido) · `503` (banco indisponível)

---

### `GET /runs/:account_id`

Lista o histórico de análises de um cliente, da mais recente para a mais antiga.

**Query params opcionais:**

| Param | Tipo | Descrição |
|-------|------|-----------|
| `from` | ISO date | Filtra execuções a partir desta data |
| `to` | ISO date | Filtra execuções até esta data |
| `limit` | number | Quantidade máxima (padrão: `50`) |
| `type` | string | Tipo de análise (padrão: `funnel`) |

**Response:** array de execuções resumidas (sem métricas detalhadas).

**Erros:** `400` (UUID inválido) · `503` (banco indisponível)

---

### `GET /runs/:account_id/:run_id`

Retorna o detalhe completo de uma execução: métricas, relatório, conversas classificadas e eventos de stage detectados.

**Erros:** `400` (UUID inválido) · `404` (run não encontrado) · `503` (banco indisponível)

---

### `GET /health`
```json
{ "ok": true }
```

### `GET /cache`
Lista todos os prompts cacheados localmente.

### `DELETE /cache/:hash`
Remove uma entrada do cache. Use quando o prompt do cliente mudar.

---

## Arquitetura

```
POST /funnel/build {prompt, account_id?}
  ├── prompt-parser.js   → OpenAI gpt-4o-mini → stageConfig
  ├── cache.js           → MD5 hash (cache local de performance)
  └── repository.js      → salva funnel_configs no Supabase (se account_id)

POST /analyze {account_id, stageConfig}
  ├── supabase.js        → busca wa_chats + wa_messages
  ├── filter.js          → classifica: professional | personal
  ├── stage-detector.js  → detecta etapas por regex dinâmica
  ├── metrics.js         → reach%, conversion, tracks, anomalias
  ├── report-writer.js   → gpt-4o-mini → relatório markdown
  └── repository.js      → persiste analysis_runs + conversations + events

GET  /configs/:id        → repository.getConfig()
PUT  /configs/:id        → repository.saveConfig()
GET  /runs/:id           → repository.getRuns()
GET  /runs/:id/:run_id   → repository.getRunDetail()
```

### Módulos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `server.js` | Rotas Express, validação de entrada |
| `prompt-parser.js` | Extrai `stages[]` do prompt via OpenAI Structured Outputs |
| `filter.js` | Classifica conversa como profissional ou pessoal |
| `stage-detector.js` | Detecta quais etapas foram atingidas em cada conversa |
| `metrics.js` | Agrega métricas de funil dinamicamente |
| `report-writer.js` | Gera relatório markdown com gpt-4o-mini |
| `cache.js` | Cache local de `stageConfig` por hash MD5 (performance) |
| `supabase.js` | Busca conversas/mensagens + helper `supabaseRequest` |
| `repository.js` | Persistência de configs e runs no Supabase |

### Schema do banco

| Tabela | Descrição |
|--------|-----------|
| `funnel_configs` | `stageConfig` por cliente (relação 1:1 com `account_id`) |
| `analysis_runs` | Uma linha por execução — métricas agregadas + relatório |
| `analysis_conversations` | Uma linha por conversa classificada |
| `analysis_events` | Um evento por stage detectada (drill-down máximo) |

---

## Custo por execução (LLM)

| Operação | Modelo | Tokens (aprox.) | Custo (aprox.) |
|----------|--------|-----------------|----------------|
| `/funnel/build` — novo prompt | gpt-4o-mini | ~3 000 in + 500 out | ~$0.0005 |
| `/funnel/build` — prompt cacheado | — | 0 | $0 |
| `/analyze` — relatório | gpt-4o-mini | ~600 in + 1 000 out | ~$0.0003 |

**Total por análise:** ~$0.0008 (primeiro build) / ~$0.0003 (análises subsequentes)

---

## Testes

```bash
npm test
```

| Arquivo de teste | Cobertura | Testes |
|-----------------|-----------|--------|
| `tests/cache.test.js` | hash, get/set/del, list | 7 |
| `tests/filter.test.js` | classificação PERSONAL/PROFESSIONAL com stages dinâmicos | 12 |
| `tests/stage-detector.test.js` | detecção de etapas, sender, furthest, track, edge cases | 17 |
| `tests/metrics.test.js` | reach, conversion, tracks, anomalias, edge cases | 10 |
| `tests/repository.test.js` | saveConfig, getConfig, saveRun, getRuns, getRunDetail | 16 |
| `tests/server.test.js` | integração HTTP (Supertest), novos endpoints, falha silenciosa | 37 |
| **Total** | | **99** |

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `SUPABASE_KEY` | ✅ | Chave de serviço (service_role) do Supabase |
| `OPENAI_API_KEY` | ✅ | Chave da API OpenAI |
| `PORT` | ❌ | Porta do servidor (padrão: `3000`) |
| `CACHE_DIR` | ❌ | Diretório do cache local (padrão: `./cache`) |
