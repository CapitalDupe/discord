// Adapter for the v3 backend (CapitalDupe/discord-backend, see its docs/API.md): REST under /api/v1 plus Socket.IO.
// It maps the server's response shapes onto the state shapes app.js already renders, so the UI code stays small.
// Loaded only when CONFIG.proto === 'v3'. Pure helpers are exported for node tests at the bottom of the file.
(() => {
'use strict';
const hasWindow = typeof window !== 'undefined';
const C = hasWindow ? window.CONFIG : {};

/* ------------------------------------------------------------------ pure helpers (tested in test/v3.test.js) */
const CHANNEL_TYPES = { TEXT: 'text', ANNOUNCEMENT: 'text', VOICE: 'voice', STAGE: 'voice' };   // forum / media channels are not shown yet
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Emoji keys come from the server and are used as object keys, so reject anything that could poison an object.
const safeKey = k => typeof k === 'string' && k.length > 0 && k.length <= 32 && !BAD_KEYS.has(k);
const colorOf = u => (u && /^#[0-9a-f]{6}$/i.test(u.accentColor || '')) ? u.accentColor : '#949ba4';
const mapChannel = c => (c && CHANNEL_TYPES[c.type]) ? { id: c.id, name: c.name, type: CHANNEL_TYPES[c.type] } : null;
const mapUser = u => ({ id: u.id, name: u.displayName, color: colorOf(u), username: u.username });
const mapMember = m => ({ id: m.userId, name: m.nickname || (m.user && m.user.displayName) || 'Unknown', color: colorOf(m.user), bot: !!(m.user && m.user.isBot), status: m.status || 'OFFLINE' });
const mapServer = (s, channels) => ({ id: s.id, name: s.name, ownerId: s.ownerId, channels });

// Server message -> the shape app.js renders. Reactions arrive as {emoji,count,me}; app.js wants emoji -> [userIds],
// so other people's reactions become opaque placeholders (the UI only needs the count and whether I reacted).
function mapMessage(m, myId) {
  const out = { id: m.id, uid: m.author ? m.author.id : null, name: m.author ? m.author.displayName : 'Deleted user', color: colorOf(m.author), ts: Date.parse(m.createdAt), text: m.content || '' };
  if (m.nonce) out.nonce = m.nonce;
  if (m.editedAt) out.edited = 1;
  if (m.deletedAt) { out.deleted = 1; out.text = ''; }
  const r = {};
  for (const x of m.reactions || []) {
    if (!safeKey(x.emoji) || !(x.count > 0)) continue;
    const a = Array.from({ length: x.count }, (_, i) => '·' + i);
    if (x.me && myId) a[0] = myId;
    r[x.emoji] = a;
  }
  if (Object.keys(r).length) out.r = r;
  return out;
}

function leadingZeroBits(bytes) {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

// Self-hosted proof-of-work challenge (no third-party CAPTCHA): find n so SHA-256(salt + ':' + n) has `difficulty` leading zero bits.
async function solveChallenge(ch, maxTries = 5e6) {
  const enc = new TextEncoder(), subtle = globalThis.crypto.subtle;
  for (let n = 0; n < maxTries; n++) {
    const h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(ch.salt + ':' + n)));
    if (leadingZeroBits(h) >= ch.difficulty) return String(n);
    if (n % 2000 === 1999) await new Promise(r => setTimeout(r, 0));   // yield so the page stays responsive
  }
  throw new Error('Could not complete the check. Please try again.');
}

if (!hasWindow) { module.exports = { mapMessage, mapChannel, mapMember, mapUser, colorOf, safeKey, leadingZeroBits, solveChallenge }; return; }

/* ------------------------------------------------------------------ HTTP with access-token refresh */
// The access token lives in memory only. The refresh token is an HttpOnly cookie the page cannot read, so a page
// reload restores the session through POST /auth/refresh. That cookie is first-party only when this page is served
// from the same site as the API (see README), which is the supported setup.
let meId = null, refreshing = null, timer = null, rt = null;

async function raw(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };   // header required by the API's CSRF check
  if (C.token && !opts.noAuth) headers.Authorization = 'Bearer ' + C.token;
  const res = await fetch(C.apiUrl + path, { method: opts.method || 'GET', headers, credentials: 'include', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data && data.error) || {};
    throw Object.assign(new Error(e.message || 'Request failed (' + res.status + ')'), { status: res.status, code: e.code, details: e.details, retryAfter: res.headers.get('Retry-After') });
  }
  return data;
}

// Authenticated call: on 401 refresh the access token once and retry.
async function api(path, opts) {
  try { return await raw(path, opts); }
  catch (e) {
    if (e.status === 401 && !(opts && opts.noAuth) && await refresh()) return raw(path, opts);
    throw e;
  }
}

function setToken(d) {
  C.token = d.accessToken;
  clearTimeout(timer);
  timer = setTimeout(refresh, Math.max(30, (d.expiresIn || 900) * 0.8) * 1000);   // refresh at 80% of the lifetime
}
function clear() { C.token = ''; clearTimeout(timer); if (rt) rt.close(); }

// Single-flight refresh: concurrent 401s share one request (refresh tokens rotate, so two at once would trip reuse detection).
function refresh() {
  if (!refreshing) {
    refreshing = raw('/auth/refresh', { method: 'POST', noAuth: true, body: {} })
      .then(d => { setToken(d); return true; })
      .catch(() => { C.token = ''; return false; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/* ------------------------------------------------------------------ state loading */
async function loadState() {
  const me = await api('/users/@me');
  meId = me.id;
  const list = await api('/servers');
  const parts = await Promise.all((list.items || []).map(async s => {
    const [ch, mem] = await Promise.all([api('/servers/' + s.id + '/channels'), api('/servers/' + s.id + '/members?limit=100')]);
    return { server: mapServer(s, (ch.items || []).map(mapChannel).filter(Boolean)), members: (mem.items || []).map(mapMember) };
  }));
  const seen = new Map();
  for (const p of parts) for (const m of p.members) if (m.id !== meId && !seen.has(m.id)) seen.set(m.id, m);
  return { user: mapUser(me), members: [...seen.values()], messages: {}, servers: parts.map(p => p.server) };
}

// Latest page, or messages newer than `after`. The API returns each page oldest -> newest.
async function messages(cid, opts = {}) {
  const r = await api('/channels/' + cid + '/messages?limit=50' + (opts.after ? '&after=' + encodeURIComponent(opts.after) : ''));
  return (r.items || []).map(m => mapMessage(m, meId));
}

/* ------------------------------------------------------------------ outgoing actions */
// Each sender returns an event for app.js to apply (or nothing when the optimistic update already covers it).
const senders = {
  async 'msg.new'(e) {
    const m = await api('/channels/' + e.cid + '/messages', { method: 'POST', body: { content: e.m.text, nonce: e.m.id } });   // nonce = local id: retries cannot duplicate
    return { t: 'msg.ack', cid: e.cid, localId: e.m.id, m: mapMessage(m, meId) };
  },
  async 'msg.edit'(e) { await api('/messages/' + e.id, { method: 'PATCH', body: { content: e.text } }); },
  async 'msg.del'(e) { await api('/messages/' + e.id, { method: 'DELETE' }); },
  async 'msg.react'(e) { await api('/messages/' + e.id + '/reactions/' + encodeURIComponent(e.emoji), { method: e.on ? 'DELETE' : 'PUT' }); },
  async 'srv.new'(e) {
    const r = await api('/servers', { method: 'POST', body: { name: e.s.name } });
    return { t: 'srv.new', s: mapServer(r.server, (r.channels || []).map(mapChannel).filter(Boolean)) };
  },
  async 'srv.del'(e) { await api('/servers/' + e.sid + (e.leave ? '/leave' : ''), { method: e.leave ? 'POST' : 'DELETE' }); },
  async 'ch.new'(e) {
    const c = await api('/servers/' + e.sid + '/channels', { method: 'POST', body: { name: e.c.name, type: e.c.type === 'voice' ? 'VOICE' : 'TEXT' } });
    return { t: 'ch.new', sid: e.sid, c: mapChannel(c) };
  },
  async 'ch.del'(e) { await api('/channels/' + e.cid, { method: 'DELETE' }); },
  async 'user.set'(e) { await api('/users/@me', { method: 'PATCH', body: { displayName: e.u.name, accentColor: e.u.color } }); },
};
const perform = e => senders[e.t] ? senders[e.t](e) : Promise.resolve(null);

/* ------------------------------------------------------------------ realtime (Socket.IO) */
// The Socket.IO client script is served by the API itself at /socket.io/socket.io.js, so no CDN is involved.
const loadIo = () => window.io ? Promise.resolve() : new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = C.wsUrl + '/socket.io/socket.io.js'; s.onload = ok; s.onerror = () => no(new Error('Cannot load the realtime client'));
  document.head.append(s);
});

function connect({ onEvent }) {
  const subscribed = new Set();
  let sock = null, first = true, lastTyping = 0;
  loadIo().then(() => {
    // `auth` as a function is re-evaluated on every reconnect, so a refreshed access token is always used.
    sock = window.io(C.wsUrl, { path: '/socket.io', withCredentials: true, auth: cb => cb({ token: C.token }) });
    sock.on('connect', () => {
      for (const id of subscribed) sock.emit('channel:subscribe', { channelId: id }, () => {});   // re-join channel rooms after a reconnect
      onEvent({ t: 'net', up: true, first }); first = false;
    });
    sock.on('disconnect', () => onEvent({ t: 'net', up: false }));
    // A handshake rejected by the server middleware is not retried by socket.io, so refresh and reconnect by hand.
    sock.on('connect_error', async err => {
      if (err && err.message === 'unauthenticated') { if (await refresh()) sock.connect(); else onEvent({ t: 'signed-out' }); }
    });
    sock.on('session:revoked', () => onEvent({ t: 'signed-out' }));
    sock.on('resync', () => onEvent({ t: 'resync' }));

    const on = (name, fn) => sock.on(name, p => { try { const ev = fn(p || {}); if (ev) onEvent(ev); } catch (e) { console.error('Bad ' + name + ' event', e); } });
    on('message:new', p => p.message && { t: 'msg.new', cid: p.message.channelId, m: mapMessage(p.message, meId) });
    on('message:update', p => p.message && { t: 'msg.edit', cid: p.message.channelId, id: p.message.id, text: p.message.content });
    on('message:delete', p => ({ t: 'msg.del', cid: p.channelId, id: p.id }));
    on('reaction:add', p => safeKey(p.emoji) && { t: 'rx.add', cid: p.channelId, id: p.messageId, emoji: p.emoji, uid: p.userId });
    on('reaction:remove', p => safeKey(p.emoji) && { t: 'rx.rm', cid: p.channelId, id: p.messageId, emoji: p.emoji, uid: p.userId });
    on('typing', p => ({ t: 'typing', cid: p.channelId, uid: p.userId }));
    on('presence:update', p => ({ t: 'presence', uid: p.userId, status: p.status }));
    on('channel:create', p => { const c = mapChannel(p.channel); return c && { t: 'ch.new', sid: p.channel.serverId, c }; });
    on('channel:update', p => { const c = mapChannel(p.channel); return c && { t: 'ch.upd', sid: p.channel.serverId, c }; });
    on('channel:delete', p => ({ t: 'ch.del', sid: p.serverId, cid: p.channelId }));
    on('server:update', p => p.server && { t: 'srv.upd', s: { id: p.server.id, name: p.server.name } });
    on('member:add', p => p.member && p.member.user && { t: 'member.new', user: mapMember(p.member) });
    on('member:remove', p => p.userId === meId ? { t: 'srv.del', sid: p.serverId } : null);   // I was removed: drop the server
  }).catch(e => onEvent({ t: 'error', message: e.message }));

  return rt = {
    subscribe(id) { subscribed.add(id); if (sock && sock.connected) sock.emit('channel:subscribe', { channelId: id }, () => {}); },
    typing(id) { const n = Date.now(); if (n - lastTyping > 3000 && sock && sock.connected) { lastTyping = n; sock.emit('typing:start', { channelId: id }, () => {}); } },
    close() { if (sock) sock.close(); },
  };
}

/* ------------------------------------------------------------------ small styles used only by v3 */
const st = document.createElement('style');
st.textContent = '.mem .dot{width:8px;height:8px;border-radius:50%;background:#80848e;margin-left:auto}.mem .dot.on{background:#23a55a}.tx i.del{color:#949ba4}#auth .ok{color:#23a55a;min-height:20px;margin:0 0 8px;font-size:14px}';
document.head.append(st);

window.V3 = { raw, api, refresh, setToken, clear, loadState, messages, perform, connect, solve: solveChallenge };
})();
