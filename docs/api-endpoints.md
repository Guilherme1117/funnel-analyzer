# API Endpoints — Funnel Analyzer

Base URL: `http://localhost:3000` (ou o endereço do seu servidor)

> **Autenticação:** Todas as rotas, exceto `GET /health`, exigem o header:
> ```
> Authorization: Bearer <API_TOKEN>
> ```
> O valor de `API_TOKEN` é definido no arquivo `.env`.

---

## Índice

- [GET /health](#get-health)
- [POST /funnel/build](#post-funnelbuild)
- [POST /analyze](#post-analyze)
- [GET /configs/:account_id](#get-configsaccount_id)
- [PUT /configs/:account_id](#put-configsaccount_id)
- [GET /runs/:account_id](#get-runsaccount_id)
- [GET /runs/:account_id/:run_id](#get-runsaccount_idrun_id)
- [GET /cache](#get-cache)
- [DELETE /cache/:hash](#delete-cachehash)
- [Formato padrão de erros](#formato-padrão-de-erros)

---

## GET /health

Verifica se a API está no ar. Não requer autenticação.

**curl**
```bash
curl http://localhost:3000/health
```

**Resposta — 200 OK**
```json
{ "ok": true }
```

---

## POST /funnel/build

Recebe o prompt do assistente de IA, extrai as etapas do funil de vendas usando GPT-4o-mini e armazena a configuração em cache local. Se `account_id` for fornecido, a configuração também é salva no banco de dados (tabela `funnel_configs`) e o `config_id` gerado é retornado.

**curl**
```bash
curl -X POST http://localhost:3000/funnel/build \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Você é um assistente de uma clínica odontológica...",
    "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }'
```

**Body**

| Campo        | Tipo   | Obrigatório | Descrição                                                              |
|--------------|--------|-------------|------------------------------------------------------------------------|
| `prompt`     | string | Sim         | Texto do system prompt do assistente de IA a ser analisado             |
| `account_id` | uuid   | Não         | ID da conta; quando fornecido, persiste a configuração no banco de dados |

**Resposta — 200 OK**
```json
{
  "stageConfig": {
    "stages": [
      {
        "code": "SAUDACAO",
        "keywords": ["olá", "boa tarde", "bem-vindo"],
        "indicates_professional": false,
        "is_final_stage": false
      },
      {
        "code": "QUEIXA",
        "keywords": ["dor de dente", "problema", "consulta"],
        "indicates_professional": true,
        "is_final_stage": false
      },
      {
        "code": "INVESTIMENTO",
        "keywords": ["valor", "preço", "quanto custa"],
        "indicates_professional": true,
        "is_final_stage": true
      }
    ]
  },
  "cacheHit": false,
  "hash": "d41d8cd98f00b204e9800998ecf8427e",
  "config_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901"
}
```

> `cacheHit: true` indica que o resultado veio do cache local (sem chamada à OpenAI).
> `config_id` será `null` se `account_id` não foi fornecido ou se a persistência falhou.
> `is_final_stage` é gerado no `stageConfig` para marcar explicitamente quais etapas contam como conversão final. Configs antigos sem esse campo continuam funcionando com fallback heurístico no `/analyze`.

**Erros**

| Status | Code               | Motivo                                                              |
|--------|--------------------|---------------------------------------------------------------------|
| 400    | `VALIDATION_ERROR` | `prompt` ausente, vazio ou não é uma string                         |
| 400    | `VALIDATION_ERROR` | `account_id` fornecido mas não é um UUID válido                     |
| 401    | `AUTH_ERROR`       | Header `Authorization` ausente ou token inválido                    |
| 500    | `INTERNAL_ERROR`   | Falha na chamada à OpenAI ou outro erro interno do servidor         |

---

## POST /analyze

Analisa as conversas do WhatsApp de uma conta usando uma configuração de funil salva no banco de dados. Classifica cada conversa por etapas do funil, calcula métricas e gera um relatório em Markdown. O resultado da execução é persistido para consultas futuras.

**Resolução da configuração:**
1. Se `config_id` for fornecido, ele tem prioridade — a configuração é buscada diretamente pelo ID.
2. Se apenas `account_id` for fornecido, é usada a última configuração salva para essa conta.

**Filtragem por data:**
- `start_date` e `end_date` devem ser fornecidos juntos ou nenhum dos dois.
- Quando fornecidos, filtram mensagens em `wa_messages.created_at` dentro do intervalo `[start_date, end_date]`.
- Quando omitidos, todas as conversas disponíveis são analisadas.

**curl**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "config_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:59Z"
  }'
```

**Body**

| Campo        | Tipo   | Obrigatório | Descrição                                                                         |
|--------------|--------|-------------|-----------------------------------------------------------------------------------|
| `account_id` | uuid   | Sim         | ID da conta cujas conversas serão analisadas                                      |
| `config_id`  | uuid   | Não         | ID da configuração de funil a usar; tem prioridade sobre a config salva da conta  |
| `start_date` | string | Não*        | Data de início do filtro (ISO 8601). Deve ser fornecido junto com `end_date`      |
| `end_date`   | string | Não*        | Data de fim do filtro (ISO 8601). Deve ser fornecido junto com `start_date`       |

\* `start_date` e `end_date` são opcionais, mas devem ser fornecidos em par.

**Resposta — 200 OK**
```json
{
  "meta": {
    "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "analyzed_at": "2024-02-01T10:30:00.000Z",
    "total_chats": 320,
    "professional": 210,
    "personal": 110,
    "total_messages": 4850,
    "period": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-01-31T23:59:59Z"
    }
  },
  "funnel": {
    "overview": { "total": 210 },
    "tracks": {
      "pure_ia":     { "count": 90,  "with_last_stage": 60, "engagement_pct": 66.7 },
      "pure_human":  { "count": 30,  "with_last_stage": 20, "engagement_pct": 66.7 },
      "hybrid":      { "count": 70,  "with_last_stage": 55, "engagement_pct": 78.6 },
      "no_outbound": { "count": 20,  "with_last_stage": 5,  "engagement_pct": 25.0 }
    },
    "stages": [
      { "code": "SAUDACAO",    "reach": 210, "reach_pct": 100.0, "by_ia": 200, "by_human": 10 },
      { "code": "QUEIXA",      "reach": 180, "reach_pct": 85.7,  "by_ia": 150, "by_human": 30 },
      { "code": "INVESTIMENTO","reach": 90,  "reach_pct": 42.9,  "by_ia": 60,  "by_human": 30 }
    ],
    "conversion": [
      { "from": "SAUDACAO", "to": "QUEIXA",       "rate_pct": 85.7 },
      { "from": "QUEIXA",   "to": "INVESTIMENTO", "rate_pct": 50.0 }
    ],
    "final_stages_detected": [
      {
        "stage_code": "AGENDAMENTO",
        "stage_label": "AGENDAMENTO",
        "stage_index": 3,
        "reason": "explicit_is_final_stage",
        "score": 100,
        "converted_count": 74
      },
      {
        "stage_code": "CONFIRMACAO_AGENDAMENTO",
        "stage_label": "CONFIRMACAO_AGENDAMENTO",
        "stage_index": 4,
        "reason": "explicit_is_final_stage",
        "score": 100,
        "converted_count": 51
      }
    ],
    "final_stage_conversion_by_track": [
      {
        "stage_code": "AGENDAMENTO",
        "stage_label": "AGENDAMENTO",
        "stage_index": 3,
        "tracks": {
          "pure_ia":    { "total_conversations": 90, "converted_conversations": 30, "conversion_pct": 33.3 },
          "pure_human": { "total_conversations": 30, "converted_conversations": 8,  "conversion_pct": 26.7 },
          "hybrid":     { "total_conversations": 70, "converted_conversations": 36, "conversion_pct": 51.4 }
        }
      }
    ],
    "daily_track_volume": [
      { "date": "2024-01-10", "pure_ia": 12, "pure_human": 4, "hybrid": 8 },
      { "date": "2024-01-11", "pure_ia": 9,  "pure_human": 6, "hybrid": 10 }
    ],
    "top_sequences": [
      { "sequence": "SAUDACAO>QUEIXA>INVESTIMENTO", "count": 85 },
      { "sequence": "SAUDACAO>QUEIXA",              "count": 60 },
      { "sequence": "NONE",                          "count": 20 }
    ],
    "anomalies": { "out_of_order_count": 7 }
  },
  "stage_config": {
    "stages": [
      { "code": "SAUDACAO",    "keywords": ["olá", "boa tarde"],  "indicates_professional": false, "is_final_stage": false },
      { "code": "QUEIXA",      "keywords": ["dor", "problema"],   "indicates_professional": true,  "is_final_stage": false },
      { "code": "INVESTIMENTO","keywords": ["preço", "valor"],    "indicates_professional": true,  "is_final_stage": true  }
    ]
  },
  "report_md": "# Relatório de Funil\n\n## Resumo\n...",
  "run_id": "c3d4e5f6-a7b8-9012-cdef-123456789012"
}
```

> `meta.period` é `null` quando nenhum filtro de data foi aplicado.
> O campo `warnings` pode aparecer na resposta quando a persistência do run falha, mas a análise foi concluída com sucesso.
> `final_stages_detected` mostra quais etapas finais foram usadas na análise. Quando o `stage_config` contém `is_final_stage: true`, essa marcação explícita tem prioridade total. A inferência automática fica como fallback para configs legados.
> `daily_track_volume` contabiliza chats com atividade por dia no intervalo filtrado, separados em `pure_ia`, `pure_human` e `hybrid`.

**Erros**

| Status | Code                | Motivo                                                                                              |
|--------|---------------------|-----------------------------------------------------------------------------------------------------|
| 400    | `VALIDATION_ERROR`  | `account_id` ausente ou não é um UUID válido                                                        |
| 400    | `VALIDATION_ERROR`  | `config_id` fornecido mas não é um UUID válido                                                      |
| 400    | `VALIDATION_ERROR`  | Apenas um dos dois — `start_date` ou `end_date` — foi fornecido                                     |
| 400    | `VALIDATION_ERROR`  | `start_date` não é uma string de data ISO 8601 válida                                               |
| 400    | `VALIDATION_ERROR`  | `end_date` não é uma string de data ISO 8601 válida                                                 |
| 400    | `CONFIG_NOT_FOUND`  | Nenhuma configuração de funil encontrada para a conta; use `POST /funnel/build` ou forneça `config_id` |
| 401    | `AUTH_ERROR`        | Header `Authorization` ausente ou token inválido                                                    |
| 404    | `NOT_FOUND`         | `config_id` fornecido não foi encontrado no banco de dados                                          |
| 500    | `INTERNAL_ERROR`    | Falha ao buscar conversas ou outro erro interno do servidor                                         |

---

## GET /configs/:account_id

Retorna a configuração de funil mais recente salva para uma conta.

**curl**
```bash
curl http://localhost:3000/configs/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer $API_TOKEN"
```

**Parâmetros de rota**

| Parâmetro    | Tipo | Obrigatório | Descrição           |
|--------------|------|-------------|---------------------|
| `account_id` | uuid | Sim         | ID da conta         |

**Resposta — 200 OK**
```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "prompt_hash": "d41d8cd98f00b204e9800998ecf8427e",
  "stage_config": {
    "stages": [
      { "code": "SAUDACAO",    "keywords": ["olá", "boa tarde"], "indicates_professional": false, "is_final_stage": false },
      { "code": "QUEIXA",      "keywords": ["dor", "problema"],  "indicates_professional": true,  "is_final_stage": false },
      { "code": "INVESTIMENTO","keywords": ["preço", "valor"],   "indicates_professional": true,  "is_final_stage": true  }
    ]
  },
  "created_at": "2024-01-15T09:00:00.000Z",
  "updated_at": "2024-01-20T14:30:00.000Z"
}
```

**Erros**

| Status | Code               | Motivo                                               |
|--------|--------------------|------------------------------------------------------|
| 400    | `VALIDATION_ERROR` | `account_id` não é um UUID válido                    |
| 401    | `AUTH_ERROR`       | Header `Authorization` ausente ou token inválido     |
| 404    | `NOT_FOUND`        | Nenhuma configuração encontrada para este `account_id` |
| 503    | `DATABASE_ERROR`   | Banco de dados indisponível                          |

---

## PUT /configs/:account_id

Cria ou atualiza (upsert) a configuração de funil de uma conta. Apenas uma configuração é mantida por conta — chamadas subsequentes sobrescrevem a anterior.

**curl**
```bash
curl -X PUT http://localhost:3000/configs/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "stage_config": {
      "stages": [
        { "code": "SAUDACAO",    "keywords": ["olá", "oi"],   "indicates_professional": false, "is_final_stage": false },
        { "code": "QUEIXA",      "keywords": ["problema"],    "indicates_professional": true,  "is_final_stage": false },
        { "code": "AGENDAMENTO", "keywords": ["agendar", "horário"], "indicates_professional": true, "is_final_stage": true }
      ]
    },
    "prompt_hash": "manual"
  }'
```

**Parâmetros de rota**

| Parâmetro    | Tipo | Obrigatório | Descrição   |
|--------------|------|-------------|-------------|
| `account_id` | uuid | Sim         | ID da conta |

**Body**

| Campo         | Tipo   | Obrigatório | Descrição                                                                         |
|---------------|--------|-------------|-----------------------------------------------------------------------------------|
| `stage_config`| objeto | Sim         | Objeto contendo obrigatoriamente um array `stages`; cada stage pode informar `is_final_stage` para marcar conversão final |
| `prompt_hash` | string | Não         | Hash do prompt de origem. Padrão: `"manual"` quando a configuração é feita à mão |

**Resposta — 200 OK**
```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updated_at": "2024-02-01T11:00:00.000Z"
}
```

**Erros**

| Status | Code               | Motivo                                                                           |
|--------|--------------------|----------------------------------------------------------------------------------|
| 400    | `VALIDATION_ERROR` | `account_id` não é um UUID válido                                                |
| 400    | `VALIDATION_ERROR` | `stage_config` ausente, não é um objeto ou não contém um array `stages`         |
| 401    | `AUTH_ERROR`       | Header `Authorization` ausente ou token inválido                                 |
| 503    | `DATABASE_ERROR`   | Banco de dados indisponível                                                      |

---

## GET /runs/:account_id

Lista o histórico de execuções de análise de uma conta, da mais recente para a mais antiga. Suporta filtragem por data, tipo de análise e paginação via `limit`.

**curl**
```bash
curl "http://localhost:3000/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890?from=2024-01-01&limit=10" \
  -H "Authorization: Bearer $API_TOKEN"
```

**Parâmetros de rota**

| Parâmetro    | Tipo | Obrigatório | Descrição   |
|--------------|------|-------------|-------------|
| `account_id` | uuid | Sim         | ID da conta |

**Query params**

| Parâmetro | Tipo   | Obrigatório | Descrição                                                             |
|-----------|--------|-------------|-----------------------------------------------------------------------|
| `from`    | string | Não         | Data de início do filtro (ISO 8601); filtra `analyzed_at >= from`     |
| `to`      | string | Não         | Data de fim do filtro (ISO 8601); filtra `analyzed_at <= to`          |
| `limit`   | número | Não         | Máximo de registros retornados. Padrão: `50`                          |
| `type`    | string | Não         | Filtra por tipo de análise (ex.: `funnel`)                            |

**Resposta — 200 OK**
```json
[
  {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "analysis_type": "funnel",
    "total_chats": 320,
    "professional_count": 210,
    "personal_count": 110,
    "total_messages": 4850,
    "analyzed_at": "2024-01-31T10:30:00.000Z"
  }
]
```

**Erros**

| Status | Code               | Motivo                                               |
|--------|--------------------|------------------------------------------------------|
| 400    | `VALIDATION_ERROR` | `account_id` não é um UUID válido                    |
| 400    | `VALIDATION_ERROR` | `from` não é uma data ISO 8601 válida                |
| 400    | `VALIDATION_ERROR` | `to` não é uma data ISO 8601 válida                  |
| 400    | `VALIDATION_ERROR` | `limit` não é um número positivo                     |
| 401    | `AUTH_ERROR`       | Header `Authorization` ausente ou token inválido     |
| 503    | `DATABASE_ERROR`   | Banco de dados indisponível                          |

---

## GET /runs/:account_id/:run_id

Retorna o detalhe completo de uma execução de análise específica, incluindo todas as conversas classificadas e os eventos de estágio de cada uma.

**curl**
```bash
curl "http://localhost:3000/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/c3d4e5f6-a7b8-9012-cdef-123456789012" \
  -H "Authorization: Bearer $API_TOKEN"
```

**Parâmetros de rota**

| Parâmetro    | Tipo | Obrigatório | Descrição              |
|--------------|------|-------------|------------------------|
| `account_id` | uuid | Sim         | ID da conta            |
| `run_id`     | uuid | Sim         | ID da execução         |

**Resposta — 200 OK**
```json
{
  "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "funnel_config_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "analysis_type": "funnel",
  "total_chats": 320,
  "professional_count": 210,
  "personal_count": 110,
  "total_messages": 4850,
  "tracks": { "pure_ia": { "count": 90 }, "hybrid": { "count": 70 } },
  "stages_summary": [
    { "code": "SAUDACAO", "reach": 210, "reach_pct": 100.0, "by_ia": 200, "by_human": 10 }
  ],
  "conversion": [
    { "from": "SAUDACAO", "to": "QUEIXA", "rate_pct": 85.7 }
  ],
  "custom_data": {
    "final_stages_detected": [
      {
        "stage_code": "AGENDAMENTO",
        "stage_label": "AGENDAMENTO",
        "stage_index": 3,
        "reason": "explicit_is_final_stage",
        "score": 100,
        "converted_count": 74
      }
    ],
    "final_stage_conversion_by_track": [
      {
        "stage_code": "AGENDAMENTO",
        "stage_label": "AGENDAMENTO",
        "stage_index": 3,
        "tracks": {
          "pure_ia":    { "total_conversations": 90, "converted_conversations": 30, "conversion_pct": 33.3 },
          "pure_human": { "total_conversations": 30, "converted_conversations": 8,  "conversion_pct": 26.7 },
          "hybrid":     { "total_conversations": 70, "converted_conversations": 36, "conversion_pct": 51.4 }
        }
      }
    ],
    "daily_track_volume": [
      { "date": "2024-01-10", "pure_ia": 12, "pure_human": 4, "hybrid": 8 }
    ]
  },
  "top_sequences": [
    { "sequence": "SAUDACAO>QUEIXA>INVESTIMENTO", "count": 85 }
  ],
  "anomalies": { "out_of_order_count": 7 },
  "report_md": "# Relatório de Funil\n\n## Resumo\n...",
  "analyzed_at": "2024-01-31T10:30:00.000Z",
  "conversations": [
    {
      "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
      "run_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "chat_id": "5511999990001@c.us",
      "msg_count": 24,
      "inbound_count": 12,
      "track": "hybrid",
      "furthest_stage": "INVESTIMENTO",
      "stages": ["SAUDACAO", "QUEIXA", "INVESTIMENTO"],
      "outbound_ia": 8,
      "outbound_human": 4,
      "analysis_events": [
        {
          "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
          "conversation_id": "d4e5f6a7-b8c9-0123-defa-234567890123",
          "stage": "SAUDACAO",
          "sender": "IA",
          "event_timestamp": "2024-01-15T09:01:00.000Z",
          "preview": "Olá! Bem-vindo à Clínica..."
        }
      ]
    }
  ]
}
```

**Erros**

| Status | Code               | Motivo                                               |
|--------|--------------------|------------------------------------------------------|
| 400    | `VALIDATION_ERROR` | `account_id` não é um UUID válido                    |
| 400    | `VALIDATION_ERROR` | `run_id` não é um UUID válido                        |
| 401    | `AUTH_ERROR`       | Header `Authorization` ausente ou token inválido     |
| 404    | `NOT_FOUND`        | Execução não encontrada para o `run_id` informado    |
| 503    | `DATABASE_ERROR`   | Banco de dados indisponível                          |

---

## GET /cache

Lista todos os prompts atualmente armazenados no cache local (arquivos JSON no diretório `cache/`).

**curl**
```bash
curl http://localhost:3000/cache \
  -H "Authorization: Bearer $API_TOKEN"
```

**Resposta — 200 OK**
```json
[
  {
    "hash": "d41d8cd98f00b204e9800998ecf8427e",
    "created_at": "2024-01-15T09:00:00.000Z",
    "size_bytes": 842
  },
  {
    "hash": "098f6bcd4621d373cade4e832627b4f6",
    "created_at": "2024-01-20T14:30:00.000Z",
    "size_bytes": 1104
  }
]
```

**Erros**

| Status | Code         | Motivo                                           |
|--------|--------------|--------------------------------------------------|
| 401    | `AUTH_ERROR` | Header `Authorization` ausente ou token inválido |

---

## DELETE /cache/:hash

Remove uma entrada específica do cache local pelo hash MD5 do prompt.

**curl**
```bash
curl -X DELETE http://localhost:3000/cache/d41d8cd98f00b204e9800998ecf8427e \
  -H "Authorization: Bearer $API_TOKEN"
```

**Parâmetros de rota**

| Parâmetro | Tipo   | Obrigatório | Descrição                        |
|-----------|--------|-------------|----------------------------------|
| `hash`    | string | Sim         | Hash MD5 do prompt em cache      |

**Resposta — 200 OK**
```json
{ "deleted": "d41d8cd98f00b204e9800998ecf8427e" }
```

> Se o hash não existir no cache, a resposta ainda é `200 OK` (operação idempotente).

**Erros**

| Status | Code         | Motivo                                           |
|--------|--------------|--------------------------------------------------|
| 401    | `AUTH_ERROR` | Header `Authorization` ausente ou token inválido |

---

## Formato padrão de erros

Todos os erros retornam JSON no seguinte formato:

```json
{
  "error": "Descrição legível do problema",
  "code": "CODIGO_DO_ERRO",
  "details": { "field": "nome_do_campo" }
}
```

O campo `details` é opcional e aparece apenas quando há informações adicionais úteis (ex.: qual campo falhou na validação).

### Códigos de erro

| Code                | Descrição                                                                                    |
|---------------------|----------------------------------------------------------------------------------------------|
| `VALIDATION_ERROR`  | Um ou mais campos do body ou query params são inválidos ou estão ausentes                    |
| `NOT_FOUND`         | O recurso solicitado não foi encontrado (config, run, etc.)                                  |
| `AUTH_ERROR`        | Token de autenticação ausente ou inválido                                                    |
| `CONFIG_NOT_FOUND`  | Nenhuma configuração de funil encontrada para a conta ao executar uma análise               |
| `DATABASE_ERROR`    | O banco de dados (Supabase) está indisponível ou retornou um erro inesperado                |
| `INTERNAL_ERROR`    | Erro interno do servidor (ex.: falha na OpenAI, configuração ausente no servidor)           |
