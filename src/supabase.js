const BATCH_SIZE = 100;

async function fetchJSON(url, key) {
  const res = await fetch(url, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAllChats(accountId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const endpoint = `${url}/rest/v1/wa_chats?account_id=eq.${accountId}&select=id,chat_type,contact_id,created_at,last_message_at&order=last_message_at.desc&limit=2000`;
  return fetchJSON(endpoint, key);
}

async function fetchMessagesForChats(chatIds) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const allMessages = [];

  for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE);
    const filter = batch.join(',');
    const endpoint = `${url}/rest/v1/wa_messages?chat_id=in.(${filter})&select=id,chat_id,direction,sent_by,content_text,created_at,message_type&order=created_at.asc&limit=10000`;
    const msgs = await fetchJSON(endpoint, key);
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

async function fetchConversations(accountId) {
  const chats = await fetchAllChats(accountId);
  const chatIds = chats.map(c => c.id);
  const messages = await fetchMessagesForChats(chatIds);
  const messagesByChat = groupMessagesByChat(messages);
  return { chats, messagesByChat, totalMessages: messages.length };
}

module.exports = { fetchConversations };
