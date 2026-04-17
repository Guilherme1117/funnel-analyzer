// tests/supabase-request.test.js
'use strict';

// Mock do fetch global antes de importar supabase.js
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Variáveis de ambiente necessárias
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const { supabaseRequest } = require('../src/supabase');

function makeResponse(status, body) {
  const text = body ?? '';
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(text),
    json: jest.fn().mockImplementation(() => {
      // Simula o comportamento real do fetch: json() === JSON.parse(text)
      if (text === '') throw new SyntaxError('Unexpected end of JSON input');
      return Promise.resolve(JSON.parse(text));
    })
  };
}

beforeEach(() => mockFetch.mockReset());

// ─────────────────────────────────────────────
// BUG: status 200 com body vazio explode
// ─────────────────────────────────────────────
describe('supabaseRequest — tratamento de body vazio', () => {

  it('não explode quando retorna 200 com body vazio', async () => {
    // Supabase pode responder com 200 e body="" em vez de 204
    // quando return=minimal é aceito mas o servidor não manda 204
    mockFetch.mockResolvedValue(makeResponse(200, ''));

    // Antes do fix, isso lança: SyntaxError: Unexpected end of JSON input
    await expect(
      supabaseRequest({ method: 'POST', path: '/rest/v1/analysis_runs', query: '?select=id', body: {} })
    ).resolves.toBeDefined();
  });

  it('não explode quando retorna 201 com body vazio', async () => {
    // Edge case: 201 Created mas sem body (ex: RLS bloqueou o SELECT do inserted row)
    mockFetch.mockResolvedValue(makeResponse(201, ''));

    await expect(
      supabaseRequest({ method: 'POST', path: '/rest/v1/analysis_runs', query: '?select=id', body: {} })
    ).resolves.toBeDefined();
  });

  // ─────────────────────────────────────────────
  // Comportamentos existentes que devem continuar funcionando
  // ─────────────────────────────────────────────

  it('retorna {} quando status é 204 (No Content)', async () => {
    mockFetch.mockResolvedValue(makeResponse(204, ''));

    const result = await supabaseRequest({ path: '/rest/v1/analysis_events', method: 'POST', body: [] });
    expect(result).toEqual({});
  });

  it('retorna JSON parseado quando status é 200 com body válido', async () => {
    const payload = [{ id: 'abc-123' }];
    mockFetch.mockResolvedValue(makeResponse(200, JSON.stringify(payload)));

    const result = await supabaseRequest({ path: '/rest/v1/analysis_runs', query: '?select=id' });
    expect(result).toEqual(payload);
  });

  it('retorna JSON parseado quando status é 201 com body válido', async () => {
    const payload = [{ id: 'xyz-456' }];
    mockFetch.mockResolvedValue(makeResponse(201, JSON.stringify(payload)));

    const result = await supabaseRequest({ method: 'POST', path: '/rest/v1/funnel_configs', body: {} });
    expect(result).toEqual(payload);
  });

  it('lança erro quando status não é 2xx', async () => {
    mockFetch.mockResolvedValue(makeResponse(400, 'Bad Request'));

    await expect(
      supabaseRequest({ path: '/rest/v1/analysis_runs' })
    ).rejects.toThrow('Supabase error 400');
  });

  it('lança erro quando status é 500', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, 'Internal Server Error'));

    await expect(
      supabaseRequest({ path: '/rest/v1/analysis_runs' })
    ).rejects.toThrow('Supabase error 500');
  });
});
