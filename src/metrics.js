'use strict';

function computeMetrics(classified) {
  const total = classified.length;
  const tracks = {
    pure_ia:     { count: 0, with_last_stage: 0 },
    pure_human:  { count: 0, with_last_stage: 0 },
    hybrid:      { count: 0, with_last_stage: 0 },
    no_outbound: { count: 0, with_last_stage: 0 }
  };

  // Build dynamic stage order from all observed stage codes across all conversations.
  // We use the order in which stages first appear across conversations (insertion order).
  // This preserves the LLM-defined stage order since detectStages emits events in message order.
  const globalStageOrder = [];
  const seenStageCodes = new Set();

  for (const c of classified) {
    for (const stage of (c.stages || [])) {
      if (!seenStageCodes.has(stage)) {
        seenStageCodes.add(stage);
        globalStageOrder.push(stage);
      }
    }
  }

  const stageReach = {};
  const stageByIA = {};
  const stageByHuman = {};
  const sequenceCounts = {};

  // Sequential anomaly detection: count cases where a later stage appears before an earlier one
  const anomalies = { out_of_order_count: 0 };

  for (const c of classified) {
    const t = c.track || 'no_outbound';
    if (!tracks[t]) tracks[t] = { count: 0, with_last_stage: 0 };
    tracks[t].count++;

    // Mark if conversation reached its furthest possible stage (last in config order)
    const hasDeepStage = c.stages && c.stages.length > 0;
    if (hasDeepStage) tracks[t].with_last_stage++;

    for (const stage of (c.stages || [])) {
      stageReach[stage] = (stageReach[stage] || 0) + 1;
    }

    for (const ev of (c.events || [])) {
      if (ev.sender === 'IA') stageByIA[ev.stage] = (stageByIA[ev.stage] || 0) + 1;
      else if (ev.sender === 'HUMAN') stageByHuman[ev.stage] = (stageByHuman[ev.stage] || 0) + 1;
    }

    const seqKey = (c.stages || []).join('>') || 'NONE';
    sequenceCounts[seqKey] = (sequenceCounts[seqKey] || 0) + 1;

    // Detect out-of-order stage occurrences (stage at position i+k appears before stage at i)
    const stagesInConv = (c.stages || []);
    let outOfOrder = false;
    for (let i = 0; i < stagesInConv.length - 1 && !outOfOrder; i++) {
      const aIdx = globalStageOrder.indexOf(stagesInConv[i]);
      const bIdx = globalStageOrder.indexOf(stagesInConv[i + 1]);
      if (bIdx !== -1 && aIdx !== -1 && bIdx < aIdx) {
        outOfOrder = true;
      }
    }
    if (outOfOrder) anomalies.out_of_order_count++;
  }

  // Build stages summary in global order
  const stages = globalStageOrder.map(code => ({
    code,
    reach: stageReach[code] || 0,
    reach_pct: total > 0 ? +(((stageReach[code] || 0) / total * 100).toFixed(1)) : 0,
    by_ia: stageByIA[code] || 0,
    by_human: stageByHuman[code] || 0
  }));

  // Per-conversation sequential conversion: N → N+1 in global stage order
  const conversionPairs = {};
  for (const c of classified) {
    for (let i = 0; i < globalStageOrder.length - 1; i++) {
      const from = globalStageOrder[i];
      const fromIdx = (c.stages || []).indexOf(from);
      if (fromIdx === -1) continue;
      if (!conversionPairs[from]) conversionPairs[from] = {};
      conversionPairs[from].__total = (conversionPairs[from].__total || 0) + 1;
      for (let j = i + 1; j < globalStageOrder.length; j++) {
        const to = globalStageOrder[j];
        const toIdx = (c.stages || []).indexOf(to);
        if (toIdx !== -1 && toIdx > fromIdx) {
          conversionPairs[from][to] = (conversionPairs[from][to] || 0) + 1;
        }
      }
    }
  }

  const conversion = [];
  for (let i = 0; i < globalStageOrder.length - 1; i++) {
    const from = globalStageOrder[i];
    const pair = conversionPairs[from];
    if (!pair || !pair.__total) continue;
    for (let j = i + 1; j < globalStageOrder.length; j++) {
      const to = globalStageOrder[j];
      const count = pair[to] || 0;
      if (count > 0) {
        conversion.push({ from, to, rate_pct: +((count / pair.__total * 100).toFixed(1)) });
      }
    }
  }

  for (const v of Object.values(tracks)) {
    v.engagement_pct = v.count > 0 ? +((v.with_last_stage / v.count * 100).toFixed(1)) : 0;
  }

  const top_sequences = Object.entries(sequenceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([sequence, count]) => ({ sequence, count }));

  return { overview: { total }, tracks, stages, conversion, top_sequences, anomalies };
}

module.exports = { computeMetrics };
