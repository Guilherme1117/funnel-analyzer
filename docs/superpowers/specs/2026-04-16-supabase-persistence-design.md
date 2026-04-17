# Supabase Persistence & Funnel Config Management — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Persistência de análises + Gestão de stageConfigs no Supabase

---

## Objetivo

Conectar o funnel-analyzer ao Supabase para persistir:
1. **Resultados de análise** — métricas agregadas, conversas classificadas e eventos de stage, em todos os níveis de detalhe
2. **Configurações de funil (stageConfig)** — por conta de cliente, substituindo o cache local como fonte de verdade

Os dados devem ser consumíveis tanto via **dashboards SQL** (Metabase, Grafana) quanto via **endpoints da API** para integração com outras ferramentas.

## Contexto

### Arquitetura Atual
```
POST /funnel/build (prompt) → prompt-parser.js → LLM → stageConfig (cache local JSON)
POST /analyze (account_id + stageConfig) → supabase.js (lê wa_chats/wa_messages)
    → filter.js → stage-detector.js → metrics.js → report-writer.js → JSON response
```

### Problemas
- Nenhum resultado de análise é salvo — perde-se após a resposta HTTP
- stageConfig fica em cache local (volátil, não compartilhável)
- Sem histórico de execuções para dashboards ou comparações temporais
- Sem estrutura para análises customizadas futuras (plugins)

### Premissas
- Cada cliente tem um `account_id` UUID único que o identifica
- Relação 1:1 entre cliente e stageConfig (um funil por conta)
- Análises customizadas futuras analisarão as mesmas conversas WhatsApp (wa_chats/wa_messages) mas com lógicas e saídas diferentes

---

## Schema do Banco de Dados

### Tabela `funnel_configs`

Persiste o stageConfig de cada cliente. Substitui o cache local como fonte de verdade.

| Coluna | Tipo | Constraints | Descrição |
|--------|------|-------------|-----------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Identificador único |
| `account_id` | `uuid` | UNIQUE, NOT NULL | Vínculo 1:1 com a conta do cliente |
| `prompt_hash` | `text` | NOT NULL | Hash MD5 do prompt que gerou esta config |
| `stage_config` | `jsonb` | NOT NULL | Objeto `{stages: [...]}` completo |
| `created_at` | `timestamptz` | default `now()` | Criação |
| `updated_at` | `timestamptz` | default `now()` | Última atualização |

**Índices:** `account_id` (unique).

### Tabela `analysis_runs`

Uma linha por execução do `/analyze`. Contém métricas agregadas.

| Coluna | Tipo | Constraints | Descrição |
|--------|------|-------------|-----------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Identificador da execução |
| `account_id` | `uuid` | NOT NULL | Conta analisada |
| `funnel_config_id` | `uuid` | FK → `funnel_configs.id` | Config usada nesta execução |
| `analysis_type` | `text` | NOT NULL, default `'funnel'` | Tipo da análise (`funnel` = padrão, plugins usam outros valores) |
| `total_chats` | `int` | NOT NULL | Total de chats encontrados |
| `professional_count` | `int` | NOT NULL | Conversas profissionais |
| `personal_count` | `int` | NOT NULL | Conversas pessoais filtradas |
| `total_messages` | `int` | NOT NULL | Total de mensagens processadas |
| `tracks` | `jsonb` | | `{pure_ia, pure_human, hybrid, no_outbound}` com count e engagement_pct |
| `stages_summary` | `jsonb` | | Array de stages com reach, reach_pct, by_ia, by_human |
| `conversion` | `jsonb` | | Array de pares from→to com rate_pct |
| `top_sequences` | `jsonb` | | Top 15 sequências observadas |
| `anomalies` | `jsonb` | | Contagem de anomalias |
| `report_md` | `text` | | Relatório gerado pelo LLM |
| `custom_data` | `jsonb` | | Reservado para plugins futuros |
| `analyzed_at` | `timestamptz` | NOT NULL, default `now()` | Timestamp da execução |

**Índices:** `account_id`, `analyzed_at DESC`, `analysis_type`.

### Tabela `analysis_conversations`

Uma linha por conversa analisada (drill-down por chat).

| Coluna | Tipo | Constraints | Descrição |
|--------|------|-------------|-----------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `run_id` | `uuid` | FK → `analysis_runs.id` ON DELETE CASCADE, NOT NULL | Execução que gerou este registro |
| `chat_id` | `uuid` | NOT NULL | ID do chat original (wa_chats) |
| `msg_count` | `int` | NOT NULL | Total de mensagens |
| `inbound_count` | `int` | NOT NULL | Mensagens do paciente |
| `track` | `text` | NOT NULL | `pure_ia`, `pure_human`, `hybrid`, `no_outbound` |
| `furthest_stage` | `text` | | Stage mais avançada atingida |
| `stages` | `text[]` | | Array de stage codes na ordem detectada |
| `outbound_ia` | `int` | NOT NULL, default 0 | Mensagens da IA |
| `outbound_human` | `int` | NOT NULL, default 0 | Mensagens de humano |

**Índices:** `run_id`, `chat_id`.

### Tabela `analysis_events`

Uma linha por evento de stage detectado (nível máximo de detalhe).

| Coluna | Tipo | Constraints | Descrição |
|--------|------|-------------|-----------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `conversation_id` | `uuid` | FK → `analysis_conversations.id` ON DELETE CASCADE, NOT NULL | |
| `stage` | `text` | NOT NULL | Código da stage detectada |
| `sender` | `text` | NOT NULL | `IA`, `HUMAN`, `PATIENT` |
| `event_timestamp` | `text` | | Timestamp do evento original |
| `preview` | `text` | | Primeiros 80 chars da mensagem |

**Índices:** `conversation_id`.

### Relacionamentos
```
funnel_configs (1) ←──→ (N) analysis_runs
analysis_runs  (1) ←──→ (N) analysis_conversations
analysis_conversations (1) ←──→ (N) analysis_events
```

Cascade delete em `analysis_conversations` e `analysis_events` — se uma `analysis_run` for deletada, seus detalhes vão junto.

---

## Mudanças na Aplicação

### Novo módulo: `src/repository.js`

Centraliza toda a persistência. Nenhum outro módulo faz escrita direta no banco.

**Funções:**
- `saveConfig(accountId, promptHash, stageConfig)` → upsert na `funnel_configs` (insert ou update se account_id já existe)
- `getConfig(accountId)` → busca stageConfig salvo para um cliente
- `saveRun({ accountId, configId, meta, metrics, classified, reportMd })` → insere `analysis_runs` + `analysis_conversations` + `analysis_events` em batch
- `getRuns(accountId, { from, to, limit, analysisType })` → lista execuções com filtros
- `getRunDetail(runId)` → retorna execução + conversas + eventos

Usa fetch direto na REST API do Supabase (mesma abordagem do `supabase.js` existente).

### Mudanças em módulos existentes

| Módulo | Mudança |
|--------|---------|
| `server.js` | Após `/analyze` computar resultado, chama `repository.saveRun()`. Novos endpoints de consulta. |
| `prompt-parser.js` | Sem mudança na lógica. O `/funnel/build` no server.js chama `repository.saveConfig()` após parsear. |
| `cache.js` | Sem mudança. Continua como cache de performance. Banco é fonte de verdade. |
| `filter.js` | Sem mudança |
| `stage-detector.js` | Sem mudança |
| `metrics.js` | Sem mudança |
| `report-writer.js` | Sem mudança |

### Novos endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/configs/:account_id` | Retorna o stageConfig salvo para um cliente |
| `PUT` | `/configs/:account_id` | Atualiza o stageConfig (regenera via prompt ou envia direto) |
| `GET` | `/runs/:account_id` | Lista histórico de análises. Query params: `from`, `to`, `limit`, `type` |
| `GET` | `/runs/:account_id/:run_id` | Detalhe de uma execução com conversas e eventos |

### Fluxo atualizado do `/analyze`

```
POST /analyze {account_id, stageConfig}
  │
  ├─ fetchConversations(account_id)        ← sem mudança
  ├─ isProfessional(msgs, stageConfig)     ← sem mudança
  ├─ classifyConversations(chatMap)        ← sem mudança
  ├─ computeMetrics(classified)            ← sem mudança
  ├─ generateReport(metrics)               ← sem mudança
  │
  ├─ repository.saveRun({...})             ← NOVO: persiste tudo no banco
  │     Falha aqui → loga erro, adiciona warning, NÃO bloqueia a response
  │
  └─ resposta JSON (igual à atual + run_id + warnings se houver)
```

### Fluxo atualizado do `/funnel/build`

```
POST /funnel/build {prompt, account_id?}
  │
  ├─ cache.get(hash) / parsePrompt(prompt) ← sem mudança
  │
  ├─ se account_id fornecido:
  │     repository.saveConfig(...)          ← NOVO: persiste no banco
  │     Falha aqui → loga erro, NÃO bloqueia
  │
  └─ resposta JSON (igual + config_id se salvo)
```

---

## Segurança

- **RLS habilitado** em todas as 4 novas tabelas
- Backend usa `SUPABASE_KEY` (service role) que tem bypass de RLS por padrão
- Para acesso direto futuro (frontend com auth), adicionar policies `account_id = auth.uid()` sem mudar schema

## Tratamento de Erros

**Princípio:** A persistência não bloqueia a resposta da análise.

- `/analyze`: se `saveRun()` falhar, retorna o resultado normalmente com campo `warnings: ["persist_failed: <mensagem>"]`
- `/funnel/build`: se `saveConfig()` falhar, retorna o stageConfig normalmente e loga o erro
- `GET /configs`, `GET /runs`: se banco indisponível, retorna 503 com mensagem clara

## Testes

| Camada | Escopo | Método |
|--------|--------|--------|
| `repository.js` | Funções de persistência e query | Testes unitários com mock do fetch |
| Endpoints novos | `GET/PUT /configs`, `GET /runs` | Testes de integração com supertest |
| `/analyze` + persist | Response não muda, `saveRun` é chamado | Mock do repository |
| Falha de persistência | Erro no banco não gera 500 | Mock com erro, verifica 200 + warnings |

Testes existentes (filter, stage-detector, metrics) **não são alterados** — cobrem lógica que não muda.

---

## Fora de Escopo

- Automação/agendamento de análises (sub-projeto futuro)
- Frontend ou dashboard (consumo dos dados é externo)
- Análises customizadas/plugins (estrutura `analysis_type` + `custom_data` suporta, implementação é futura)
- Migração de dados de análises já executadas
