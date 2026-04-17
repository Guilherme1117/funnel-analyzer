// src/auth.js
'use strict';

const crypto = require('crypto');
const { apiError } = require('./errors');

/**
 * Middleware de autenticação por token fixo.
 * Valida o header Authorization: Bearer <token> contra process.env.API_TOKEN.
 * Usa comparação de tempo constante para prevenir timing attacks.
 */
function authMiddleware(req, res, next) {
  const envToken = process.env.API_TOKEN;
  if (!envToken) {
    return apiError(res, 500, 'INTERNAL_ERROR', 'Autenticação não configurada no servidor');
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return apiError(res, 401, 'AUTH_ERROR', 'Token de autenticação não fornecido. Use o header Authorization: Bearer <token>');
  }

  const token = authHeader.slice(7);

  // Comparação de tempo constante — ambos buffers devem ter o mesmo comprimento
  const tokenBuf = Buffer.from(token);
  const envBuf = Buffer.from(envToken);

  if (tokenBuf.length !== envBuf.length || !crypto.timingSafeEqual(tokenBuf, envBuf)) {
    return apiError(res, 401, 'AUTH_ERROR', 'Token de autenticação inválido');
  }

  next();
}

module.exports = { authMiddleware };
