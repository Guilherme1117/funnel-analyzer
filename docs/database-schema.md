# Esquema do Banco de Dados — Funnel Analyzer

Este documento descreve todas as tabelas utilizadas pelo sistema, separadas entre tabelas de leitura (dados externos) e tabelas do sistema (leitura/escrita).

---

## 1. Tabelas de Chat (leitura — dados externos)

Estas tabelas são populadas por integrações externas (WhatsApp, Instagram). O sistema **apenas lê** esses dados, nunca os modifica.

### wa_chats

Representa um chat/conversa entre a empresa e um contato.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Identificador único do chat |
| account_id | uuid | ID da conta/empresa dona do chat |
| chat_type | text | Tipo do chat (whatsapp, instagram, etc.) |
| contact_id | uuid | ID do contato associado |
| created_at | timestamptz | Data de criação do chat |
| last_message_at | timestamptz | Data da última mensagem |

> **Campos usados pelo sistema:** `id`, `account_id`, `created_at`, `last_message_at`

---

### wa_messages

Representa uma mensagem individual dentro de um chat.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Identificador único da mensagem |
| chat_id | uuid | FK para `wa_chats.id` |
| direction | text | `inbound` (do contato) ou `outbound` (da empresa) |
| sent_by | text | Quem enviou: `IA`, `null` (humano), etc. |
| content_text | text | Conteúdo textual da mensagem |
| created_at | timestamptz | Data/hora da mensagem |
| message_type | text | Tipo da mensagem (`text`, `image`, etc.) |

**Classificação do remetente:**

| Remetente | Critério |
|-----------|----------|
| IA | `sent_by === 'IA'` |
| HUMANO | `direction === 'outbound'` e `sent_by` não definido |
| PACIENTE | `direction === 'inbound'` |

---

## 2. Tabelas do Sistema (leitura/escrita)

Estas tabelas são criadas e gerenciadas pelo próprio sistema. O sistema tem permissão de leitura e escrita sobre elas.

---

### funnel_configs

Armazena a configuração do funil por conta. Relação **1:1** com `account_id`.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Chave primária |
| account_id | uuid | ID da conta (UNIQUE) |
| prompt_hash | text | Hash do prompt usado para detecção de estágios |
| stage_config | jsonb | Configuração dos estágios do funil |
| created_at | timestamptz | Data de criação do registro |
| updated_at | timestamptz | Data da última atualização |

**Estrutura do campo `stage_config`:**

```json
{
  "stages": [
    {
      "id": "stage_1",
      "name": "Primeiro Contato",
      "description": "Mensagem inicial do paciente",
      "keywords": ["oi", "olá", "bom dia"],
      "indicates_professional": false,
      "is_final_stage": false
    },
    {
      "id": "stage_2",
      "name": "Qualificação",
      "description": "Coleta de informações do paciente",
      "keywords": ["consulta", "agendamento", "preço"],
      "indicates_professional": true,
      "is_final_stage": true
    }
  ]
}
```

> `is_final_stage` é o campo preferencial para marcar quais etapas representam conversão final. Se configs antigos não tiverem esse campo, a API ainda consegue usar fallback heurístico durante a análise.

---

### analysis_runs

Representa uma execução completa de análise. Um registro por execução.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Chave primária |
| account_id | uuid | ID da conta analisada |
| funnel_config_id | uuid | FK para `funnel_configs.id` (nullable) |
| analysis_type | text | Tipo da análise (padrão: `'funnel'`) |
| total_chats | integer | Total de chats analisados |
| professional_count | integer | Chats classificados como profissionais |
| personal_count | integer | Chats classificados como pessoais |
| total_messages | integer | Total de mensagens processadas |
| tracks | jsonb | Distribuição dos chats por trilha |
| stages_summary | jsonb | Resumo dos estágios detectados |
| conversion | jsonb | Métricas de conversão do funil |
| top_sequences | jsonb | Sequências de estágios mais frequentes |
| anomalies | jsonb | Anomalias detectadas na análise |
| report_md | text | Relatório completo em formato Markdown |
| custom_data | jsonb | Dados adicionais personalizados, incluindo `final_stages_detected`, `final_stage_conversion_by_track` e `daily_track_volume` |
| analyzed_at | timestamptz | Data/hora da execução da análise |

**Índices:**
- `account_id`
- `analyzed_at DESC`
- `analysis_type`

---

### analysis_conversations

Representa a classificação de um chat individual dentro de uma execução. Um registro por chat por execução.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Chave primária |
| run_id | uuid | FK para `analysis_runs.id` (CASCADE) |
| chat_id | uuid | ID do chat analisado (`wa_chats.id`) |
| msg_count | integer | Total de mensagens no chat |
| inbound_count | integer | Total de mensagens recebidas (paciente) |
| track | text | Trilha classificada (ex.: `professional`, `personal`) |
| furthest_stage | text | Estágio mais avançado atingido no funil |
| stages | text[] | Lista de todos os estágios detectados |
| outbound_ia | integer | Quantidade de mensagens enviadas pela IA |
| outbound_human | integer | Quantidade de mensagens enviadas por humanos |

**Índices:**
- `run_id`
- `chat_id`

---

### analysis_events

Representa um evento de estágio detectado dentro de uma conversa. Um registro por estágio detectado.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid | Chave primária |
| conversation_id | uuid | FK para `analysis_conversations.id` (CASCADE) |
| stage | text | Identificador do estágio detectado |
| sender | text | Remetente da mensagem que ativou o estágio |
| event_timestamp | timestamptz | Data/hora do evento |
| preview | text | Trecho do texto da mensagem |

**Índices:**
- `conversation_id`

---

## 3. Relacionamentos

### Diagrama ERD (texto)

```
funnel_configs (1:1 account_id)
    │
    └──< analysis_runs (N:1 funnel_config_id)
              │
              └──< analysis_conversations (N:1 run_id, CASCADE)
                        │
                        └──< analysis_events (N:1 conversation_id, CASCADE)
```

### Notas sobre os relacionamentos

- **Deleção em cascata:** Ao deletar um `analysis_run`, todos os registros filhos em `analysis_conversations` e, consequentemente, em `analysis_events` são removidos automaticamente via `CASCADE`.
- **`funnel_config_id` nullable:** Um `analysis_run` pode existir sem estar vinculado a uma `funnel_config` (por exemplo, análises realizadas antes da configuração ser salva no banco).
- **RLS (Row Level Security):** As tabelas do sistema devem ter políticas de RLS configuradas no Supabase para garantir que cada conta (`account_id`) acesse apenas seus próprios dados.
- **Tabelas externas (`wa_chats`, `wa_messages`):** O sistema não possui controle sobre o esquema dessas tabelas. Consultas são feitas via `service_role` e o sistema assume que as colunas documentadas aqui estão disponíveis.
