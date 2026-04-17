// tests/auth.test.js
'use strict';

const crypto = require('crypto');

// Salva o valor original para restaurar entre testes
const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  process.env.API_TOKEN = 'test-secret-token-abc123';
});

afterAll(() => {
  if (originalToken !== undefined) process.env.API_TOKEN = originalToken;
  else delete process.env.API_TOKEN;
});

const { authMiddleware } = require('../src/auth');

function mockReqRes(authHeader) {
  const req = { headers: {} };
  if (authHeader !== undefined) req.headers['authorization'] = authHeader;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('authMiddleware', () => {
  it('calls next() when token matches', () => {
    const { req, res, next } = mockReqRes('Bearer test-secret-token-abc123');
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next } = mockReqRes(undefined);
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTH_ERROR' })
    );
  });

  it('returns 401 when token is wrong', () => {
    const { req, res, next } = mockReqRes('Bearer wrong-token');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when Authorization header has no Bearer prefix', () => {
    const { req, res, next } = mockReqRes('test-secret-token-abc123');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 500 when API_TOKEN is not configured', () => {
    delete process.env.API_TOKEN;
    const { req, res, next } = mockReqRes('Bearer anything');
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_ERROR' })
    );
  });
});
