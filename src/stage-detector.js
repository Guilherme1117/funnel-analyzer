'use strict';

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
    const activeDates = Array.from(new Set(
      messages
        .map(m => typeof m.created_at === 'string' ? m.created_at.substring(0, 10) : null)
        .filter(Boolean)
    )).sort();

    return {
      chatId,
      msgCount: messages.length,
      inboundCount: messages.filter(m => m.direction === 'inbound').length,
      activeDates,
      ...result
    };
  });
}

module.exports = { detectStages, classifyConversations, classifyTrack };
