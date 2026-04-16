'use strict';

const { detectStages, classifyTrack } = require('../src/stage-detector');

const ia = (txt, ts = '2026-01-01T10:00:00Z') => ({ direction: 'outbound', sent_by: 'IA', content_text: txt, created_at: ts });
const human = (txt, ts = '2026-01-01T10:01:00Z') => ({ direction: 'outbound', sent_by: null, content_text: txt, created_at: ts });
const patient = (txt, ts = '2026-01-01T10:02:00Z') => ({ direction: 'inbound', sent_by: null, content_text: txt, created_at: ts });

const defaultConfig = {
  stages: [
    { code: 'SAUDACAO',   keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite'], indicates_professional: false },
    { code: 'QUEIXA',     keywords: ['papada', 'flacidez', 'bigode', 'olhos', 'sobrancelha', 'mandibula', 'pescoco'], indicates_professional: true },
    { code: 'PROCEDIMENTO', keywords: ['fastlifting', 'full face', 'lifting', 'botox'], indicates_professional: true },
    { code: 'TRIAGEM',    keywords: ['já realizou', 'já fez', 'tratamento anterior', 'fio', 'preenchimento'], indicates_professional: true },
    { code: 'INVESTIMENTO', keywords: ['R\\$\\s*[\\d.,]+', 'investimento'], indicates_professional: true },
    { code: 'OBJECAO',    keywords: ['longe', 'medo', 'caro', 'distância', 'não tenho dinheiro'], indicates_professional: false },
    { code: 'CAPTURA',    keywords: ['whatsapp', 'minha equipe', 'equipe vai entrar', 'me passa seu número'], indicates_professional: true }
  ]
};

// ── Basic detection ──

test('PROCEDIMENTO fires when procedure keyword appears in patient message', () => {
  const msgs = [patient('oi quero saber sobre o fastlifting')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('PROCEDIMENTO');
});

test('SAUDACAO fires when IA greets', () => {
  const msgs = [patient('quero informações'), ia('Olá! Como posso te ajudar?')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('SAUDACAO');
  expect(result.events.find(e => e.stage === 'SAUDACAO').sender).toBe('IA');
});

test('SAUDACAO fires when human greets', () => {
  const msgs = [patient('quero informações'), human('Boa tarde! Tudo bem?')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('SAUDACAO');
  expect(result.events.find(e => e.stage === 'SAUDACAO').sender).toBe('HUMAN');
});

test('PROCEDIMENTO fires when procedure term appears in outbound', () => {
  const msgs = [patient('oi'), human('Vi que você se interessou pelo fastlifting de face!')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('PROCEDIMENTO');
});

test('QUEIXA fires on patient inbound with clinical keyword', () => {
  const msgs = [patient('Tenho muita flacidez no rosto e na papada')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('QUEIXA');
  expect(result.events.find(e => e.stage === 'QUEIXA').sender).toBe('PATIENT');
});

test('TRIAGEM fires when previous treatment term appears in outbound', () => {
  const msgs = [patient('tenho papada'), ia('Você já realizou algum tratamento estético anteriormente?')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('TRIAGEM');
});

test('INVESTIMENTO fires on price keyword in any message', () => {
  const msgs = [patient('quanto custa?'), ia('O investimento é a partir de R$ 44 mil.')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('INVESTIMENTO');
});

test('OBJECAO fires on patient message with objection keyword', () => {
  const msgs = [patient('Mas eu moro longe, em Fortaleza.')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('OBJECAO');
});

test('CAPTURA fires on outbound with contact capture keyword', () => {
  const msgs = [patient('quero saber mais'), ia('Perfeito. Já vou pedir para minha equipe te chamar.')];
  const result = detectStages(msgs, defaultConfig);
  expect(result.stages).toContain('CAPTURA');
});

// ── Deduplication ──

test('each stage fires at most once (no duplicates)', () => {
  const msgs = [
    patient('flacidez'),
    ia('Boa tarde! Como posso ajudar?'),
    patient('tenho papada também'),
    ia('Entendo. O investimento é R$ 44 mil.')
  ];
  const result = detectStages(msgs, defaultConfig);
  const saudacoes = result.stages.filter(s => s === 'SAUDACAO');
  expect(saudacoes.length).toBe(1);
});

// ── Furthest stage ──

test('furthest is the deepest stage reached in stages definition order', () => {
  const msgs = [
    patient('papada'),
    ia('Boa tarde! Você já realizou tratamento? O investimento é R$ 44 mil.')
  ];
  const result = detectStages(msgs, defaultConfig);
  const stageOrder = defaultConfig.stages.map(s => s.code);
  const furthestIdx = stageOrder.indexOf(result.furthest);
  const investimentoIdx = stageOrder.indexOf('INVESTIMENTO');
  expect(furthestIdx).toBeGreaterThanOrEqual(investimentoIdx);
});

// ── Empty config ──

test('empty stageConfig returns empty stages and UNKNOWN furthest', () => {
  const msgs = [patient('oi'), human('Olá!')];
  const result = detectStages(msgs, { stages: [] });
  expect(result.stages).toEqual([]);
  expect(result.furthest).toBe('UNKNOWN');
});

test('null stageConfig treats as empty', () => {
  const msgs = [patient('oi'), human('Olá!')];
  const result = detectStages(msgs, null);
  expect(result.stages).toEqual([]);
});

// ── Track classification ──

test('track is pure_ia when only IA outbound', () => {
  expect(classifyTrack(5, 0)).toBe('pure_ia');
});

test('track is pure_human when only human outbound', () => {
  expect(classifyTrack(0, 3)).toBe('pure_human');
});

test('track is hybrid when both', () => {
  expect(classifyTrack(2, 2)).toBe('hybrid');
});

test('track is no_outbound when both zero', () => {
  expect(classifyTrack(0, 0)).toBe('no_outbound');
});
