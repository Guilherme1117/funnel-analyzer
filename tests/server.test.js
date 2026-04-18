// tests/server.test.js
'use strict';

process.env.API_TOKEN = 'test-token-for-jest';

const request = require('supertest');

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const RUN_ID     = '323e4567-e89b-12d3-a456-426614174002';
const CONFIG_ID  = '223e4567-e89b-12d3-a456-426614174001';
const AUTH_HEADER = 'Bearer test-token-for-jest';

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
  }),
  supabaseRequest: jest.fn()
}));

jest.mock('../src/report-writer', () => ({
  generateReport: jest.fn().mockResolvedValue('# Mock Report')
}));

const mockRepository = {
  saveConfig:    jest.fn().mockResolvedValue({ id: CONFIG_ID }),
  getConfig:     jest.fn().mockResolvedValue(null),
  getConfigById: jest.fn().mockResolvedValue(null),
  saveRun:       jest.fn().mockResolvedValue(RUN_ID),
  getRuns:       jest.fn().mockResolvedValue([]),
  getRunDetail:  jest.fn().mockResolvedValue(null)
};
jest.mock('../src/repository', () => mockRepository);

const app = require('../src/server');

const VALID_STAGE_CONFIG = {
  stages: [
    { code: 'SAUDACAO',    keywords: ['oi', 'olá'],         indicates_professional: false },
    { code: 'QUEIXA',      keywords: ['papada', 'rugas'],   indicates_professional: true  },
    { code: 'INVESTIMENTO',keywords: ['R\\$\\s*[\\d.,]+'],  indicates_professional: true  }
  ]
};

const MOCK_CONFIG_RECORD = {
  id: CONFIG_ID,
  account_id: VALID_UUID,
  stage_config: VALID_STAGE_CONFIG
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRepository.saveRun.mockResolvedValue(RUN_ID);
  mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID });
  mockRepository.getConfig.mockResolvedValue(null);
  mockRepository.getConfigById.mockResolvedValue(null);
  mockRepository.getRuns.mockResolvedValue([]);
  mockRepository.getRunDetail.mockResolvedValue(null);
});

// ─────────────────────────────────────────────
describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────
describe('Authentication', () => {
  it('returns 401 when no Authorization header on protected route', async () => {
    const res = await request(app).get(`/configs/${VALID_UUID}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_ERROR');
  });

  it('returns 401 when token is invalid on protected route', async () => {
    const res = await request(app)
      .get(`/configs/${VALID_UUID}`)
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────
describe('POST /funnel/build', () => {
  it('returns stageConfig, cacheHit and hash when given a valid prompt', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'Você é um assistente de vendas da clínica...' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stageConfig');
    expect(res.body).toHaveProperty('cacheHit', false);
    expect(res.body).toHaveProperty('hash', 'abc123');
    expect(Array.isArray(res.body.stageConfig.stages)).toBe(true);
    expect(res.body.stageConfig.stages[0]).toHaveProperty('code', 'SAUDACAO');
  });

  it('salva config e retorna config_id quando account_id válido é passado', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'prompt válido', account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(mockRepository.saveConfig).toHaveBeenCalledWith(VALID_UUID, 'abc123', expect.any(Object));
    expect(res.body.config_id).toBe(CONFIG_ID);
  });

  it('não chama saveConfig e config_id é null quando account_id não é passado', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'prompt sem account_id' });

    expect(res.status).toBe(200);
    expect(mockRepository.saveConfig).not.toHaveBeenCalled();
    expect(res.body.config_id).toBeNull();
  });

  it('retorna 400 quando account_id fornecido não é UUID válido', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'prompt', account_id: 'nao-um-uuid' });
    expect(res.status).toBe(400);
  });

  it('retorna 200 mesmo quando saveConfig falha (falha silenciosa)', async () => {
    mockRepository.saveConfig.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'prompt', account_id: VALID_UUID });
    expect(res.status).toBe(200);
    expect(res.body.config_id).toBeNull();
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when prompt is an empty string', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: '   ' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
describe('POST /analyze', () => {
  it('resolves config by config_id when provided', async () => {
    mockRepository.getConfigById.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID, config_id: CONFIG_ID });

    expect(res.status).toBe(200);
    expect(mockRepository.getConfigById).toHaveBeenCalledWith(CONFIG_ID);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('stage_config');
    expect(res.body.stage_config).toEqual(VALID_STAGE_CONFIG);
    expect(res.body.funnel).toHaveProperty('final_stages_detected');
    expect(res.body.funnel).toHaveProperty('final_stage_conversion_by_track');
    expect(res.body.funnel).toHaveProperty('daily_track_volume');
    expect(res.body).toHaveProperty('run_id', RUN_ID);
  });

  it('resolves config by account_id when config_id is not provided', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(mockRepository.getConfig).toHaveBeenCalledWith(VALID_UUID);
    expect(res.body.stage_config).toEqual(VALID_STAGE_CONFIG);
  });

  it('returns 400 when config_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID, config_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when config_id does not exist', async () => {
    mockRepository.getConfigById.mockResolvedValue(null);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID, config_id: CONFIG_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 when no config found for account_id', async () => {
    mockRepository.getConfig.mockResolvedValue(null);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONFIG_NOT_FOUND');
  });

  it('passes date range to fetchConversations when start_date and end_date are provided', async () => {
    const { fetchConversations } = require('../src/supabase');
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({
        account_id: VALID_UUID,
        start_date: '2026-04-01T00:00:00Z',
        end_date: '2026-04-15T23:59:59Z'
      });

    expect(res.status).toBe(200);
    expect(fetchConversations).toHaveBeenCalledWith(VALID_UUID, {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });
    expect(res.body.meta.period).toEqual({
      start: '2026-04-01T00:00:00Z',
      end: '2026-04-15T23:59:59Z'
    });
  });

  it('does not pass date range when start_date and end_date are omitted', async () => {
    const { fetchConversations } = require('../src/supabase');
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(fetchConversations).toHaveBeenCalledWith(VALID_UUID, undefined);
    expect(res.body.meta.period).toBeNull();
  });

  it('returns 400 when only start_date is provided', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID, start_date: '2026-04-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when start_date is not a valid ISO date', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID, start_date: 'not-a-date', end_date: '2026-04-15T23:59:59Z' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when account_id is missing', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when account_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('returns 200 with warnings and run_id null when saveRun fails', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);
    mockRepository.saveRun.mockRejectedValueOnce(new Error('DB offline'));

    const res = await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('warnings');
    expect(res.body.warnings[0]).toContain('persist_failed');
    expect(res.body.run_id).toBeNull();
  });

  it('passes configId to saveRun when config was resolved', async () => {
    mockRepository.getConfig.mockResolvedValue(MOCK_CONFIG_RECORD);

    await request(app)
      .post('/analyze')
      .set('Authorization', AUTH_HEADER)
      .send({ account_id: VALID_UUID });

    expect(mockRepository.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: VALID_UUID,
        configId: CONFIG_ID,
        analysisType: 'funnel'
      })
    );
  });
});

// ─────────────────────────────────────────────
describe('GET /configs/:account_id', () => {
  it('retorna 404 quando config não existe', async () => {
    mockRepository.getConfig.mockResolvedValue(null);
    const res = await request(app)
      .get(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('retorna o config quando encontrado', async () => {
    mockRepository.getConfig.mockResolvedValue({
      id: CONFIG_ID, account_id: VALID_UUID, stage_config: VALID_STAGE_CONFIG
    });
    const res = await request(app)
      .get(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CONFIG_ID);
  });

  it('retorna 400 para UUID inválido', async () => {
    const res = await request(app)
      .get('/configs/nao-um-uuid')
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getConfig.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app)
      .get(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('PUT /configs/:account_id', () => {
  it('faz upsert e retorna o config salvo', async () => {
    mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID, account_id: VALID_UUID });
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .send({ stage_config: VALID_STAGE_CONFIG });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CONFIG_ID);
    expect(mockRepository.saveConfig).toHaveBeenCalledWith(
      VALID_UUID, 'manual', VALID_STAGE_CONFIG
    );
  });

  it('usa prompt_hash fornecido quando presente', async () => {
    mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID });
    await request(app)
      .put(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .send({ stage_config: VALID_STAGE_CONFIG, prompt_hash: 'custom-hash' });
    expect(mockRepository.saveConfig).toHaveBeenCalledWith(
      VALID_UUID, 'custom-hash', VALID_STAGE_CONFIG
    );
  });

  it('retorna 400 quando stage_config não tem stages', async () => {
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .send({ stage_config: { not_stages: [] } });
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando stage_config não é objeto', async () => {
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .send({ stage_config: 'invalido' });
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.saveConfig.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .send({ stage_config: VALID_STAGE_CONFIG });
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('GET /runs/:account_id', () => {
  it('retorna lista vazia quando não há runs', async () => {
    mockRepository.getRuns.mockResolvedValue([]);
    const res = await request(app)
      .get(`/runs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retorna runs quando existem', async () => {
    mockRepository.getRuns.mockResolvedValue([
      { id: RUN_ID, analyzed_at: '2026-04-16T00:00:00Z' }
    ]);
    const res = await request(app)
      .get(`/runs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(RUN_ID);
  });

  it('passa filtros de query para getRuns', async () => {
    mockRepository.getRuns.mockResolvedValue([]);
    await request(app)
      .get(`/runs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER)
      .query({ from: '2026-04-01', to: '2026-04-30', limit: '10', type: 'funnel' });
    expect(mockRepository.getRuns).toHaveBeenCalledWith(
      VALID_UUID,
      { from: '2026-04-01', to: '2026-04-30', limit: 10, analysisType: 'funnel' }
    );
  });

  it('retorna 400 para UUID inválido', async () => {
    const res = await request(app)
      .get('/runs/nao-um-uuid')
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getRuns.mockRejectedValueOnce(new Error('timeout'));
    const res = await request(app)
      .get(`/runs/${VALID_UUID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('GET /runs/:account_id/:run_id', () => {
  it('retorna 404 quando run não existe', async () => {
    mockRepository.getRunDetail.mockResolvedValue(null);
    const res = await request(app)
      .get(`/runs/${VALID_UUID}/${RUN_ID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(404);
  });

  it('retorna o detalhe do run quando encontrado', async () => {
    const mockDetail = { id: RUN_ID, account_id: VALID_UUID, conversations: [] };
    mockRepository.getRunDetail.mockResolvedValue(mockDetail);
    const res = await request(app)
      .get(`/runs/${VALID_UUID}/${RUN_ID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RUN_ID);
    expect(mockRepository.getRunDetail).toHaveBeenCalledWith(RUN_ID);
  });

  it('retorna 400 quando run_id não é UUID válido', async () => {
    const res = await request(app)
      .get(`/runs/${VALID_UUID}/nao-um-uuid`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando account_id não é UUID válido', async () => {
    const res = await request(app)
      .get(`/runs/nao-um-uuid/${RUN_ID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getRunDetail.mockRejectedValueOnce(new Error('DB unavailable'));
    const res = await request(app)
      .get(`/runs/${VALID_UUID}/${RUN_ID}`)
      .set('Authorization', AUTH_HEADER);
    expect(res.status).toBe(503);
  });
});
