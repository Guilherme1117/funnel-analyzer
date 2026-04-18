'use strict';

const { detectFinalStages } = require('../src/final-stage-detector');

test('prioritizes explicit is_final_stage over semantic inference', () => {
  const result = detectFinalStages({
    stages: [
      { code: 'SAUDACAO', keywords: ['oi'], is_final_stage: false },
      { code: 'AGENDAMENTO', keywords: ['agendar horario'], is_final_stage: false },
      { code: 'CONFIRMACAO_AGENDAMENTO', keywords: ['agendamento confirmado'], is_final_stage: true }
    ]
  });

  expect(result).toEqual([
    expect.objectContaining({
      stage_code: 'CONFIRMACAO_AGENDAMENTO',
      reason: 'explicit_is_final_stage'
    })
  ]);
});

test('detects multiple final stages using semantic clues and stage order', () => {
  const result = detectFinalStages({
    stages: [
      { code: 'SAUDACAO', keywords: ['oi'] },
      { code: 'QUEIXA', keywords: ['dor'] },
      { code: 'AGENDAMENTO', keywords: ['agendar horario'] },
      { code: 'CONFIRMACAO_AGENDAMENTO', keywords: ['agendamento confirmado'] }
    ]
  });

  expect(result).toEqual([
    expect.objectContaining({ stage_code: 'AGENDAMENTO' }),
    expect.objectContaining({ stage_code: 'CONFIRMACAO_AGENDAMENTO' })
  ]);
});

test('falls back to the last stage when semantics are weak', () => {
  const result = detectFinalStages({
    stages: [
      { code: 'INICIO', keywords: ['oi'] },
      { code: 'MEIO', keywords: ['avaliacao'] },
      { code: 'ULTIMA_ETAPA', keywords: ['seguir'] }
    ]
  });

  expect(result).toEqual([
    expect.objectContaining({ stage_code: 'ULTIMA_ETAPA', reason: 'fallback_last_stage' })
  ]);
});
