'use strict';

/**
 * Envia uma resposta de erro padronizada.
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {string} code - Código de erro (VALIDATION_ERROR, NOT_FOUND, AUTH_ERROR, etc.)
 * @param {string} message - Mensagem descritiva do erro
 * @param {Object} [details] - Detalhes adicionais (campo, motivo, etc.)
 */
function apiError(res, status, code, message, details) {
  const body = { error: message, code };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

module.exports = { apiError };
