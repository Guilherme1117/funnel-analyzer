// src/supabase.js
'use strict';

const BATCH_SIZE = 100;

/**
 * Generic Supabase REST request helper.
 * @param {Object} opts
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} opts.method
 * @param {string}  opts.path          - e.g. '/rest/v1/funnel_configs'
 * @param {string}  [opts.query]       - e.g. '?account_id=eq.<uuid>'
 * @param {Object}  [opts.body]        - serialized to JSON for non-GET
 * @param {Object}  [opts.extraHeaders]
 */
async function supabaseRequest({ method = 'GET', path, query = '', body, extraHeaders = {} }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const fullUrl = `${url}${path}${query}`;

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extraHeaders
  };

  const options = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);

  const res = await fetch(fullUrl, options);
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);

  // 204 No Content → empty body (sem JSON para parsear)
  if (res.status === 204) return {};

  // Lê o body como texto primeiro para evitar SyntaxError em body vazio.
  // PostgREST pode retornar 200/201 com body vazio em edge cases
  // (ex: RLS bloqueia SELECT do row recém-inserido, ou return=minimal).
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

async function fetchAllChats(accountId) {
  return supabaseRequest({
    path: '/rest/v1/wa_chats',
    query: `?account_id=eq.${accountId}&select=id,chat_type,contact_id,created_at,last_message_at&order=last_message_at.desc&limit=2000`
  });
}

async function fetchMessagesForChats(chatIds, dateRange) {
  const allMessages = [];
  for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE);
    const filter = batch.join(',');
    let query = `?chat_id=in.(${filter})&select=id,chat_id,direction,sent_by,content_text,created_at,message_type&order=created_at.asc&limit=10000`;
    if (dateRange) {
      query += `&created_at=gte.${dateRange.startDate}&created_at=lte.${dateRange.endDate}`;
    }
    const msgs = await supabaseRequest({
      path: '/rest/v1/wa_messages',
      query
    });
    allMessages.push(...msgs);
  }
  return allMessages;
}

function groupMessagesByChat(messages) {
  const map = {};
  for (const m of messages) {
    if (!map[m.chat_id]) map[m.chat_id] = [];
    map[m.chat_id].push(m);
  }
  return map;
}

async function fetchConversations(accountId, dateRange) {
  const chats = await fetchAllChats(accountId);
  const chatIds = chats.map(c => c.id);
  const messages = await fetchMessagesForChats(chatIds, dateRange);
  const messagesByChat = groupMessagesByChat(messages);

  // When filtering by date, only include chats that have messages in range
  const filteredChats = dateRange
    ? chats.filter(c => messagesByChat[c.id] && messagesByChat[c.id].length > 0)
    : chats;

  return { chats: filteredChats, messagesByChat, totalMessages: messages.length };
}

module.exports = { fetchConversations, supabaseRequest };
