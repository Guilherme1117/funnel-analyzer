'use strict';

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
