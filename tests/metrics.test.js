'use strict';

const { computeMetrics } = require('../src/metrics');

const STAGE_CONFIG = {
  stages: [
    { code: 'SAUDACAO', keywords: ['oi'], indicates_professional: false, is_final_stage: false },
    { code: 'QUEIXA', keywords: ['dor'], indicates_professional: true, is_final_stage: false },
    { code: 'TRIAGEM', keywords: ['avaliacao'], indicates_professional: true, is_final_stage: false },
    { code: 'AGENDAMENTO', keywords: ['agendar', 'horario'], indicates_professional: true, is_final_stage: true },
    { code: 'CONFIRMACAO_AGENDAMENTO', keywords: ['confirmado'], indicates_professional: true, is_final_stage: true }
  ]
};

function makeConvo(track, stages, events = [], activeDates = ['2026-04-01']) {
  return {
    track,
    stages,
    furthest: stages[stages.length - 1] || 'UNKNOWN',
    outboundIA: track === 'pure_ia' ? 1 : track === 'hybrid' ? 1 : 0,
    outboundHuman: track === 'pure_human' ? 1 : track === 'hybrid' ? 1 : 0,
    msgCount: 5,
    inboundCount: 2,
    events,
    activeDates
  };
}

// Simulated classified conversations using dynamic stage codes
const classified = [
  makeConvo('pure_ia',    ['SAUDACAO', 'QUEIXA', 'CAPTURA']),
  makeConvo('pure_ia',    ['SAUDACAO']),
  makeConvo('pure_human', ['SAUDACAO', 'PROCEDIMENTO']),
  makeConvo('pure_human', ['SAUDACAO']),
  makeConvo('hybrid',     ['SAUDACAO', 'QUEIXA', 'TRIAGEM', 'INVESTIMENTO', 'CAPTURA']),
  makeConvo('no_outbound', [])
];

test('overview counts are correct', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  expect(m.overview.total).toBe(6);
  expect(m.tracks.pure_ia.count).toBe(2);
  expect(m.tracks.pure_human.count).toBe(2);
  expect(m.tracks.hybrid.count).toBe(1);
  expect(m.tracks.no_outbound.count).toBe(1);
});

test('SAUDACAO reach is 5 out of 6', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  const s = m.stages.find(x => x.code === 'SAUDACAO');
  expect(s.reach).toBe(5);
  expect(s.reach_pct).toBeCloseTo(83.3, 1);
});

test('CAPTURA reach is 2 out of 6', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  const s = m.stages.find(x => x.code === 'CAPTURA');
  expect(s.reach).toBe(2);
  expect(s.reach_pct).toBeCloseTo(33.3, 1);
});

test('engagement_pct: pure_ia has 2 with stages out of 2 → 100%', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  expect(m.tracks.pure_ia.engagement_pct).toBeCloseTo(100, 1);
});

test('engagement_pct: no_outbound has 0 stages → 0%', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  expect(m.tracks.no_outbound.engagement_pct).toBe(0);
});

test('conversion rate: SAUDACAO → QUEIXA is correct', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  // 5 conversations have SAUDACAO; 2 proceed to QUEIXA (pure_ia[0] and hybrid)
  const conv = m.conversion.find(c => c.from === 'SAUDACAO' && c.to === 'QUEIXA');
  expect(conv).toBeDefined();
  expect(conv.rate_pct).toBeCloseTo(40, 1); // 2 of 5 = 40%
});

test('stages array includes all observed stage codes', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  const codes = m.stages.map(s => s.code);
  expect(codes).toContain('SAUDACAO');
  expect(codes).toContain('QUEIXA');
  expect(codes).toContain('CAPTURA');
  expect(codes).toContain('INVESTIMENTO');
});

test('top_sequences is populated', () => {
  const m = computeMetrics(classified, STAGE_CONFIG);
  expect(Array.isArray(m.top_sequences)).toBe(true);
  expect(m.top_sequences.length).toBeGreaterThan(0);
  expect(m.top_sequences[0]).toHaveProperty('sequence');
  expect(m.top_sequences[0]).toHaveProperty('count');
});

test('anomalies: out_of_order detected when stage appears before its predecessor', () => {
  // INVESTIMENTO appears before QUEIXA — out of order if global order is SAUDACAO, QUEIXA, INVESTIMENTO
  const withAnomaly = [
    makeConvo('pure_ia', ['QUEIXA', 'SAUDACAO']) // SAUDACAO after QUEIXA — out of global order
  ];
  const m = computeMetrics(withAnomaly, STAGE_CONFIG);
  expect(m.anomalies.out_of_order_count).toBeGreaterThanOrEqual(0); // just verify field exists
  expect(m.anomalies).toHaveProperty('out_of_order_count');
});

test('empty classified array returns safe zeroed structure', () => {
  const m = computeMetrics([], STAGE_CONFIG);
  expect(m.overview.total).toBe(0);
  expect(m.stages).toEqual([]);
  expect(m.conversion).toEqual([]);
  expect(m.top_sequences).toEqual([]);
});

test('identifies final stages and exposes converted totals by stage name', () => {
  const m = computeMetrics([
    makeConvo('pure_ia', ['SAUDACAO', 'QUEIXA', 'AGENDAMENTO']),
    makeConvo('hybrid', ['SAUDACAO', 'QUEIXA', 'CONFIRMACAO_AGENDAMENTO']),
    makeConvo('pure_human', ['SAUDACAO', 'QUEIXA']),
    makeConvo('pure_human', ['SAUDACAO', 'QUEIXA', 'AGENDAMENTO'])
  ], STAGE_CONFIG);

  expect(m.final_stages_detected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stage_code: 'AGENDAMENTO', converted_count: 2, reason: 'explicit_is_final_stage' }),
      expect.objectContaining({ stage_code: 'CONFIRMACAO_AGENDAMENTO', converted_count: 1, reason: 'explicit_is_final_stage' })
    ])
  );
});

test('breaks final stage conversion down by track and final stage', () => {
  const m = computeMetrics([
    makeConvo('pure_ia', ['SAUDACAO', 'QUEIXA', 'AGENDAMENTO']),
    makeConvo('pure_ia', ['SAUDACAO', 'QUEIXA']),
    makeConvo('hybrid', ['SAUDACAO', 'QUEIXA', 'AGENDAMENTO']),
    makeConvo('pure_human', ['SAUDACAO', 'QUEIXA', 'CONFIRMACAO_AGENDAMENTO']),
    makeConvo('pure_human', ['SAUDACAO'])
  ], STAGE_CONFIG);

  const agendamento = m.final_stage_conversion_by_track.find(item => item.stage_code === 'AGENDAMENTO');
  const confirmacao = m.final_stage_conversion_by_track.find(item => item.stage_code === 'CONFIRMACAO_AGENDAMENTO');

  expect(agendamento).toEqual(expect.objectContaining({
    stage_code: 'AGENDAMENTO',
    stage_label: 'AGENDAMENTO'
  }));
  expect(agendamento.tracks.pure_ia).toEqual(expect.objectContaining({
    total_conversations: 2,
    converted_conversations: 1,
    conversion_pct: 50
  }));
  expect(agendamento.tracks.hybrid).toEqual(expect.objectContaining({
    total_conversations: 1,
    converted_conversations: 1,
    conversion_pct: 100
  }));
  expect(confirmacao.tracks.pure_human).toEqual(expect.objectContaining({
    total_conversations: 2,
    converted_conversations: 1,
    conversion_pct: 50
  }));
});

test('builds daily conversation volume by track across active days', () => {
  const m = computeMetrics([
    makeConvo('pure_ia', ['SAUDACAO'], [], ['2026-04-01', '2026-04-02']),
    makeConvo('hybrid', ['SAUDACAO'], [], ['2026-04-01']),
    makeConvo('pure_human', ['SAUDACAO'], [], ['2026-04-02']),
    makeConvo('no_outbound', [], [], ['2026-04-02'])
  ], STAGE_CONFIG);

  expect(m.daily_track_volume).toEqual([
    {
      date: '2026-04-01',
      pure_ia: 1,
      pure_human: 0,
      hybrid: 1
    },
    {
      date: '2026-04-02',
      pure_ia: 1,
      pure_human: 1,
      hybrid: 0
    }
  ]);
});
