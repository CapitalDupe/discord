(() => {
const C = window.CONFIG || { backend: 'local' };
const V3 = C.proto === 'v3' && C.backend === 'remote' ? window.V3 : null;   // adapter for the v3 backend; null in local and legacy v2 mode
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = t => esc(t)
  .replace(/```([\s\S]+?)```/g, '<pre>$1</pre>').replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/~~(.+?)~~/g, '<s>$1</s>')
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const fmt = ts => { const d = new Date(ts), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return new Date().toDateString() === d.toDateString() ? 'Today at ' + t : d.toLocaleDateString() + ' ' + t; };
const KEY = 'discord-clone-v1', EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '👀'];
const BOT = { id: 'bot', name: 'Echo', color: '#3ba55d', bot: true };
let S, ws, rt, editing = null, lastChan = null, resyncing = false, wasUp = true; const ui = { side: false, mem: true };
// v3 bookkeeping: channels whose history was requested / failed to load, and live typing indicators (cid -> uid -> expiry)
const loaded = new Set(), failed = new Set(), typing = Object.create(null);

const seed = () => ({ user: { id: 'me', name: 'You', color: '#5865f2' }, members: [BOT],
  servers: [{ id: 's1', name: 'Home', channels: [{ id: 'c1', name: 'general', type: 'text' }, { id: 'c2', name: 'random', type: 'text' }, { id: 'c3', name: 'Lounge', type: 'voice' }] }],
  messages: { c1: [{ id: uid(), uid: 'bot', name: 'Echo', color: BOT.color, ts: Date.now(), text: 'Welcome! This is a **frontend-only** clone. Try `!ping`, `/help`, **bold**, *italic*, `code`. Hover a message for reactions, edit and delete. Press ↑ to edit your last message.' }] },
  cur: { s: 's1', c: 'c1' } });
// Only local (browser-only) mode is saved to localStorage. Server data holds private messages and is never cached there.
const save = () => { if (C.backend === 'remote') return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };

// A small error banner (role=alert so screen readers announce it).
function toast(err) {
  const msg = typeof err === 'string' ? err : err && err.status === 429 ? 'Slow down a little, then try again.' : (err && err.message) || 'Something went wrong';
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'alert'); t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#f23f42;color:#fff;padding:8px 14px;border-radius:6px;z-index:60;max-width:90vw;font:14px system-ui'; document.body.append(t); }
  t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 5000);
}

// ---- state reducer: the ONLY place state changes. Local, v2 and v3 events all end up here. ----
const find = e => (S.messages[e.cid] || []).find(m => m.id === e.id);
function reduce(e) {
  switch (e.t) {
    case 'msg.new': {   // a message with my local id as its nonce replaces the optimistic copy instead of duplicating it
      const a = (S.messages[e.cid] ??= []); if (a.some(m => m.id === e.m.id)) break;
      const i = e.m.nonce ? a.findIndex(m => m.id === e.m.nonce) : -1; if (i >= 0) a[i] = e.m; else a.push(e.m); break;
    }
    case 'msg.ack': {   // the server confirmed my message: swap the local id for the real one
      const a = (S.messages[e.cid] ??= []), i = a.findIndex(m => m.id === e.localId);
      if (a.some(m => m.id === e.m.id)) { if (i >= 0) a.splice(i, 1); } else if (i >= 0) a[i] = e.m; else a.push(e.m); break;
    }
    case 'msg.edit': { const m = find(e); if (m) { m.text = e.text; m.edited = 1; } break; }
    case 'msg.del': S.messages[e.cid] = (S.messages[e.cid] || []).filter(m => m.id !== e.id); break;
    case 'msg.react': { const m = find(e); if (!m) break; const a = ((m.r ??= {})[e.emoji] ??= []); const i = a.indexOf(e.uid); i < 0 ? a.push(e.uid) : a.splice(i, 1); if (!a.length) delete m.r[e.emoji]; break; }
    case 'rx.add': case 'rx.rm': {   // idempotent reaction events from the server (my own echo changes nothing)
      const m = find(e); if (!m) break; const a = ((m.r ??= {})[e.emoji] ??= []);
      if (e.t === 'rx.add') { if (!a.includes(e.uid)) a.push(e.uid); }
      else { let i = a.indexOf(e.uid); if (i < 0 && e.uid !== S.user.id) i = a.findIndex(x => String(x).startsWith('·')); if (i >= 0) a.splice(i, 1); }
      if (!a.length) delete m.r[e.emoji]; break;
    }
    case 'srv.new': if (!S.servers.some(s => s.id === e.s.id)) S.servers.push(e.s); break;
    case 'srv.upd': { const s = S.servers.find(s => s.id === e.s.id); if (s) s.name = e.s.name; break; }
    case 'srv.del': S.servers = S.servers.filter(s => s.id !== e.sid); break;
    case 'ch.new': { const s = S.servers.find(s => s.id === e.sid); if (s && e.c && !s.channels.some(c => c.id === e.c.id)) s.channels.push(e.c); break; }
    case 'ch.upd': { const c = S.servers.find(s => s.id === e.sid)?.channels.find(c => c.id === e.c.id); if (c) Object.assign(c, e.c); break; }
    case 'ch.del': { const s = S.servers.find(s => s.id === e.sid); if (s) s.channels = s.channels.filter(c => c.id !== e.cid); break; }
    case 'member.new': if (e.user && e.user.id !== S.user.id && !S.members.some(m => m.id === e.user.id)) S.members.push(e.user); break;
    case 'presence': (S.presence ??= {})[e.uid] = e.status; break;
    case 'user.set': if (e.u.id === S.user.id) Object.assign(S.user, e.u); break;
  }
  fixNav();
}
function fixNav() {
  S.cur ??= {}; let s = S.servers.find(x => x.id === S.cur.s) || S.servers[0]; S.cur.s = s?.id;
  S.cur.c = (s?.channels.find(c => c.id === S.cur.c) || s?.channels[0])?.id;
}

// ---- acting on state ----
// Local mode: apply + persist. Legacy v2: also send over the WebSocket. v3: see actV3.
function act(e) {
  if (V3) return actV3(e);
  if (C.backend === 'remote' && ws?.readyState === 1) ws.send(JSON.stringify(e));
  reduce(e); save(); render();
}

// v3: messages, edits, deletes, reactions and profile changes are optimistic (shown at once, rolled back by a resync if the
// server refuses). Creating or deleting servers and channels waits for the server, because it assigns the real ids.
async function actV3(e) {
  const optimistic = ['msg.new', 'msg.edit', 'msg.del', 'msg.react', 'user.set'].includes(e.t);
  if (e.t === 'msg.react') e = { ...e, on: !!find(e)?.r?.[e.emoji]?.includes(S.user.id) };   // was it already mine? decides PUT vs DELETE
  if (e.t === 'srv.del') e = { ...e, leave: S.servers.find(s => s.id === e.sid)?.ownerId !== S.user.id };
  if (optimistic) { reduce(e); render(); }
  try {
    const result = await V3.perform(e);
    if (result) reduce(result); else if (!optimistic) reduce(e);
    render(); return result;
  } catch (err) {
    if (err.status === 401) return signOut();
    toast(err); if (optimistic) resync();
  }
}

// Throw away local guesses and reload the real state (after a refused action, a server `resync`, or a lost room).
async function resync() {
  if (!V3) return location.reload();
  if (resyncing) return; resyncing = true;
  try {
    const keep = S.cur; S = await V3.loadState(); S.presence = Object.fromEntries(S.members.map(m => [m.id, m.status]));
    S.cur = keep; loaded.clear(); failed.clear(); fixNav(); render();
  } catch (err) { if (err.status === 401) return signOut(); toast(err); }
  finally { resyncing = false; }
}
function signOut() { if (V3) V3.clear(); location.reload(); }   // reload shows the login screen

// Events pushed by the server (already translated to reducer events by v3.js).
function onRemote(ev) {
  switch (ev.t) {
    case 'typing': (typing[ev.cid] ??= Object.create(null))[ev.uid] = Date.now() + 5000; setTimeout(render, 5100); return render();
    case 'resync': return resync();
    case 'signed-out': return signOut();
    case 'error': return toast(ev.message);
    case 'net': { const back = ev.up && !ev.first && !wasUp; wasUp = ev.up; if (back) { loaded.clear(); failed.clear(); ensureMessages(); } return; }   // after a reconnect, refetch the open channel and merge
  }
  reduce(ev); render();
}

// v3: history is fetched per channel the first time it is opened, then kept live through the channel's socket room.
const mergeMsgs = (a, b) => {
  const nonces = new Set(b.map(x => x.nonce).filter(Boolean)), m = new Map();
  for (const x of [...a.filter(x => !nonces.has(x.id)), ...b]) m.set(x.id, x);
  return [...m.values()].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
};
async function ensureMessages() {
  const c = chan(); if (!V3 || !c || c.type !== 'text' || loaded.has(c.id)) return;
  loaded.add(c.id);
  try { const items = await V3.messages(c.id); S.messages[c.id] = mergeMsgs(S.messages[c.id] || [], items); rt?.subscribe(c.id); }
  catch (err) { if (err.status === 401) return signOut(); failed.add(c.id); toast(err); }
  render();
}

async function init() {
  if (V3) {
    try { S = await V3.loadState(); S.presence = Object.fromEntries(S.members.map(m => [m.id, m.status])); rt = V3.connect({ onEvent: onRemote }); }
    catch (err) {
      console.error('Could not load your servers', err); if (err.status === 401) return signOut(); toast(err);
      S = { user: { id: 'me', name: 'You', color: '#949ba4' }, members: [], servers: [], messages: {}, presence: {} };
    }
  } else if (C.backend === 'remote') {
    try {
      const r = await fetch(C.apiUrl + '/state', { headers: C.token ? { Authorization: 'Bearer ' + C.token } : {} });
      S = await r.json(); S.members ??= []; S.messages ??= {}; connect();
    } catch (err) { console.error('Backend unreachable, using local data', err); S = load(); }
  } else S = load();
  S.members ??= [BOT]; fixNav(); render();
}
function connect() {   // legacy v2 WebSocket
  ws = new WebSocket(C.wsUrl + (C.token ? '?token=' + encodeURIComponent(C.token) : ''));
  ws.onmessage = ev => { try { reduce(JSON.parse(ev.data)); render(); } catch {} };
  ws.onclose = () => setTimeout(connect, 3000);
}

// ---- rendering ----
const srv = () => S.servers.find(s => s.id === S.cur.s);
const chan = () => srv()?.channels.find(c => c.id === S.cur.c);
function typingText() {
  const now = Date.now(), t = typing[S.cur?.c] || {};
  const names = Object.keys(t).filter(u => t[u] > now && u !== S.user.id).map(u => (S.members.find(m => m.id === u) || {}).name || 'Someone');
  return !names.length ? '' : names.length === 1 ? names[0] + ' is typing…' : names.length === 2 ? names.join(' and ') + ' are typing…' : 'Several people are typing…';
}
function render() {
  document.body.classList.toggle('side', ui.side); document.body.classList.toggle('nomem', !ui.mem);
  $('#rail').innerHTML = S.servers.map(s => `<button class="srv ${s.id === S.cur.s ? 'on' : ''}" data-s="${esc(s.id)}" title="${esc(s.name)}">${esc(s.name.slice(0, 2))}</button>`).join('') + '<button class="srv add" id="addsrv" title="Add a server">+</button>';
  const s = srv(); $('#sname').textContent = s?.name || 'No server';
  $('#chlist').innerHTML = (s?.channels || []).map(c => `<div class="ch ${c.id === S.cur.c ? 'on' : ''}" data-c="${esc(c.id)}"><span>${c.type === 'voice' ? '🔊' : '#'}</span>${esc(c.name)}</div>`).join('');
  $('#me').innerHTML = `<div class="av" style="background:${esc(S.user.color)}">${esc(S.user.name[0] || '?')}</div><div class="nm">${esc(S.user.name)}<small>Online</small></div><button id="cfg" title="User settings">⚙️</button>`;
  const c = chan(), msgs = $('#msgs'), inp = $('#inp');
  $('#chname').textContent = c ? (c.type === 'voice' ? '🔊 ' : '# ') + c.name : '';
  inp.placeholder = c ? `Message #${c.name}` : 'Create a server to start'; inp.disabled = !c || c.type === 'voice';
  $('#hint').textContent = editing ? 'Editing message · Enter to save · Esc to cancel' : typingText();
  // v3 history state for the open text channel: not fetched yet / fetch failed / ready
  const hist = V3 && c && c.type === 'text' ? (failed.has(c.id) ? 'failed' : S.messages[c.id] ? 'ok' : 'loading') : 'ok';
  if (!c) { msgs.innerHTML = '<div class="empty">Nothing here yet. Press + to create a server.</div>'; }
  else if (c.type === 'voice') { msgs.innerHTML = '<div class="empty">🔊 Voice and video are not available in this version yet.</div>'; }
  else if (hist === 'loading') { msgs.innerHTML = '<div class="empty">Loading messages…</div>'; }
  else if (hist === 'failed') { msgs.innerHTML = '<div class="empty">Could not load messages. Select the channel again to retry.</div>'; }
  else {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120; let prev = null;
    msgs.innerHTML = (S.messages[c.id] || []).map(m => {
      const g = prev && prev.uid === m.uid && m.ts - prev.ts < 3e5; prev = m; const mine = m.uid === S.user.id;
      const rx = Object.entries(m.r || {}).map(([e, a]) => `<button class="rx ${a.includes(S.user.id) ? 'me' : ''}" data-a="x" data-e="${esc(e)}">${esc(e)} ${a.length}</button>`).join('');
      const body = m.deleted ? '<i class="del">Message deleted</i>' : `${md(m.text)}${m.edited ? '<small> (edited)</small>' : ''}`;
      const tools = m.deleted ? '' : `<div class="tools"><button data-a="r">😀</button>${mine ? '<button data-a="e">✏️</button><button data-a="d">🗑️</button>' : ''}</div>`;
      return `<div class="msg ${g ? 'g' : ''}" data-id="${esc(m.id)}">${g ? '' : `<div class="av" style="background:${esc(m.color)}">${esc((m.name || '?')[0])}</div>`}<div class="body">${g ? '' : `<div class="hd"><b style="color:${esc(m.color)}">${esc(m.name)}</b><time>${fmt(m.ts)}</time></div>`}<div class="tx">${body}</div>${rx ? `<div class="rxs">${rx}</div>` : ''}</div>${tools}</div>`;
    }).join('') || `<div class="empty">This is the start of #${esc(c.name)}.</div>`;
    if (near || lastChan !== c.id) msgs.scrollTop = msgs.scrollHeight;
  }
  lastChan = c?.id;
  const mem = [S.user, ...(S.members || [])];
  $('#members').innerHTML = `<h4>Members — ${mem.length}</h4>` + mem.map(u => {
    const st = u.id === S.user.id ? 'ONLINE' : S.presence?.[u.id];
    return `<div class="mem"><div class="av" style="background:${esc(u.color)}">${esc(u.name[0] || '?')}</div><span>${esc(u.name)}</span>${u.bot ? '<span class="bot">BOT</span>' : ''}${V3 ? `<i class="dot ${st && st !== 'OFFLINE' ? 'on' : ''}" title="${st && st !== 'OFFLINE' ? 'Online' : 'Offline'}"></i>` : ''}</div>`;
  }).join('');
  ensureMessages();
}
const go = (s, c) => {
  S.cur = { s, c }; editing = null; $('#inp').value = ''; fixNav(); ui.side = false;
  if (failed.has(S.cur.c)) { failed.delete(S.cur.c); loaded.delete(S.cur.c); }   // selecting a channel again retries a failed load
  save(); render();
};

function dlg(title, fields, ok) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${fields.map(f => `<label>${esc(f.l)}<input name="${f.n}" value="${esc(f.v || '')}" type="${f.type || 'text'}"></label>`).join('')}<menu><button value="ok" class="pri">OK</button><button value="x" formnovalidate>Cancel</button></menu></form>`;
  d.onclose = () => { if (d.returnValue === 'ok') ok(Object.fromEntries(new FormData(d.querySelector('form')))); };
  d.showModal(); d.querySelector('input')?.focus();
}

function send(text) {
  const c = chan(); if (!c) return; const cid = c.id;
  act({ t: 'msg.new', cid, m: { id: uid(), uid: S.user.id, name: S.user.name, color: S.user.color, ts: Date.now(), text } });
  if (C.backend !== 'remote') {   // tiny local bot so the UI feels alive
    const say = text2 => setTimeout(() => act({ t: 'msg.new', cid, m: { id: uid(), uid: 'bot', name: 'Echo', color: BOT.color, ts: Date.now(), text: text2 } }), 400);
    if (/^!ping\b/.test(text)) say('pong 🏓');
    else if (/^\/help\b/.test(text)) say('Commands: `!ping`. Markdown: **bold**, *italic*, ~~strike~~, `code`, ```blocks```. Right-click a server/channel to delete it.');
  }
}

// Creating a server or channel: v3 waits for the server's real ids, local/v2 use local ids.
async function createServer(name) {
  if (V3) { const r = await actV3({ t: 'srv.new', s: { name } }); if (r && r.s) go(r.s.id, r.s.channels[0]?.id ?? null); return; }
  const id = uid(), c = uid(); act({ t: 'srv.new', s: { id, name, channels: [{ id: c, name: 'general', type: 'text' }] } }); go(id, c);
}
async function createChannel(sid, name, type) {
  if (V3) { const r = await actV3({ t: 'ch.new', sid, c: { name, type } }); if (r && r.c) go(sid, r.c.id); return; }
  const id = uid(); act({ t: 'ch.new', sid, c: { id, name, type } }); go(sid, id);
}
// Owners delete a server; everyone else leaves it (v3 only; local and v2 keep "delete").
const ownsServer = id => !V3 || S.servers.find(s => s.id === id)?.ownerId === S.user.id;

// ---- events ----
$('#rail').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'addsrv') return dlg('Create a server', [{ n: 'name', l: 'Server name' }], v => createServer(v.name.trim() || 'New server'));
  go(b.dataset.s, null);
};
$('#rail').oncontextmenu = e => { const b = e.target.closest('.srv[data-s]'); if (!b) return; e.preventDefault(); if (confirm(ownsServer(b.dataset.s) ? 'Delete this server?' : 'Leave this server?')) act({ t: 'srv.del', sid: b.dataset.s }); };
$('#chlist').onclick = e => { const c = e.target.closest('.ch'); if (c) go(S.cur.s, c.dataset.c); };
$('#chlist').oncontextmenu = e => { const c = e.target.closest('.ch'); if (!c) return; e.preventDefault(); if (confirm('Delete this channel?')) act({ t: 'ch.del', sid: S.cur.s, cid: c.dataset.c }); };
$('#addch').onclick = () => srv() && dlg('Create channel', [{ n: 'name', l: 'Channel name' }, { n: 'type', l: 'Type (text or voice)', v: 'text' }], v =>
  createChannel(S.cur.s, v.name.trim().toLowerCase().replace(/\s+/g, '-') || 'new-channel', /^v/i.test(v.type) ? 'voice' : 'text'));
$('#me').onclick = e => { if (e.target.closest('#cfg')) dlg('User settings', [{ n: 'name', l: 'Display name', v: S.user.name }, { n: 'color', l: 'Name color', v: S.user.color, type: 'color' }], v => act({ t: 'user.set', u: { id: S.user.id, name: v.name.trim() || S.user.name, color: v.color } })); };
$('#burger').onclick = e => { e.stopPropagation(); ui.side = !ui.side; render(); };
$('#tgm').onclick = () => { ui.mem = !ui.mem; render(); };
$('main').addEventListener('click', e => { if (ui.side && !e.target.closest('#burger')) { ui.side = false; render(); } });

function pickEmoji(btn, cb) {
  document.getElementById('emo')?.remove(); const r = btn.getBoundingClientRect(), p = document.createElement('div'); p.id = 'emo';
  p.style.top = Math.max(8, r.top - 44) + 'px'; p.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - 220)) + 'px';
  p.innerHTML = EMOJI.map(x => `<button>${x}</button>`).join(''); p.onclick = e => { if (e.target.tagName === 'BUTTON') cb(e.target.textContent); p.remove(); };
  document.body.append(p); setTimeout(() => addEventListener('click', () => p.remove(), { once: true }), 0);
}
const startEdit = id => { const m = (S.messages[S.cur.c] || []).find(x => x.id === id); if (!m) return; editing = id; $('#inp').value = m.text; $('#inp').focus(); render(); };
$('#msgs').onclick = e => {
  const b = e.target.closest('button[data-a]'), row = e.target.closest('.msg'); if (!b || !row) return; const id = row.dataset.id, cid = S.cur.c;
  const react = em => act({ t: 'msg.react', cid, id, emoji: em, uid: S.user.id });
  if (b.dataset.a === 'r') pickEmoji(b, react); else if (b.dataset.a === 'x') react(b.dataset.e);
  else if (b.dataset.a === 'e') startEdit(id); else if (b.dataset.a === 'd' && confirm('Delete this message?')) act({ t: 'msg.del', cid, id });
};
$('#inp').oninput = () => { if (rt && S.cur?.c) rt.typing(S.cur.c); };   // throttled to one typing signal per 3 s in v3.js
$('#inp').onkeydown = e => {
  const inp = e.target;
  if (e.key === 'Enter' && inp.value.trim()) {
    if (editing) { act({ t: 'msg.edit', cid: S.cur.c, id: editing, text: inp.value.trim() }); editing = null; } else send(inp.value.trim());
    inp.value = ''; render();
  } else if (e.key === 'Escape' && editing) { editing = null; inp.value = ''; render(); }
  else if (e.key === 'ArrowUp' && !inp.value) { const mine = (S.messages[S.cur.c] || []).filter(m => m.uid === S.user.id).pop(); if (mine) { e.preventDefault(); startEdit(mine.id); } }
};
init();
})();
