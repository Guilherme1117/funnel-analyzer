'use strict';

const { isProfessional } = require('../src/filter');

const msg = (direction, sent_by, content_text) => ({ direction, sent_by, content_text });
const ia = (txt) => msg('outbound', 'IA', txt);
const human = (txt) => msg('outbound', null, txt);
const patient = (txt) => msg('inbound', null, txt);

// Helper: builds a stageConfig with any number of professional keyword groups
const makeConfig = (professionalKeywordSets = []) => ({
  stages: [
    { code: 'SAUDACAO', keywords: ['oi', 'olá'], indicates_professional: false },
    ...professionalKeywordSets.map((kws, i) => ({
      code: `PROF_${i}`,
      keywords: kws,
      indicates_professional: true
    }))
  ]
});

const emptyConfig = { stages: [] };
const clinicConfig = makeConfig([
  ['papada', 'flacidez', 'botox', 'lifting', 'fastlifting'],
  ['R\\$\\s*[\\d.,]+', 'investimento']
]);

// ── Always PERSONAL overrides ──
test('always PERSONAL: no outbound messages', () => {
  expect(isProfessional([patient('oi')], emptyConfig)).toBe(false);
});

test('always PERSONAL: single message under 5 chars', () => {
  expect(isProfessional([msg('inbound', null, 'oi')], emptyConfig)).toBe(false);
});

test('always PERSONAL: all messages same sender', () => {
  const msgs = [human('oi tudo bem?'), human('como posso ajudar?')];
  expect(isProfessional(msgs, emptyConfig)).toBe(false);
});

// ── Tier 1: IA present ──
test('Tier 1: IA message present → PROFESSIONAL', () => {
  const msgs = [patient('oi'), ia('Olá! Como posso ajudar?')];
  expect(isProfessional(msgs, emptyConfig)).toBe(true);
});

// ── Tier 2: professional stage keywords ──
test('professional stage keyword "fastlifting" → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Vi que você se interessou pelo fastlifting de face')];
  expect(isProfessional(msgs, clinicConfig)).toBe(true);
});

test('professional stage keyword matches price → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('O investimento é a partir de R$ 44 mil')];
  expect(isProfessional(msgs, clinicConfig)).toBe(true);
});

test('professional keyword "papada" in patient inbound → PROFESSIONAL', () => {
  const msgs = [patient('Tenho muita flacidez no rosto e na papada'), human('Entendo, isso é muito comum.')];
  expect(isProfessional(msgs, clinicConfig)).toBe(true);
});

test('professional keyword "botox" in outbound → PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Fazemos botox e preenchimento.')];
  expect(isProfessional(msgs, clinicConfig)).toBe(true);
});

// ── Non-professional ──
test('PERSONAL: short greeting exchange with no professional keywords', () => {
  const msgs = [patient('oi'), human('oi tudo bem?'), patient('tudo sim!')];
  expect(isProfessional(msgs, clinicConfig)).toBe(false);
});

test('non-professional stage keyword does NOT trigger PROFESSIONAL', () => {
  const msgs = [patient('oi'), human('Olá!')];
  const cfg = { stages: [{ code: 'SAUDACAO', keywords: ['olá'], indicates_professional: false }] };
  expect(isProfessional(msgs, cfg)).toBe(false);
});

test('uses stageConfig stages when provided', () => {
  const msgs = [patient('Eu tenho xyzterm no queixo'), human('Entendo, isso é comum nos nossos pacientes aqui na clínica')];
  expect(isProfessional(msgs, makeConfig([['xyzterm']]))).toBe(true);
});

test('empty stages array: no professional keywords → PERSONAL', () => {
  const msgs = [patient('oi'), human('tudo bem, como vai?')];
  expect(isProfessional(msgs, emptyConfig)).toBe(false);
});
