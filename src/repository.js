// src/repository.js
'use strict';

const { supabaseRequest } = require('./supabase');

/**
 * Salva ou atualiza o stageConfig de um cliente.
 * Faz upsert por account_id (única config por cliente).
 * Retorna o registro salvo (com id).
 */
async function saveConfig(accountId, promptHash, stageConfig) {
  const rows = await supabaseRequest({
    method: 'POST',
    path: '/rest/v1/funnel_configs',
    query: '?on_conflict=account_id&select=id,account_id,updated_at',
    body: {
      account_id:   accountId,
      prompt_hash:  promptHash,
      stage_config: stageConfig,
      updated_at:   new Date().toISOString()
    },
    extraHeaders: {
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/**
 * Busca o stageConfig salvo para um cliente.
 * Retorna null se não encontrado.
 */
async function getConfig(accountId) {
  const rows = await supabaseRequest({
    path: '/rest/v1/funnel_configs',
    query: `?account_id=eq.${accountId}&select=id,account_id,prompt_hash,stage_config,created_at,updated_at&limit=1`
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Persiste uma execução completa de análise.
 * Insere analysis_runs, depois analysis_conversations em batch,
 * depois analysis_events em batch.
 * Retorna o run_id gerado.
 *
 * @param {Object} runData
 * @param {string} runData.accountId
 * @param {string|null} runData.configId
 * @param {string} runData.analysisType  - 'funnel' por padrão
 * @param {Object} runData.meta          - { total_chats, professional, personal, total_messages }
 * @param {Object} runData.metrics       - { tracks, stages, conversion, top_sequences, anomalies }
 * @param {Array}  runData.classified    - array de conversas classificadas
 * @param {string} runData.reportMd
 */
async function saveRun(runData) {
  const {
    accountId, configId, analysisType = 'funnel',
    meta, metrics, classified, reportMd
  } = runData;

  // 1. Inserir o run agregado
  const runRows = await supabaseRequest({
    method: 'POST',
    path: '/rest/v1/analysis_runs',
    query: '?select=id',
    body: {
      account_id:         accountId,
      funnel_config_id:   configId || null,
      analysis_type:      analysisType,
      total_chats:        meta.total_chats,
      professional_count: meta.professional,
      personal_count:     meta.personal,
      total_messages:     meta.total_messages,
      tracks:             metrics.tracks,
      stages_summary:     metrics.stages,
      conversion:         metrics.conversion,
      top_sequences:      metrics.top_sequences,
      anomalies:          metrics.anomalies,
      report_md:          reportMd,
      analyzed_at:        new Date().toISOString()
    },
    extraHeaders: { 'Prefer': 'return=representation' }
  });
  const runId = Array.isArray(runRows) ? runRows[0].id : runRows.id;

  // 2. Inserir conversas em batch (apenas se houver)
  if (!classified || classified.length === 0) return runId;

  const convRows = classified.map(c => ({
    run_id:         runId,
    chat_id:        c.chatId,
    msg_count:      c.msgCount,
    inbound_count:  c.inboundCount,
    track:          c.track,
    furthest_stage: c.furthest,
    stages:         c.stages || [],
    outbound_ia:    c.outboundIA,
    outbound_human: c.outboundHuman
  }));

  const savedConvs = await supabaseRequest({
    method: 'POST',
    path: '/rest/v1/analysis_conversations',
    query: '?select=id,chat_id',
    body: convRows,
    extraHeaders: { 'Prefer': 'return=representation' }
  });

  // 3. Inserir eventos em batch — monta mapa chatId → conv.id
  const chatToConvId = {};
  for (const conv of (Array.isArray(savedConvs) ? savedConvs : [])) {
    chatToConvId[conv.chat_id] = conv.id;
  }

  const eventRows = [];
  for (const c of classified) {
    const convId = chatToConvId[c.chatId];
    if (!convId) continue;
    for (const ev of (c.events || [])) {
      eventRows.push({
        conversation_id: convId,
        stage:           ev.stage,
        sender:          ev.sender,
        event_timestamp: ev.timestamp,
        preview:         ev.preview
      });
    }
  }

  if (eventRows.length > 0) {
    await supabaseRequest({
      method: 'POST',
      path: '/rest/v1/analysis_events',
      body: eventRows,
      extraHeaders: { 'Prefer': 'return=minimal' }
    });
  }

  return runId;
}

/**
 * Lista execuções de análise de um cliente, da mais recente para a mais antiga.
 * @param {string} accountId
 * @param {Object} filters
 * @param {string} [filters.from]          - ISO date string
 * @param {string} [filters.to]            - ISO date string
 * @param {number} [filters.limit=50]
 * @param {string} [filters.analysisType]
 */
async function getRuns(accountId, filters = {}) {
  const { from, to, limit = 50, analysisType } = filters;
  let query = `?account_id=eq.${accountId}`;
  query += '&select=id,account_id,analysis_type,total_chats,professional_count,personal_count,total_messages,analyzed_at';
  if (from)         query += `&analyzed_at=gte.${from}`;
  if (to)           query += `&analyzed_at=lte.${to}`;
  if (analysisType) query += `&analysis_type=eq.${analysisType}`;
  query += `&order=analyzed_at.desc&limit=${limit}`;

  return supabaseRequest({ path: '/rest/v1/analysis_runs', query });
}

/**
 * Retorna o detalhe completo de uma execução, incluindo conversas e eventos aninhados.
 * Retorna null se não encontrado.
 */
async function getRunDetail(runId) {
  const runs = await supabaseRequest({
    path: '/rest/v1/analysis_runs',
    query: `?id=eq.${runId}&select=*&limit=1`
  });
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const run = runs[0];

  // Busca conversas com eventos aninhados via PostgREST resource embedding
  const conversations = await supabaseRequest({
    path: '/rest/v1/analysis_conversations',
    query: `?run_id=eq.${runId}&select=*,analysis_events(*)&order=furthest_stage.asc`
  });

  return { ...run, conversations: Array.isArray(conversations) ? conversations : [] };
}

module.exports = { saveConfig, getConfig, saveRun, getRuns, getRunDetail };
