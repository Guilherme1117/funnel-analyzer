'use strict';

const { apiError } = require('../src/errors');

describe('apiError', () => {
  it('sends JSON response with error, code, and details', () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    apiError(res, 400, 'VALIDATION_ERROR', 'account_id must be a valid UUID', { field: 'account_id' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'account_id must be a valid UUID',
      code: 'VALIDATION_ERROR',
      details: { field: 'account_id' }
    });
  });

  it('omits details when not provided', () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    apiError(res, 401, 'AUTH_ERROR', 'Token inválido');

    expect(res.json).toHaveBeenCalledWith({
      error: 'Token inválido',
      code: 'AUTH_ERROR'
    });
  });
});
