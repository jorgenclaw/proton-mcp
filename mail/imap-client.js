/**
 * IMAP client for Proton Bridge
 * Handles read operations: list, get, search, unread, thread, mark
 *
 * Message IDs are IMAP UIDs, which are stable within a folder. (Sequence
 * numbers shift whenever mail arrives or is removed, so acting on one later
 * can hit the wrong message.)
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

/**
 * Create a short-lived IMAP connection, run `fn`, then close.
 */
async function withImap(config, fn) {
  const client = new ImapFlow({
    host: config.imap_host || '127.0.0.1',
    port: config.imap_port || 1143,
    secure: false,
    doSTARTTLS: false, // Bridge listens on loopback only
    auth: { user: config.username, pass: config.password },
    logger: false,
  });
  // Without a listener, a socket error would crash the whole MCP server
  client.on('error', () => {});

  try {
    await client.connect();
  } catch (err) {
    throw new Error(`IMAP connection failed: ${err.responseText || err.message}. Is Proton Bridge running?`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/**
 * Fetch raw messages by UID (or by sequence range when bySeq is set).
 * Returns [{ uid, flags, raw: Buffer }].
 */
async function fetchRaw(client, source, bodiesOpt = '', { bySeq = false } = {}) {
  if (source.length === 0) return [];
  const query = { uid: true, flags: true, ...(bodiesOpt === 'HEADER' ? { headers: true } : { source: true }) };
  const messages = [];
  for await (const msg of client.fetch(source, query, { uid: !bySeq })) {
    messages.push({ uid: msg.uid, flags: [...(msg.flags || [])], raw: msg.headers || msg.source || Buffer.alloc(0) });
  }
  return messages;
}

/**
 * Fetch messages and parse them. Returns parsed message objects.
 */
async function fetchMessages(client, source, bodiesOpt = '', opts) {
  const parsed = [];
  for (const m of await fetchRaw(client, source, bodiesOpt, opts)) {
    const seen = m.flags.includes('\\Seen');
    try {
      const mail = await simpleParser(m.raw);
      parsed.push({
        id: m.uid,
        subject: mail.subject || '(no subject)',
        from: mail.from?.text || 'unknown',
        to: mail.to?.text || '',
        cc: mail.cc?.text || '',
        date: mail.date?.toISOString() || '',
        body: mail.text || mail.html || '',
        message_id_header: mail.messageId || null,
        in_reply_to: mail.inReplyTo || null,
        references: [].concat(mail.references || []),
        seen,
      });
    } catch {
      parsed.push({ id: m.uid, subject: '(parse error)', from: '', to: '', date: '', body: '', message_id_header: null, in_reply_to: null, references: [], seen });
    }
  }
  return parsed;
}

function openFolder(client, folder, readOnly = true) {
  return client.mailboxOpen(folder, { readOnly });
}

/**
 * IMAP SEARCH wrapper. Returns UIDs.
 */
async function imapSearch(client, query) {
  return (await client.search(query, { uid: true })) || [];
}

// --- Exported operations ---

export async function getUnread(config) {
  return withImap(config, async (client) => {
    await openFolder(client, 'INBOX', true);
    const uids = await imapSearch(client, { seen: false });
    if (uids.length === 0) return { count: 0, messages: [] };

    const recent = uids.slice(-20);
    const messages = await fetchMessages(client, recent, 'HEADER');
    return {
      count: uids.length,
      messages: messages.map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from,
        date: m.date,
      })),
    };
  });
}

export async function listMessages(config, limit = 10) {
  return listMessagesInFolder(config, 'INBOX', limit);
}

export async function getMessage(config, messageId, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, true);
    const messages = await fetchMessages(client, [messageId], '');
    if (messages.length === 0) throw new Error(`Message ${messageId} not found in ${folder}`);
    return messages[0];
  });
}

export async function searchMessages(config, query) {
  return withImap(config, async (client) => {
    const allMessages = [];
    const folders = ['INBOX', 'Sent', 'Drafts', 'Archive'];

    for (const folder of folders) {
      try {
        await openFolder(client, folder, true);
        const uids = await imapSearch(client, { text: query });
        if (uids.length > 0) {
          const recent = uids.slice(-10);
          const messages = await fetchMessages(client, recent, 'HEADER');
          allMessages.push(...messages.map((m) => ({ ...m, body: undefined, folder })));
        }
      } catch {
        // Folder may not exist — skip silently
      }
    }

    // Sort by date descending, return up to 20 results
    allMessages.sort((a, b) => new Date(b.date) - new Date(a.date));
    return allMessages.slice(0, 20);
  });
}

export async function getMessageHeaders(config, messageId, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, true);
    const messages = await fetchMessages(client, [messageId], 'HEADER');
    if (messages.length === 0) throw new Error(`Message ${messageId} not found in ${folder}`);
    return {
      messageId: messages[0].message_id_header,
      subject: messages[0].subject,
      from: messages[0].from,
      to: messages[0].to,
      cc: messages[0].cc || null,
      references: messages[0].references,
      inReplyTo: messages[0].in_reply_to,
    };
  });
}

export async function getThread(config, messageId, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, true);

    // 1. Fetch the starting message to get its threading headers
    const startMsgs = await fetchMessages(client, [messageId], '');
    if (startMsgs.length === 0) throw new Error(`Message ${messageId} not found in ${folder}`);

    // 2. Collect all Message-IDs in the thread
    const refIds = [
      startMsgs[0].message_id_header,
      ...(startMsgs[0].references || []),
      startMsgs[0].in_reply_to,
    ].filter(Boolean);

    // 3. Search the folder for each referenced Message-ID
    const allUids = new Set([messageId]);
    for (const id of refIds) {
      const results = await imapSearch(client, { header: { 'message-id': id } });
      results.forEach(n => allUids.add(n));
    }

    // 4. Fetch all matching messages
    const threadMsgs = await fetchMessages(client, [...allUids], '');

    // 5. Sort chronologically
    return threadMsgs.sort((a, b) => new Date(a.date) - new Date(b.date));
  });
}

async function setFlag(config, messageId, flag, on, folder) {
  return withImap(config, async (client) => {
    await openFolder(client, folder, false);
    const fn = on ? client.messageFlagsAdd : client.messageFlagsRemove;
    if (!(await fn.call(client, [messageId], [flag], { uid: true }))) {
      throw new Error(`Could not update message ${messageId} in ${folder}`);
    }
  });
}

export async function markMessage(config, messageId, read, folder = 'INBOX') {
  await setFlag(config, messageId, '\\Seen', read, folder);
  return { success: true, message_id: messageId, read };
}

export async function starMessage(config, messageId, star, folder = 'INBOX') {
  await setFlag(config, messageId, '\\Flagged', star, folder);
  return { success: true, message_id: messageId, starred: star };
}

// UID EXPUNGE (UIDPLUS) removes only this message, not every message in the
// folder that happens to carry \Deleted.
export async function deleteMessage(config, messageId, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, false);
    if (!(await client.messageDelete([messageId], { uid: true }))) {
      throw new Error(`Could not delete message ${messageId} in ${folder}`);
    }
    return { success: true, message_id: messageId, deleted: true };
  });
}

export async function moveMessage(config, messageId, destFolder, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, false);
    const result = await client.messageMove([messageId], destFolder, { uid: true });
    if (!result) throw new Error(`Could not move message ${messageId} from ${folder} to ${destFolder}`);
    return { success: true, message_id: messageId, moved_to: destFolder, new_id: result.uidMap?.get(messageId) ?? null };
  });
}

export async function listFolders(config) {
  return withImap(config, async (client) => {
    const boxes = await client.list();
    return boxes.map((b) => ({ name: b.path, delimiter: b.delimiter }));
  });
}

export async function listMessagesInFolder(config, folder, limit = 10) {
  return withImap(config, async (client) => {
    const box = await openFolder(client, folder, true);
    const total = box.exists;
    if (total === 0) return [];

    const start = Math.max(1, total - limit + 1);
    const range = `${start}:${total}`;

    const messages = await fetchMessages(client, range, 'HEADER', { bySeq: true });
    return messages
      .map((m) => ({ ...m, body: undefined }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  });
}

export async function getAttachments(config, messageId, folder = 'INBOX') {
  return withImap(config, async (client) => {
    await openFolder(client, folder, true);
    const [m] = await fetchRaw(client, [messageId], '');
    if (!m) throw new Error(`Message ${messageId} not found in ${folder}`);

    const mail = await simpleParser(m.raw);
    return (mail.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      content: a.content.toString('base64'),
    }));
  });
}
