// tests/repository.test.js
'use strict';

// Mock supabaseRequest antes de importar repository
const mockSupabaseRequest = jest.fn();
jest.mock('../src/supabase', () => ({
  fetchConversations: jest.fn(),
  supabaseRequest: (...args) => mockSupabaseRequest(...args)
}));

const repository = require('../src/repository');

const ACCOUNT_ID = '123e4567-e89b-12d3-a456-426614174000';
const CONFIG_ID  = '223e4567-e89b-12d3-a456-426614174001';
const RUN_ID     = '323e4567-e89b-12d3-a456-426614174002';
const CONV_ID    = '423e4567-e89b-12d3-a456-426614174003';

const STAGE_CONFIG = {
  stages: [
    { code: 'SAUDACAO', keywords: ['oi'],      indicates_professional: false },
    { code: 'QUEIXA',   keywords: ['papada'],  indicates_professional: true  }
  ]
};

beforeEach(() => mockSupabaseRequest.mockReset());

// ─────────────────────────────────────────────
// saveConfig
// ─────────────────────────────────────────────
describe('saveConfig', () => {
  it('faz upsert e retorna o registro salvo', async () => {
    mockSupabaseRequest.mockResolvedValue([{
      id: CONFIG_ID, account_id: ACCOUNT_ID, updated_at: '2026-01-01T00:00:00Z'
    }]);

    const result = await repository.saveConfig(ACCOUNT_ID, 'abc123', STAGE_CONFIG);

    expect(mockSupabaseRequest).toHaveBeenCalledTimes(1);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/rest/v1/funnel_configs');
    expect(call.body.account_id).toBe(ACCOUNT_ID);
    expect(call.body.prompt_hash).toBe('abc123');
    expect(call.body.stage_config).toEqual(STAGE_CONFIG);
    expect(call.extraHeaders['Prefer']).toContain('merge-duplicates');
    expect(result.id).toBe(CONFIG_ID);
  });

  it('retorna o primeiro elemento quando supabase devolve array', async () => {
    mockSupabaseRequest.mockResolvedValue([{ id: CONFIG_ID }]);
    const result = await repository.saveConfig(ACCOUNT_ID, 'h1', STAGE_CONFIG);
    expect(result.id).toBe(CONFIG_ID);
  });

  it('retorna o objeto direto quando supabase não devolve array', async () => {
    mockSupabaseRequest.mockResolvedValue({ id: CONFIG_ID });
    const result = await repository.saveConfig(ACCOUNT_ID, 'h2', STAGE_CONFIG);
    expect(result.id).toBe(CONFIG_ID);
  });
});

// ─────────────────────────────────────────────
// getConfig
// ─────────────────────────────────────────────
describe('getConfig', () => {
  it('retorna o config quando encontrado', async () => {
    mockSupabaseRequest.mockResolvedValue([{
      id: CONFIG_ID, account_id: ACCOUNT_ID, stage_config: STAGE_CONFIG
    }]);

    const result = await repository.getConfig(ACCOUNT_ID);

    expect(result.id).toBe(CONFIG_ID);
    expect(result.stage_config).toEqual(STAGE_CONFIG);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain(`account_id=eq.${ACCOUNT_ID}`);
  });

  it('retorna null quando não encontrado (array vazio)', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    const result = await repository.getConfig(ACCOUNT_ID);
    expect(result).toBeNull();
  });

  it('retorna null quando supabase retorna null', async () => {
    mockSupabaseRequest.mockResolvedValue(null);
    const result = await repository.getConfig(ACCOUNT_ID);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────
// getConfigById
// ─────────────────────────────────────────────
describe('getConfigById', () => {
  it('retorna o config quando encontrado por id', async () => {
    mockSupabaseRequest.mockResolvedValue([{
      id: CONFIG_ID, account_id: ACCOUNT_ID, stage_config: STAGE_CONFIG
    }]);

    const result = await repository.getConfigById(CONFIG_ID);

    expect(result.id).toBe(CONFIG_ID);
    expect(result.stage_config).toEqual(STAGE_CONFIG);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain(`id=eq.${CONFIG_ID}`);
  });

  it('retorna null quando não encontrado (array vazio)', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    const result = await repository.getConfigById(CONFIG_ID);
    expect(result).toBeNull();
  });

  it('retorna null quando supabase retorna null', async () => {
    mockSupabaseRequest.mockResolvedValue(null);
    const result = await repository.getConfigById(CONFIG_ID);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────
// saveRun
// ─────────────────────────────────────────────
describe('saveRun', () => {
  const baseRunData = {
    accountId:    ACCOUNT_ID,
    configId:     CONFIG_ID,
    analysisType: 'funnel',
    meta:         { total_chats: 5, professional: 3, personal: 2, total_messages: 100 },
    metrics:      {
      tracks:        { pure_ia: { count: 3 } },
      stages:        [],
      conversion:    [],
      top_sequences: [],
      anomalies:     { out_of_order_count: 0 }
    },
    classified: [],
    reportMd:   '# Report'
  };

  it('insere o run e retorna o run_id quando classified está vazio', async () => {
    mockSupabaseRequest.mockResolvedValue([{ id: RUN_ID }]);

    const runId = await repository.saveRun(baseRunData);

    expect(runId).toBe(RUN_ID);
    // Apenas 1 call: insert do run (sem conversas)
    expect(mockSupabaseRequest).toHaveBeenCalledTimes(1);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/rest/v1/analysis_runs');
    expect(call.body.account_id).toBe(ACCOUNT_ID);
    expect(call.body.funnel_config_id).toBe(CONFIG_ID);
    expect(call.body.total_chats).toBe(5);
    expect(call.body.professional_count).toBe(3);
    expect(call.body.personal_count).toBe(2);
    expect(call.body.analysis_type).toBe('funnel');
    expect(call.body.report_md).toBe('# Report');
  });

  it('usa null para funnel_config_id quando configId não é fornecido', async () => {
    mockSupabaseRequest.mockResolvedValue([{ id: RUN_ID }]);
    await repository.saveRun({ ...baseRunData, configId: null });
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.body.funnel_config_id).toBeNull();
  });

  it('insere conversas e eventos quando classified tem dados', async () => {
    const classified = [{
      chatId:        'chat-1',
      msgCount:      10,
      inboundCount:  5,
      track:         'pure_ia',
      furthest:      'QUEIXA',
      stages:        ['SAUDACAO', 'QUEIXA'],
      outboundIA:    5,
      outboundHuman: 0,
      events: [
        { stage: 'SAUDACAO', sender: 'IA',      timestamp: '2026-01-01T10:00', preview: 'Olá!' },
        { stage: 'QUEIXA',   sender: 'PATIENT',  timestamp: '2026-01-01T10:01', preview: 'Papada' }
      ]
    }];

    // 3 calls: insert run → insert convs → insert events
    mockSupabaseRequest
      .mockResolvedValueOnce([{ id: RUN_ID }])
      .mockResolvedValueOnce([{ id: CONV_ID, chat_id: 'chat-1' }])
      .mockResolvedValueOnce({});

    const runId = await repository.saveRun({ ...baseRunData, classified });

    expect(runId).toBe(RUN_ID);
    expect(mockSupabaseRequest).toHaveBeenCalledTimes(3);

    // Verifica insert de conversas
    const convsCall = mockSupabaseRequest.mock.calls[1][0];
    expect(convsCall.path).toBe('/rest/v1/analysis_conversations');
    expect(Array.isArray(convsCall.body)).toBe(true);
    expect(convsCall.body[0].run_id).toBe(RUN_ID);
    expect(convsCall.body[0].chat_id).toBe('chat-1');
    expect(convsCall.body[0].track).toBe('pure_ia');

    // Verifica insert de eventos
    const eventsCall = mockSupabaseRequest.mock.calls[2][0];
    expect(eventsCall.path).toBe('/rest/v1/analysis_events');
    expect(eventsCall.body).toHaveLength(2);
    expect(eventsCall.body[0].stage).toBe('SAUDACAO');
    expect(eventsCall.body[0].conversation_id).toBe(CONV_ID);
    expect(eventsCall.body[1].stage).toBe('QUEIXA');
  });

  it('não insere eventos quando conversas não têm events', async () => {
    const classified = [{
      chatId: 'chat-1', msgCount: 5, inboundCount: 3,
      track: 'pure_ia', furthest: 'SAUDACAO',
      stages: ['SAUDACAO'], outboundIA: 2, outboundHuman: 0,
      events: []
    }];

    mockSupabaseRequest
      .mockResolvedValueOnce([{ id: RUN_ID }])
      .mockResolvedValueOnce([{ id: CONV_ID, chat_id: 'chat-1' }]);

    await repository.saveRun({ ...baseRunData, classified });

    // Apenas 2 calls: run + convs (sem events porque eventRows.length === 0)
    expect(mockSupabaseRequest).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────
// getRuns
// ─────────────────────────────────────────────
describe('getRuns', () => {
  it('retorna lista de runs para um account_id', async () => {
    const mockRuns = [{ id: RUN_ID, analyzed_at: '2026-04-16T00:00:00Z' }];
    mockSupabaseRequest.mockResolvedValue(mockRuns);

    const result = await repository.getRuns(ACCOUNT_ID);

    expect(result).toEqual(mockRuns);
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain(`account_id=eq.${ACCOUNT_ID}`);
    expect(call.query).toContain('limit=50');
    expect(call.query).toContain('order=analyzed_at.desc');
  });

  it('aplica filtro de data from/to', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    await repository.getRuns(ACCOUNT_ID, { from: '2026-04-01', to: '2026-04-30' });
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain('analyzed_at=gte.2026-04-01');
    expect(call.query).toContain('analyzed_at=lte.2026-04-30');
  });

  it('aplica filtro de limit e analysisType', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    await repository.getRuns(ACCOUNT_ID, { limit: 10, analysisType: 'custom' });
    const call = mockSupabaseRequest.mock.calls[0][0];
    expect(call.query).toContain('limit=10');
    expect(call.query).toContain('analysis_type=eq.custom');
  });
});

// ─────────────────────────────────────────────
// getRunDetail
// ─────────────────────────────────────────────
describe('getRunDetail', () => {
  it('retorna null quando run não encontrado', async () => {
    mockSupabaseRequest.mockResolvedValue([]);
    const result = await repository.getRunDetail(RUN_ID);
    expect(result).toBeNull();
  });

  it('retorna run com conversas quando encontrado', async () => {
    const mockRun = { id: RUN_ID, account_id: ACCOUNT_ID, total_chats: 5 };
    const mockConvs = [{ id: CONV_ID, chat_id: 'chat-1', analysis_events: [] }];

    mockSupabaseRequest
      .mockResolvedValueOnce([mockRun])
      .mockResolvedValueOnce(mockConvs);

    const result = await repository.getRunDetail(RUN_ID);

    expect(result.id).toBe(RUN_ID);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].id).toBe(CONV_ID);
    // Verifica que a query de conversas usa embedding
    const convsCall = mockSupabaseRequest.mock.calls[1][0];
    expect(convsCall.query).toContain(`run_id=eq.${RUN_ID}`);
    expect(convsCall.query).toContain('analysis_events(*)');
  });

  it('retorna conversations como array vazio quando supabase retorna null', async () => {
    const mockRun = { id: RUN_ID, account_id: ACCOUNT_ID };
    mockSupabaseRequest
      .mockResolvedValueOnce([mockRun])
      .mockResolvedValueOnce(null);

    const result = await repository.getRunDetail(RUN_ID);
    expect(result.conversations).toEqual([]);
  });
});
