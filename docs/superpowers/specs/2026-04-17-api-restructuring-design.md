# API Restructuring & Documentation — Design Spec

**Data:** 2026-04-17
**Objetivo:** Preparar a API do funnel-analyzer para deploy em VPS com melhorias de usabilidade, segurança e documentação.

---

## 1. Filtro de Datas no `/analyze`

### Novos campos no body

```json
{
  "account_id": "uuid",
  "config_id": "uuid (opcional)",
  "start_date": "2026-04-01T00:00:00Z (opcional)",
  "end_date": "2026-04-17T23:59:59Z (opcional)"
}
```

- `start_date` e `end_date` são opcionais. Se omitidos, busca todas as mensagens (comportamento atual).
- Se apenas um for fornecido → 400. Ambos ou nenhum.
- Formato: ISO 8601 string.

### Onde o filtro é aplicado

- Na query de `wa_messages` em `supabase.js`, adicionando filtros `created_at.gte` e `created_at.lte`.
- Chats são filtrados indiretamente: só entram na análise chats que tenham pelo menos uma mensagem no período.
- Chats sem mensagens no período são descartados silenciosamente.

### Resposta — campo `period` no `meta`

```json
{
  "meta": {
    "period": { "start": "2026-04-01T00:00:00Z", "end": "2026-04-17T23:59:59Z" },
    "account_id": "...",
    "analyzed_at": "...",
    "total_chats": 150,
    "professional": 120,
    "personal": 30,
    "total_messages": 5000
  }
}
```

Se não foi filtrado por data, `period` é `null`.

---

## 2. Resolução do stageConfig

### Body atualizado do `/analyze`

```json
{
  "account_id": "uuid (obrigatório)",
  "config_id": "uuid (opcional)",
  "start_date": "ISO string (opcional)",
  "end_date": "ISO string (opcional)"
}
```

- O campo `stageConfig` é **removido** do body.
- `account_id` é sempre obrigatório.

### Lógica de resolução (prioridade)

1. Se `config_id` fornecido → busca `funnel_configs` por `id = config_id`.
2. Se apenas `account_id` → busca `funnel_configs` por `account_id` (último salvo).
3. Se nenhum config encontrado → 400: `"Nenhuma configuração de funil encontrada. Use POST /funnel/build primeiro ou forneça config_id."`.

### Validações

- `config_id` se fornecido deve ser UUID válido, senão 400.
- Se `config_id` não existir no banco → 404: `"config_id não encontrado"`.
- Se `account_id` não tiver config salva → 400 com instrução de como criar.

### Impacto no repository

- Adicionar método `getConfigById(configId)` para buscar por ID direto.
- O método `getConfig(accountId)` existente continua sendo usado para busca por `account_id`.

### Na resposta

O campo `stage_config` continua retornando o config usado, para referência.

---

## 3. Autenticação por Token Fixo

### Variável de ambiente

```
API_TOKEN=um-hash-seguro-aqui
```

### Middleware global

- Intercepta todas as rotas **exceto** `GET /health`.
- Valida o header `Authorization: Bearer <token>`.
- Comparação usando `crypto.timingSafeEqual` para prevenir timing attacks.

### Respostas de erro

- Header ausente → 401: `"Token de autenticação não fornecido. Use o header Authorization: Bearer <token>"`.
- Token inválido → 401: `"Token de autenticação inválido"`.
- `API_TOKEN` não configurado no `.env` → rotas protegidas retornam 500: `"Autenticação não configurada no servidor"`.

### Implementação

- Arquivo `src/auth.js` com middleware exportado.
- Aplicado no `server.js` antes de todas as rotas.

---

## 4. Tratamento de Erros Padronizado

### Formato de resposta de erro

```json
{
  "error": "Mensagem clara do que aconteceu",
  "code": "VALIDATION_ERROR",
  "details": { "field": "account_id", "reason": "UUID inválido" }
}
```

### Códigos de erro

| Código | Quando |
|--------|--------|
| `VALIDATION_ERROR` | Campo ausente, formato inválido, UUID malformado |
| `NOT_FOUND` | config_id ou run_id não existe |
| `AUTH_ERROR` | Token ausente ou inválido |
| `CONFIG_NOT_FOUND` | Nenhum config para o account_id |
| `DATABASE_ERROR` | Supabase indisponível ou falha na query |
| `INTERNAL_ERROR` | Erro inesperado (OpenAI, etc.) |

### Implementação

- Função helper `apiError(res, status, code, message, details)` em `src/errors.js`.
- Todos os endpoints usam essa função para respostas de erro.

### Mudanças por endpoint

- **`POST /analyze`**: valida `start_date`/`end_date` como ISO válido, valida `config_id` como UUID, mensagens claras sobre config não encontrada.
- **`POST /funnel/build`**: sem mudanças significativas.
- **`GET/PUT /configs`**: adiciona `details` com campo específico que falhou.
- **`GET /runs`**: valida `from`/`to` como ISO válido, `limit` como número positivo.

---

## 5. Documentação

### `docs/database-schema.md`

Duas seções:

**Tabelas de Chat (leitura — dados externos):**
- `wa_chats` — campos relevantes usados pelo sistema.
- `wa_messages` — campos relevantes: `sent_by`, `direction`, `created_at`.
- Nota: tabelas populadas externamente, sistema apenas lê.

**Tabelas do Sistema (leitura/escrita):**
- `funnel_configs` — schema completo, índices, relação com account_id.
- `analysis_runs` — schema completo, campos JSONB detalhados.
- `analysis_conversations` — schema, relação com runs.
- `analysis_events` — schema, relação com conversations.
- Diagrama de relacionamento simplificado (ERD texto).

### `docs/api-endpoints.md`

Para cada endpoint:
- Método + rota.
- Descrição.
- Headers obrigatórios (Authorization).
- Body/params com tipos e obrigatoriedade.
- Exemplo de request (curl).
- Exemplo de response (sucesso).
- Tabela de erros possíveis com código, status HTTP e mensagem.

### README enxuto

- Remove documentação detalhada de endpoints e schema de tabelas.
- Mantém: visão geral, setup, variáveis de ambiente, como rodar testes, arquitetura resumida.
- Adiciona links para `docs/database-schema.md` e `docs/api-endpoints.md`.

---

## Notas de migração

- O campo `stageConfig` no body do `/analyze` deixa de ser aceito. Requisições com esse campo recebem 400 com mensagem orientando a usar `config_id` ou `account_id`.
- Todos os testes existentes que enviam `stageConfig` no body devem ser atualizados para usar `config_id` ou `account_id` (mockando o repository).
- O header `Authorization: Bearer <token>` passa a ser obrigatório em todas as rotas (exceto `/health`). Testes precisam incluir o header ou mockar o middleware.

---

## Arquivos impactados

| Arquivo | Mudança |
|---------|---------|
| `src/server.js` | Novo body do `/analyze`, middleware de auth, erros padronizados |
| `src/supabase.js` | Filtro de datas em `fetchMessagesForChats` |
| `src/repository.js` | Novo método `getConfigById` |
| `src/auth.js` | **Novo** — middleware de autenticação |
| `src/errors.js` | **Novo** — helper de erros padronizados |
| `.env.example` | Adicionar `API_TOKEN` |
| `docs/database-schema.md` | **Novo** — documentação das tabelas |
| `docs/api-endpoints.md` | **Novo** — documentação detalhada dos endpoints |
| `README.md` | Enxugar, adicionar links para docs |
| `tests/` | Atualizar testes existentes + novos testes para auth e validações |
