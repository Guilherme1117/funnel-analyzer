// tests/server.test.js
'use strict';

const request = require('supertest');

// All jest.mock() calls MUST be at top-level — Jest hoists these before imports
jest.mock('../src/prompt-parser', () => ({
  parsePrompt: jest.fn().mockResolvedValue({
    stageConfig: {
      stages: [
        { code: 'SAUDACAO',    keywords: ['oi', 'olá'],         indicates_professional: false },
        { code: 'QUEIXA',      keywords: ['papada', 'flacidez'], indicates_professional: true  },
        { code: 'INVESTIMENTO',keywords: ['R\\$\\s*[\\d.,]+'],  indicates_professional: true  }
      ]
    },
    cacheHit: false,
    hash: 'abc123'
  })
}));

jest.mock('../src/supabase', () => ({
  fetchConversations: jest.fn().mockResolvedValue({
    chats: [{ id: 'chat-1' }],
    messagesByChat: {},
    totalMessages: 0
  })
}));

jest.mock('../src/report-writer', () => ({
  generateReport: jest.fn().mockResolvedValue('# Mock Report')
}));

const app = require('../src/server');

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_STAGE_CONFIG = {
  stages: [
    { code: 'SAUDACAO',    keywords: ['oi', 'olá'],         indicates_professional: false },
    { code: 'QUEIXA',      keywords: ['papada', 'rugas'],   indicates_professional: true  },
    { code: 'INVESTIMENTO',keywords: ['R\\$\\s*[\\d.,]+'],  indicates_professional: true  }
  ]
};

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /funnel/build', () => {
  it('returns stageConfig, cacheHit and hash when given a valid prompt', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .send({ prompt: 'Você é um assistente de vendas da clínica...' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stageConfig');
    expect(res.body).toHaveProperty('cacheHit', false);
    expect(res.body).toHaveProperty('hash', 'abc123');
    expect(Array.isArray(res.body.stageConfig.stages)).toBe(true);
    expect(res.body.stageConfig.stages[0]).toHaveProperty('code', 'SAUDACAO');
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app).post('/funnel/build').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when prompt is an empty string', async () => {
    const res = await request(app).post('/funnel/build').send({ prompt: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /analyze', () => {
  it('returns analysis when account_id and stageConfig are valid', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('stage_config');
    expect(res.body.meta.account_id).toBe(VALID_UUID);
    expect(res.body.meta.total_chats).toBe(1);
    expect(res.body.stage_config.stages[0].code).toBe('SAUDACAO');
  });

  it('returns 400 when account_id is missing', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/account_id/);
  });

  it('returns 400 when account_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: 'not-a-uuid', stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(400);
  });

  it('returns 400 when stageConfig is missing', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stageConfig/);
  });

  it('returns 400 when stageConfig is an array (not a plain object)', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: ['botox'] });

    expect(res.status).toBe(400);
  });

  it('does NOT include prompt or prompt_hash in the response meta', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(200);
    expect(res.body.meta).not.toHaveProperty('prompt_cache_hit');
    expect(res.body.meta).not.toHaveProperty('prompt_hash');
  });
});
