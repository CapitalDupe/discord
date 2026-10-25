(() => {
const C = window.CONFIG || { backend: 'local' };
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
let S, ws, editing = null, lastChan = null; const ui = { side: false, mem: true };

const seed = () => ({ user: { id: 'me', name: 'You', color: '#5865f2' }, members: [BOT],
  servers: [{ id: 's1', name: 'Home', channels: [{ id: 'c1', name: 'general', type: 'text' }, { id: 'c2', name: 'random', type: 'text' }, { id: 'c3', name: 'Lounge', type: 'voice' }] }],
  messages: { c1: [{ id: uid(), uid: 'bot', name: 'Echo', color: BOT.color, ts: Date.now(), text: 'Welcome! This is a **frontend-only** clone. Try `!ping`, `/help`, **bold**, *italic*, `code`. Hover a message for reactions, edit and delete. Press ↑ to edit your last message.' }] },
  cur: { s: 's1', c: 'c1' } });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };

// ---- state reducer: the ONLY place state changes. Backend events use the same shapes. ----
const find = e => (S.messages[e.cid] || []).find(m => m.id === e.id);
function reduce(e) {
  switch (e.t) {
    case 'msg.new': { const a = (S.messages[e.cid] ??= []); if (!a.some(m => m.id === e.m.id)) a.push(e.m); break; }
    case 'msg.edit': { const m = find(e); if (m) { m.text = e.text; m.edited = 1; } break; }
    case 'msg.del': S.messages[e.cid] = (S.messages[e.cid] || []).filter(m => m.id !== e.id); break;
    case 'msg.react': { const m = find(e); if (!m) break; const a = ((m.r ??= {})[e.emoji] ??= []); const i = a.indexOf(e.uid); i < 0 ? a.push(e.uid) : a.splice(i, 1); if (!a.length) delete m.r[e.emoji]; break; }
    case 'srv.new': if (!S.servers.some(s => s.id === e.s.id)) S.servers.push(e.s); break;
    case 'srv.del': S.servers = S.servers.filter(s => s.id !== e.sid); break;
    case 'ch.new': S.servers.find(s => s.id === e.sid)?.channels.push(e.c); break;
    case 'ch.del': { const s = S.servers.find(s => s.id === e.sid); if (s) s.channels = s.channels.filter(c => c.id !== e.cid); break; }
    case 'user.set': if (e.u.id === S.user.id) Object.assign(S.user, e.u); break;
  }
  fixNav();
}
function fixNav() {
  S.cur ??= {}; let s = S.servers.find(x => x.id === S.cur.s) || S.servers[0]; S.cur.s = s?.id;
  S.cur.c = (s?.channels.find(c => c.id === S.cur.c) || s?.channels[0])?.id;
}
// Local mode: apply + persist. Remote mode: also send to server (server echoes are de-duplicated by id).
function act(e) { if (C.backend === 'remote' && ws?.readyState === 1) ws.send(JSON.stringify(e)); reduce(e); save(); render(); }

async function init() {
  if (C.backend === 'remote') {
    try {
      const r = await fetch(C.apiUrl + '/state', { headers: C.token ? { Authorization: 'Bearer ' + C.token } : {} });
      S = await r.json(); S.members ??= []; S.messages ??= {}; connect();
    } catch (err) { console.error('Backend unreachable, using local data', err); S = load(); }
  } else S = load();
  S.members ??= [BOT]; fixNav(); render();
}
function connect() {
  ws = new WebSocket(C.wsUrl + (C.token ? '?token=' + encodeURIComponent(C.token) : ''));
  ws.onmessage = ev => { try { reduce(JSON.parse(ev.data)); render(); } catch {} };
  ws.onclose = () => setTimeout(connect, 3000);
}

// ---- rendering ----
const srv = () => S.servers.find(s => s.id === S.cur.s);
const chan = () => srv()?.channels.find(c => c.id === S.cur.c);
function render() {
  document.body.classList.toggle('side', ui.side); document.body.classList.toggle('nomem', !ui.mem);
  $('#rail').innerHTML = S.servers.map(s => `<button class="srv ${s.id === S.cur.s ? 'on' : ''}" data-s="${s.id}" title="${esc(s.name)}">${esc(s.name.slice(0, 2))}</button>`).join('') + '<button class="srv add" id="addsrv" title="Add a server">+</button>';
  const s = srv(); $('#sname').textContent = s?.name || 'No server';
  $('#chlist').innerHTML = (s?.channels || []).map(c => `<div class="ch ${c.id === S.cur.c ? 'on' : ''}" data-c="${c.id}"><span>${c.type === 'voice' ? '🔊' : '#'}</span>${esc(c.name)}</div>`).join('');
  $('#me').innerHTML = `<div class="av" style="background:${esc(S.user.color)}">${esc(S.user.name[0] || '?')}</div><div class="nm">${esc(S.user.name)}<small>Online</small></div><button id="cfg" title="User settings">⚙️</button>`;
  const c = chan(), msgs = $('#msgs'), inp = $('#inp');
  $('#chname').textContent = c ? (c.type === 'voice' ? '🔊 ' : '# ') + c.name : '';
  inp.placeholder = c ? `Message #${c.name}` : 'Create a server to start'; inp.disabled = !c || c.type === 'voice';
  $('#hint').textContent = editing ? 'Editing message · Enter to save · Esc to cancel' : '';
  if (!c) { msgs.innerHTML = '<div class="empty">Nothing here yet. Press + to create a server.</div>'; }
  else if (c.type === 'voice') { msgs.innerHTML = '<div class="empty">🔊 Voice needs a backend (WebRTC). UI placeholder for now.</div>'; }
  else {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120; let prev = null;
    msgs.innerHTML = (S.messages[c.id] || []).map(m => {
      const g = prev && prev.uid === m.uid && m.ts - prev.ts < 3e5; prev = m; const mine = m.uid === S.user.id;
      const rx = Object.entries(m.r || {}).map(([e, a]) => `<button class="rx ${a.includes(S.user.id) ? 'me' : ''}" data-a="x" data-e="${e}">${e} ${a.length}</button>`).join('');
      return `<div class="msg ${g ? 'g' : ''}" data-id="${m.id}">${g ? '' : `<div class="av" style="background:${esc(m.color)}">${esc((m.name || '?')[0])}</div>`}<div class="body">${g ? '' : `<div class="hd"><b style="color:${esc(m.color)}">${esc(m.name)}</b><time>${fmt(m.ts)}</time></div>`}<div class="tx">${md(m.text)}${m.edited ? '<small> (edited)</small>' : ''}</div>${rx ? `<div class="rxs">${rx}</div>` : ''}</div><div class="tools"><button data-a="r">😀</button>${mine ? '<button data-a="e">✏️</button><button data-a="d">🗑️</button>' : ''}</div></div>`;
    }).join('') || `<div class="empty">This is the start of #${esc(c.name)}.</div>`;
    if (near || lastChan !== c.id) msgs.scrollTop = msgs.scrollHeight;
  }
  lastChan = c?.id;
  const mem = [S.user, ...(S.members || [])];
  $('#members').innerHTML = `<h4>Members — ${mem.length}</h4>` + mem.map(u => `<div class="mem"><div class="av" style="background:${esc(u.color)}">${esc(u.name[0] || '?')}</div><span>${esc(u.name)}</span>${u.bot ? '<span class="bot">BOT</span>' : ''}</div>`).join('');
}
const go = (s, c) => { S.cur = { s, c }; editing = null; $('#inp').value = ''; fixNav(); ui.side = false; save(); render(); };

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

// ---- events ----
$('#rail').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'addsrv') return dlg('Create a server', [{ n: 'name', l: 'Server name' }], v => { const id = uid(), c = uid(); act({ t: 'srv.new', s: { id, name: v.name.trim() || 'New server', channels: [{ id: c, name: 'general', type: 'text' }] } }); go(id, c); });
  go(b.dataset.s, null);
};
$('#rail').oncontextmenu = e => { const b = e.target.closest('.srv[data-s]'); if (!b) return; e.preventDefault(); if (confirm('Delete this server?')) act({ t: 'srv.del', sid: b.dataset.s }); };
$('#chlist').onclick = e => { const c = e.target.closest('.ch'); if (c) go(S.cur.s, c.dataset.c); };
$('#chlist').oncontextmenu = e => { const c = e.target.closest('.ch'); if (!c) return; e.preventDefault(); if (confirm('Delete this channel?')) act({ t: 'ch.del', sid: S.cur.s, cid: c.dataset.c }); };
$('#addch').onclick = () => srv() && dlg('Create channel', [{ n: 'name', l: 'Channel name' }, { n: 'type', l: 'Type (text or voice)', v: 'text' }], v => {
  const id = uid(); act({ t: 'ch.new', sid: S.cur.s, c: { id, name: v.name.trim().toLowerCase().replace(/\s+/g, '-') || 'new-channel', type: /^v/i.test(v.type) ? 'voice' : 'text' } }); go(S.cur.s, id); });
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
