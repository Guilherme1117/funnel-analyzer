// tests/server.test.js
'use strict';

const request = require('supertest');

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const RUN_ID     = '323e4567-e89b-12d3-a456-426614174002';
const CONFIG_ID  = '223e4567-e89b-12d3-a456-426614174001';

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
  }),
  supabaseRequest: jest.fn()
}));

jest.mock('../src/report-writer', () => ({
  generateReport: jest.fn().mockResolvedValue('# Mock Report')
}));

// Mock repository — por padrão todas as funções de persistência funcionam normalmente
const mockRepository = {
  saveConfig:   jest.fn().mockResolvedValue({ id: CONFIG_ID }),
  getConfig:    jest.fn().mockResolvedValue(null),
  saveRun:      jest.fn().mockResolvedValue(RUN_ID),
  getRuns:      jest.fn().mockResolvedValue([]),
  getRunDetail: jest.fn().mockResolvedValue(null)
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

beforeEach(() => {
  jest.clearAllMocks();
  mockRepository.saveRun.mockResolvedValue(RUN_ID);
  mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID });
  mockRepository.getConfig.mockResolvedValue(null);
  mockRepository.getRuns.mockResolvedValue([]);
  mockRepository.getRunDetail.mockResolvedValue(null);
});

// ─────────────────────────────────────────────
describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────
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

  it('salva config e retorna config_id quando account_id válido é passado', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .send({ prompt: 'prompt válido', account_id: VALID_UUID });

    expect(res.status).toBe(200);
    expect(mockRepository.saveConfig).toHaveBeenCalledWith(VALID_UUID, 'abc123', expect.any(Object));
    expect(res.body.config_id).toBe(CONFIG_ID);
  });

  it('não chama saveConfig e config_id é null quando account_id não é passado', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .send({ prompt: 'prompt sem account_id' });

    expect(res.status).toBe(200);
    expect(mockRepository.saveConfig).not.toHaveBeenCalled();
    expect(res.body.config_id).toBeNull();
  });

  it('retorna 400 quando account_id fornecido não é UUID válido', async () => {
    const res = await request(app)
      .post('/funnel/build')
      .send({ prompt: 'prompt', account_id: 'nao-um-uuid' });
    expect(res.status).toBe(400);
  });

  it('retorna 200 mesmo quando saveConfig falha (falha silenciosa)', async () => {
    mockRepository.saveConfig.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .post('/funnel/build')
      .send({ prompt: 'prompt', account_id: VALID_UUID });
    expect(res.status).toBe(200);
    expect(res.body.config_id).toBeNull();
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

// ─────────────────────────────────────────────
describe('POST /analyze', () => {
  it('returns analysis with run_id when account_id and stageConfig are valid', async () => {
    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('stage_config');
    expect(res.body).toHaveProperty('run_id', RUN_ID);
    expect(res.body.meta.account_id).toBe(VALID_UUID);
    expect(res.body.meta.total_chats).toBe(1);
    expect(res.body.stage_config.stages[0].code).toBe('SAUDACAO');
  });

  it('chama saveRun com os dados corretos', async () => {
    await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(mockRepository.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId:    VALID_UUID,
        analysisType: 'funnel',
        reportMd:     '# Mock Report'
      })
    );
  });

  it('retorna 200 com warnings e run_id null quando saveRun falha (falha silenciosa)', async () => {
    mockRepository.saveRun.mockRejectedValueOnce(new Error('DB offline'));

    const res = await request(app)
      .post('/analyze')
      .send({ account_id: VALID_UUID, stageConfig: VALID_STAGE_CONFIG });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('warnings');
    expect(res.body.warnings[0]).toContain('persist_failed');
    expect(res.body.run_id).toBeNull();
    // Dados de análise ainda devem estar presentes
    expect(res.body).toHaveProperty('funnel');
    expect(res.body).toHaveProperty('report_md');
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

// ─────────────────────────────────────────────
describe('GET /configs/:account_id', () => {
  it('retorna 404 quando config não existe', async () => {
    mockRepository.getConfig.mockResolvedValue(null);
    const res = await request(app).get(`/configs/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('retorna o config quando encontrado', async () => {
    mockRepository.getConfig.mockResolvedValue({
      id: CONFIG_ID, account_id: VALID_UUID, stage_config: VALID_STAGE_CONFIG
    });
    const res = await request(app).get(`/configs/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CONFIG_ID);
  });

  it('retorna 400 para UUID inválido', async () => {
    const res = await request(app).get('/configs/nao-um-uuid');
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getConfig.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get(`/configs/${VALID_UUID}`);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('PUT /configs/:account_id', () => {
  it('faz upsert e retorna o config salvo', async () => {
    mockRepository.saveConfig.mockResolvedValue({ id: CONFIG_ID, account_id: VALID_UUID });
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
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
      .send({ stage_config: VALID_STAGE_CONFIG, prompt_hash: 'custom-hash' });
    expect(mockRepository.saveConfig).toHaveBeenCalledWith(
      VALID_UUID, 'custom-hash', VALID_STAGE_CONFIG
    );
  });

  it('retorna 400 quando stage_config não tem stages', async () => {
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .send({ stage_config: { not_stages: [] } });
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando stage_config não é objeto', async () => {
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .send({ stage_config: 'invalido' });
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.saveConfig.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .put(`/configs/${VALID_UUID}`)
      .send({ stage_config: VALID_STAGE_CONFIG });
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('GET /runs/:account_id', () => {
  it('retorna lista vazia quando não há runs', async () => {
    mockRepository.getRuns.mockResolvedValue([]);
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retorna runs quando existem', async () => {
    mockRepository.getRuns.mockResolvedValue([
      { id: RUN_ID, analyzed_at: '2026-04-16T00:00:00Z' }
    ]);
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(RUN_ID);
  });

  it('passa filtros de query para getRuns', async () => {
    mockRepository.getRuns.mockResolvedValue([]);
    await request(app)
      .get(`/runs/${VALID_UUID}`)
      .query({ from: '2026-04-01', to: '2026-04-30', limit: '10', type: 'funnel' });
    expect(mockRepository.getRuns).toHaveBeenCalledWith(
      VALID_UUID,
      { from: '2026-04-01', to: '2026-04-30', limit: 10, analysisType: 'funnel' }
    );
  });

  it('retorna 400 para UUID inválido', async () => {
    const res = await request(app).get('/runs/nao-um-uuid');
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getRuns.mockRejectedValueOnce(new Error('timeout'));
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────
describe('GET /runs/:account_id/:run_id', () => {
  it('retorna 404 quando run não existe', async () => {
    mockRepository.getRunDetail.mockResolvedValue(null);
    const res = await request(app).get(`/runs/${VALID_UUID}/${RUN_ID}`);
    expect(res.status).toBe(404);
  });

  it('retorna o detalhe do run quando encontrado', async () => {
    const mockDetail = { id: RUN_ID, account_id: VALID_UUID, conversations: [] };
    mockRepository.getRunDetail.mockResolvedValue(mockDetail);
    const res = await request(app).get(`/runs/${VALID_UUID}/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RUN_ID);
    expect(mockRepository.getRunDetail).toHaveBeenCalledWith(RUN_ID);
  });

  it('retorna 400 quando run_id não é UUID válido', async () => {
    const res = await request(app).get(`/runs/${VALID_UUID}/nao-um-uuid`);
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando account_id não é UUID válido', async () => {
    const res = await request(app).get(`/runs/nao-um-uuid/${RUN_ID}`);
    expect(res.status).toBe(400);
  });

  it('retorna 503 quando o banco está indisponível', async () => {
    mockRepository.getRunDetail.mockRejectedValueOnce(new Error('DB unavailable'));
    const res = await request(app).get(`/runs/${VALID_UUID}/${RUN_ID}`);
    expect(res.status).toBe(503);
  });
});
