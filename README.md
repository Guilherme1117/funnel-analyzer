# funnel-analyzer

REST API local para análise de funil de vendas de chatbots de IA (WhatsApp/Instagram/etc), usando dados de mensagens do Supabase. **100% agnóstico de nicho** — funciona com qualquer segmento (clínicas, imobiliárias, escolas, etc.) porque o próprio prompt do seu assistente define as etapas do funil. Os resultados de cada análise são **persistidos automaticamente no Supabase** — incluindo métricas agregadas, conversas classificadas e eventos de stage detectados — prontos para dashboards (Metabase, Grafana) ou consulta via API.

---

## Como funciona

O sistema opera em **duas etapas desacopladas**:

1. **`POST /funnel/build`** — Envia o prompt do seu assistente de IA com o `account_id` do cliente. O `gpt-4o-mini` lê o prompt e extrai automaticamente as etapas do funil (`stageConfig`), incluindo `indicates_professional` e `is_final_stage`, que é **salvo no Supabase** e **cacheado por hash** — prompt igual = zero custo de OpenAI.

2. **`POST /analyze`** — Envia `account_id` (obrigatório), `config_id` (opcional), e filtros de data opcionais (`start_date`, `end_date`). O backend busca o `stageConfig` salvo no banco (ou usa o `config_id` indicado), classifica cada conversa **localmente via regex** (sem LLM), gera relatório e **persiste tudo automaticamente**. A análise agora também retorna:
   - `final_stages_detected`
   - `final_stage_conversion_by_track`
   - `daily_track_volume`

> Quando o `stageConfig` traz `is_final_stage`, essa marcação explícita tem prioridade total. Configs antigos sem esse campo continuam funcionando com fallback heurístico.

> **Fluxo recomendado:** chame `/funnel/build` uma vez por prompt (quando o assistente mudar) e use o `config_id` retornado nas chamadas de `/analyze`. O histórico completo fica disponível em `/runs/:account_id`.

---

## Setup

```bash
npm install
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY e API_TOKEN no .env
```

> Para o schema do banco (migration SQL), consulte [docs/database-schema.md](docs/database-schema.md).

---

## Executar

```bash
npm run dev   # desenvolvimento (auto-restart, Node 18+)
npm start     # produção
npm test      # rodar testes
```

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `SUPABASE_KEY` | ✅ | Chave de serviço (service_role) do Supabase |
| `OPENAI_API_KEY` | ✅ | Chave da API OpenAI |
| `API_TOKEN` | ✅ | Token de autenticação Bearer para proteger a API |
| `PORT` | ❌ | Porta do servidor (padrão: `3000`) |
| `CACHE_DIR` | ❌ | Diretório do cache local (padrão: `./cache`) |

---

## Documentação

- [docs/database-schema.md](docs/database-schema.md) — Schema completo do banco (tabelas, índices, migration SQL)
- [docs/api-endpoints.md](docs/api-endpoints.md) — Referência completa de endpoints (request/response, erros)

---

## Arquitetura

```
POST /funnel/build {prompt, account_id?}
  ├── auth.js            → valida Bearer token (API_TOKEN)
  ├── prompt-parser.js   → OpenAI gpt-4o-mini → stageConfig (+ is_final_stage)
  ├── cache.js           → MD5 hash (cache local de performance)
  └── repository.js      → salva funnel_configs no Supabase (se account_id)

POST /analyze {account_id, config_id?, start_date?, end_date?}
  ├── auth.js            → valida Bearer token (API_TOKEN)
  ├── supabase.js        → busca wa_chats + wa_messages (com filtro de data)
  ├── filter.js          → classifica: professional | personal
  ├── stage-detector.js  → detecta etapas por regex dinâmica + dias ativos por conversa
  ├── metrics.js         → reach%, conversion, tracks, anomalias, final stages, série diária
  ├── report-writer.js   → gpt-4o-mini → relatório markdown
  ├── errors.js          → erros tipados e formatação padronizada
  └── repository.js      → persiste analysis_runs + conversations + events + custom_data

GET  /configs/:id        → repository.getConfig()
PUT  /configs/:id        → repository.saveConfig()
GET  /runs/:id           → repository.getRuns()
GET  /runs/:id/:run_id   → repository.getRunDetail()
```

### Módulos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `server.js` | Rotas Express, validação de entrada |
| `auth.js` | Middleware de autenticação via Bearer token |
| `errors.js` | Erros tipados e formatação padronizada de respostas de erro |
| `prompt-parser.js` | Extrai `stages[]` do prompt via OpenAI Structured Outputs, incluindo `is_final_stage` |
| `filter.js` | Classifica conversa como profissional ou pessoal |
| `stage-detector.js` | Detecta quais etapas foram atingidas em cada conversa |
| `metrics.js` | Agrega métricas de funil, conversão por stage final e volume diário por track |
| `report-writer.js` | Gera relatório markdown com gpt-4o-mini |
| `cache.js` | Cache local de `stageConfig` por hash MD5 (performance) |
| `supabase.js` | Busca conversas/mensagens + helper `supabaseRequest` |
| `repository.js` | Persistência de configs e runs no Supabase, incluindo `custom_data` analítico |

---

## Testes

```bash
npm test
```

---

## Custo por execução (LLM)

| Operação | Modelo | Tokens (aprox.) | Custo (aprox.) |
|----------|--------|-----------------|----------------|
| `/funnel/build` — novo prompt | gpt-4o-mini | ~3 000 in + 500 out | ~$0.0005 |
| `/funnel/build` — prompt cacheado | — | 0 | $0 |
| `/analyze` — relatório | gpt-4o-mini | ~600 in + 1 000 out | ~$0.0003 |

**Total por análise:** ~$0.0008 (primeiro build) / ~$0.0003 (análises subsequentes)
