// tests/supabase.test.js
'use strict';

// Mock fetch globalmente
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Configura env necessário
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const { fetchConversations } = require('../src/supabase');

beforeEach(() => mockFetch.mockReset());

function mockFetchResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(data))
  };
}

describe('fetchConversations with date filters', () => {
  it('adds date filters to wa_messages query when startDate and endDate are provided', async () => {
    // Mock chats response
    mockFetch.mockResolvedValueOnce(mockFetchResponse([{ id: 'chat-1' }]));
    // Mock messages response
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'msg-1', chat_id: 'chat-1', direction: 'inbound', content_text: 'oi', created_at: '2026-04-10T10:00:00Z' }
    ]));

    await fetchConversations('123e4567-e89b-12d3-a456-426614174000', {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });

    // Segunda chamada = mensagens
    const messagesUrl = mockFetch.mock.calls[1][0];
    expect(messagesUrl).toContain('created_at=gte.2026-04-01T00:00:00Z');
    expect(messagesUrl).toContain('created_at=lte.2026-04-15T23:59:59Z');
  });

  it('does not add date filters when dateRange is not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse([{ id: 'chat-1' }]));
    mockFetch.mockResolvedValueOnce(mockFetchResponse([]));

    await fetchConversations('123e4567-e89b-12d3-a456-426614174000');

    const messagesUrl = mockFetch.mock.calls[1][0];
    expect(messagesUrl).not.toContain('created_at=gte.');
    expect(messagesUrl).not.toContain('created_at=lte.');
  });

  it('filters out chats with no messages in the date range', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'chat-1' },
      { id: 'chat-2' }
    ]));
    // Only chat-1 has messages in range
    mockFetch.mockResolvedValueOnce(mockFetchResponse([
      { id: 'msg-1', chat_id: 'chat-1', content_text: 'oi', created_at: '2026-04-10T10:00:00Z' }
    ]));

    const result = await fetchConversations('123e4567-e89b-12d3-a456-426614174000', {
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-04-15T23:59:59Z'
    });

    // messagesByChat should only contain chat-1
    expect(Object.keys(result.messagesByChat)).toEqual(['chat-1']);
    // chats should be filtered to only those with messages
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].id).toBe('chat-1');
  });
});
