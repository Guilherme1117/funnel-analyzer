# Dynamic Funnel Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar o analisador para suportar etapas de funil dinâmicas geradas por um LLM, eliminando constantes de clínicas de estética e criando um rastreio universal e agnóstico de nicho.

**Architecture:** 
1. `prompt-parser.js` define JSON Schema via OpeanAI Structured Outputs para retornar um array e dita quais estapas são `indicates_professional: true`.
2. `filter.js` busca na conversa por regex correspondente às etapas profissionais; sem hardcode.
3. `stage-detector.js` varre dinamicamente a ordem recebida do LLM em vez de `STAGE_ORDER`.
4. `metrics.js` mede conversões da Etapa `N` para a Etapa `N+1` genericamente, substituindo métricas fixas.

**Tech Stack:** Node.js, Express, Jest, OpenAI GPT-4o-Mini

---

## Task 1: Update Test Mocks & Fixtures

**Files:**
- Modify: `tests/server.test.js`

- [ ] **Step 1: Replace VALID_STAGE_CONFIG in Server tests**
In `tests/server.test.js`, replace the `VALID_STAGE_CONFIG` declaration and the mock for `parsePrompt`:

```javascript
/* Substitua todas as propriedades de clinical_terms/procedure_terms por: */
const VALID_STAGE_CONFIG = {
  stages: [
    { code: 'SAUDACAO', keywords: ['oi', 'olá'], indicates_professional: false },
    { code: 'QUEIXA', keywords: ['papada', 'rugas'], indicates_professional: true },
    { code: 'INVESTIMENTO', keywords: ['R\\$\\s*[\\d.,]+'], indicates_professional: true }
  ]
};
```
*Atenção: Atualize o `jest.mock('../src/prompt-parser')` e corrija qualquer `expect` que valide `procedure_terms` para validar `stage_config.stages[0].code`.*

- [ ] **Step 2: Execute Tests para ver falhas**
```bash
npx jest tests/server.test.js --no-coverage
```
*Expected: Falhas nos testes do POST /analyze informando erro de quebra de contrato.*

---

## Task 2: Refactor `filter.js` (Detector de Vendas Profissionais)

**Files:**
- Modify: `src/filter.js`

- [ ] **Step 1: Substituir `isProfessional` e apagar RegEx Constants**
Replace content from line 1 through `isProfessional` function with:

```javascript
function buildRegex(terms) {
  if (!terms || terms.length === 0) return null;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

function isProfessional(messages, stageConfig = { stages: [] }) {
  const outbound = messages.filter(m => m.direction === 'outbound');
  if (outbound.length === 0) return false;
  if (messages.length <= 1 && (messages[0]?.content_text || '').length < 5) return false;
  const senderKeys = new Set(messages.map(m => `${m.direction}_${m.sent_by}`));
  if (senderKeys.size <= 1) return false;

  // Tier 1: IA message present
  if (messages.some(m => m.sent_by === 'IA')) return true;

  // Loop nas etapas profissionais definidas pelo LLM
  if (stageConfig.stages && Array.isArray(stageConfig.stages)) {
    const professionalStages = stageConfig.stages.filter(s => s.indicates_professional);
    for (const pStage of professionalStages) {
      const rx = buildRegex(pStage.keywords);
      if (!rx) continue;
      if (messages.some(m => rx.test(m.content_text || ''))) {
        return true;
      }
    }
  }

  return false;
}

module.exports = { isProfessional };
```

- [ ] **Step 2: Verificar falhas no `filter.test.js`**
Isso quebrará o `filter.test.js` pois ele não passa o novo formato `{ stages: [] }`.

---

## Task 3: Refactor `stage-detector.js`

**Files:**
- Modify: `src/stage-detector.js`

- [ ] **Step 1: Omitir `STAGE_ORDER` e mapear array dinâmico**
Replace entire content of `src/stage-detector.js`:

```javascript
function buildRx(terms) {
  if (!terms || terms.length === 0) return null;
  return new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
}

function classifyTrack(outboundIA, outboundHuman) {
  if (outboundIA > 0 && outboundHuman > 0) return 'hybrid';
  if (outboundIA > 0) return 'pure_ia';
  if (outboundHuman > 0) return 'pure_human';
  return 'no_outbound';
}

function detectStages(messages, stageConfig) {
  const stagesDefinition = (stageConfig && Array.isArray(stageConfig.stages)) ? stageConfig.stages : [];
  
  const events = [];
  const stagesHit = new Set();
  let hasIA = false;

  for (const m of messages) {
    const txt = (m.content_text || '').trim();
    const isIA = m.sent_by === 'IA';
    const isHumanOut = m.direction === 'outbound' && !isIA;
    const sender = isIA ? 'IA' : isHumanOut ? 'HUMAN' : 'PATIENT';
    
    if (isIA) hasIA = true;

    for (const stg of stagesDefinition) {
      if (stagesHit.has(stg.code)) continue; 
      
      const rx = buildRx(stg.keywords);
      if (rx && rx.test(txt)) {
        stagesHit.add(stg.code);
        events.push({
          stage: stg.code,
          sender,
          timestamp: (m.created_at || '').substring(0, 16),
          preview: txt.substring(0, 80)
        });
      }
    }
  }

  const stageCodesOrder = stagesDefinition.map(s => s.code);
  const stages = events.map(e => e.stage);
  
  let furthest = stagesDefinition.length > 0 ? stagesDefinition[0].code : 'UNKNOWN';
  let highestIndex = -1;
  for (const hit of stagesHit) {
      const idx = stageCodesOrder.indexOf(hit);
      if (idx > highestIndex) {
          highestIndex = idx;
          furthest = hit;
      }
  }

  const outboundIA = messages.filter(m => m.sent_by === 'IA').length;
  const outboundHuman = messages.filter(m => m.direction === 'outbound' && !m.sent_by).length;

  return {
    stages,
    furthest,
    track: classifyTrack(outboundIA, outboundHuman),
    outboundIA,
    outboundHuman,
    events
  };
}

function classifyConversations(chatMap, stageConfig) {
  return Object.entries(chatMap).map(([chatId, messages]) => {
    const result = detectStages(messages, stageConfig);
    return {
      chatId,
      msgCount: messages.length,
      inboundCount: messages.filter(m => m.direction === 'inbound').length,
      ...result
    };
  });
}

module.exports = { detectStages, classifyConversations, classifyTrack };
```

---

## Task 4: Upgrade `prompt-parser.js`

**Files:**
- Modify: `src/prompt-parser.js`

- [ ] **Step 1: Replace system_prompt e JSON Strict Schema**
(Implementador gerará o objeto system_prompt e configurará a requisição da api `openai.chat.completions.create` com `response_format` type json_schema limitando à extração do array `stages`).

---

## Task 5: Refactor `metrics.js` 

**Files:**
- Modify: `src/metrics.js`

- [ ] **Step 1: Refatorar computeMetrics**
Mudar lógicas de conversão para iterar do estágio 0 até `stages.length - 1`. Remover anomalias hardcoded baseadas no STAGE_ORDER antigo e aplicar anomalias numéricas sobre desvios sequenciais do array dinâmico.

---

## Self-Review Checklist
- [x] O JSON do `filter.js` lê diretamente da validação LLM.
- [x] As conversões entre etapas serão baseadas em index do array de configuração dinâmico.
- [x] Os loops de teste server-side possuem os placeholders adequados.
