# funnel-analyzer

REST API local para análise de funil de vendas de chatbots de IA (WhatsApp/Instagram/etc), usando dados de mensagens do Supabase. **100% agnóstico de nicho** — funciona com qualquer segmento (clínicas, imobiliárias, escolas, etc.) porque o próprio prompt do seu assistente define as etapas do funil.

## Como funciona

O sistema opera em **duas etapas desacopladas**:

1. **`POST /funnel/build`** — Envia o prompt do seu assistente de IA uma única vez. O `gpt-4o-mini` lê o prompt e extrai automaticamente as etapas do funil (`stageConfig`). O resultado é **cacheado por hash** — prompt igual = zero custo de OpenAI.

2. **`POST /analyze`** — Envia `account_id` + o `stageConfig` recebido acima. O backend busca todas as conversas do Supabase e classifica cada uma **localmente via regex**, sem nenhuma chamada de LLM. Rápido e barato.

> **Fluxo recomendado:** chame `/funnel/build` quando o prompt mudar e salve o `stageConfig` no seu banco. Use o `stageConfig` salvo em todas as chamadas subsequentes de `/analyze`.

---

## Setup

```bash
npm install
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY no .env
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

Lê o prompt do seu assistente e extrai as etapas do funil. Chame **uma vez por prompt**; salve o `stageConfig` retornado.

**Request:**
```json
{
  "prompt": "Você é um assistente de vendas da Clínica XPTO. Seu objetivo é saudar o cliente, identificar a queixa estética (flacidez, gordura, papada), apresentar os procedimentos disponíveis (Botox, Lipo, Lifting) e capturar o WhatsApp para agendamento."
}
```

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
  "hash": "d41d8cd98f00b204e..."
}
```

> **Como interpretar:** cada item de `stages` é uma etapa detectada pelo LLM na ordem em que aparecem no funil. O campo `indicates_professional` determina se uma conversa com esse sinal é classificada como profissional (vs. pessoal/spam).

**Erros:**
| Status | Motivo |
|--------|--------|
| `400` | Campo `prompt` ausente ou vazio |
| `500` | Falha na chamada OpenAI |

---

### `POST /analyze`

Analisa todas as conversas de uma conta usando o `stageConfig` já construído. **Não faz chamadas de LLM para detecção de estágios.**

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
    "analyzed_at": "2026-04-15T18:00:00.000Z",
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
    "anomalies": {
      "out_of_order_count": 12
    }
  },
  "stage_config": { "stages": [ ... ] },
  "report_md": "## Análise do Funil\n..."
}
```

**Erros:**
| Status | Motivo |
|--------|--------|
| `400` | `account_id` ausente ou não é UUID válido |
| `400` | `stageConfig` ausente ou não é um objeto simples |
| `500` | Falha ao buscar dados do Supabase ou gerar relatório |

---

### `GET /health`
```json
{ "ok": true }
```

### `GET /cache`
Lista todos os prompts cacheados.
```json
[
  { "hash": "d41d8c...", "created_at": "2026-04-15T12:00:00.000Z", "size_bytes": 312 }
]
```

### `DELETE /cache/:hash`
Remove uma entrada do cache. Use quando o prompt do cliente mudar e você quiser forçar um novo parse.

---

## Arquitetura

```
POST /funnel/build
  └── prompt-parser.js   → OpenAI gpt-4o-mini (Structured Output: { stages[] })
                         → cache.js (MD5 hash, in-memory)

POST /analyze
  ├── supabase.js        → busca chats + mensagens
  ├── filter.js          → classifica cada chat: professional | personal
  │                        (Tier 1: tem IA? Tier 2: keyword de stage profissional?)
  ├── stage-detector.js  → detecta etapas alcançadas em cada chat (regex dinâmica)
  ├── metrics.js         → calcula reach%, conversion, tracks, anomalias
  └── report-writer.js   → gpt-4o-mini gera relatório markdown (~$0.0003)
```

### Módulos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `server.js` | Rotas Express, validação de entrada |
| `prompt-parser.js` | Extrai `stages[]` do prompt via OpenAI Structured Outputs |
| `filter.js` | Classifica conversa como profissional ou pessoal via `stages[].indicates_professional` |
| `stage-detector.js` | Detecta quais etapas foram atingidas em cada conversa |
| `metrics.js` | Agrega métricas de funil dinamicamente |
| `report-writer.js` | Gera relatório markdown com gpt-4o-mini |
| `cache.js` | Cache in-memory de `stageConfig` por hash MD5 do prompt |
| `supabase.js` | Busca conversas e mensagens da conta |

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
| `tests/server.test.js` | integração HTTP (Supertest), validações de entrada | 10 |
| **Total** | | **56** |

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `SUPABASE_KEY` | ✅ | Chave de serviço (service_role) do Supabase |
| `OPENAI_API_KEY` | ✅ | Chave da API OpenAI |
| `PORT` | ❌ | Porta do servidor (padrão: `3000`) |
