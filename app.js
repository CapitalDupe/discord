(() => {
const C = window.CONFIG || { backend: 'local' };
const V3 = C.proto === 'v3' && C.backend === 'remote' ? window.V3 : null;   // adapter for the v3 backend; null in local and legacy v2 mode
const X = C.backend === 'remote' && !V3;   // legacy v2 backend extras: DMs, friends, replies, @mentions, typing, presence, avatars, uploads
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = t => esc(t)
  .replace(/```([\s\S]+?)```/g, '<pre>$1</pre>').replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/~~(.+?)~~/g, '<s>$1</s>')
  .replace(/(^|[\s(>])@([A-Za-z0-9_.-]{3,32})/g, (m, p, n) => X && knownNames().has(n.toLowerCase()) ? p + '<span class="mention">@' + n + '</span>' : m)
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

// ---- legacy v2 extras (X): direct messages, friends, replies, @mentions, typing, presence, avatars, uploads ----
let replyTo = null, known = null, acList = [], acSel = 0, lastTyping = 0, wsWas = false;
const pend = [], unread = Object.create(null), mention = Object.create(null);
Object.assign(ui, { tab: 'online', fmsg: '' });
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/, MAX_UP = 8 * 1024 * 1024;
const furl = id => C.apiUrl + '/files/' + id;
const av = (u, cls = '', attrs = '') => `<div class="av ${cls}" ${attrs} style="background:${esc(u.color || '#949ba4')}">${X && u.avatar && SAFE_ID.test(u.avatar) ? `<img src="${esc(furl(u.avatar))}" alt="" loading="lazy">` : esc(((u && u.name) || '?')[0])}</div>`;
const online = st => !!st && !/^offline$/i.test(st);
const people = () => [S.user, ...(S.members || []), ...(S.dms || []).map(d => d.user), ...Object.values(S.friends || {}).flat()].filter(Boolean);
const userById = id => people().find(u => u.id === id);
const knownNames = () => known ??= new Set(people().filter(u => u.username).map(u => u.username.toLowerCase()));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentionsMe = m => !!(X && S.user.username && m.text && new RegExp('(^|[\\s(])@' + reEsc(S.user.username) + '(?![A-Za-z0-9_.-])', 'i').test(m.text));
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const lastTs = d => (S.messages[d.id] || []).slice(-1)[0]?.ts || 0;
const dotHtml = id => X ? `<i class="dot ${id === S.user.id || online(S.presence?.[id]) ? 'on' : ''}"></i>` : '';
const counts = cid => ({ n: unread[cid] || 0, m: mention[cid] || 0 });
const bdg = c => c.n || c.m ? `<i class="bdg ${c.m ? 'm' : ''}">${c.m || c.n}</i>` : '';
const sumCounts = ids => ids.reduce((a, id) => ({ n: a.n + (unread[id] || 0), m: a.m + (mention[id] || 0) }), { n: 0, m: 0 });
const homeCounts = () => { const t = sumCounts((S.dms || []).map(d => d.id)); t.m += (S.friends?.incoming || []).length; return t; };
const normState = s => { s.members ??= []; s.messages ??= {}; s.dms ??= []; s.sm ??= {}; s.presence ??= {}; s.friends ??= { accepted: [], incoming: [], outgoing: [] }; return s; };

async function api(method, path, body) {
  const r = await fetch(C.apiUrl + path, { method, headers: { Authorization: 'Bearer ' + C.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
}
async function loadFriends() {
  try { const d = await api('GET', '/friends'); S.friends = { accepted: d.accepted, incoming: d.incoming, outgoing: d.outgoing }; Object.assign(S.presence ??= {}, d.presence); render(); }
  catch (err) { if (err.status === 401) return signOut(); }
}
async function resyncX() {   // reload the real state after a refused action or a reconnect, keeping where you are
  try { const keep = S.cur; S = normState(await api('GET', '/state')); S.cur = keep; fixNav(); render(); }
  catch (err) { if (err.status === 401) return signOut(); toast(err); }
}
function noteNew(e) {   // unread and mention counters, desktop notification when the tab is hidden
  const m = e.m; if (!m) return;
  if (typing[e.cid]) delete typing[e.cid][m.uid];
  if (m.uid === S.user.id || (e.cid === S.cur.c && !document.hidden)) return;
  const dm = (S.dms || []).some(d => d.id === e.cid), ping = dm || mentionsMe(m);
  unread[e.cid] = (unread[e.cid] || 0) + 1; if (ping) mention[e.cid] = (mention[e.cid] || 0) + 1;
  if (ping && document.hidden && 'Notification' in window && Notification.permission === 'granted') { try { new Notification(dm ? m.name : m.name + ' mentioned you', { body: (m.text || 'Attachment').slice(0, 120) }); } catch {} }
}

async function openDM(userId) {
  try { const d = await api('POST', '/dms', { userId }); if (!S.dms.some(x => x.id === d.id)) S.dms.push({ id: d.id, user: d.user }); S.messages[d.id] ??= []; go('home', d.id); }
  catch (err) { toast(err); }
}
async function friendAction(b) {
  const a = b.dataset.f, id = b.dataset.id;
  try {
    if (a === 'tab') { ui.tab = b.dataset.t; ui.fmsg = ''; return render(); }
    if (a === 'dm') return openDM(id);
    if (a === 'send') {
      const v = ($('#fuser')?.value || '').trim(); if (!v) return;
      try { await api('POST', '/friends', { username: v }); ui.fmsg = 'Friend request sent to ' + v + '.'; } catch (err) { ui.fmsg = err.message; }
      await loadFriends(); return render();
    }
    if (a === 'accept') await api('POST', '/friends/' + encodeURIComponent(id) + '/accept');
    if (a === 'remove') { if ((S.friends.accepted || []).some(u => u.id === id) && !confirm('Remove this friend?')) return; await api('DELETE', '/friends/' + encodeURIComponent(id)); }
    await loadFriends();
  } catch (err) { toast(err); }
}
function friendsHtml() {
  const F = S.friends || {}, acc = F.accepted || [], inc = F.incoming || [], out = F.outgoing || [], tab = ui.tab;
  const names = { online: 'Online', all: 'All', pending: 'Pending' + (inc.length ? ' (' + inc.length + ')' : ''), add: 'Add friend' };
  const tabs = Object.keys(names).map(t => `<button class="tab ${tab === t ? 'on' : ''}" data-f="tab" data-t="${t}">${esc(names[t])}</button>`).join('');
  const row = (u, btns, sub) => `<div class="frow" data-u="${esc(u.id)}">${av(u)}<div class="fn"><b>${esc(u.name)}</b><small>@${esc(u.username || '')}${sub ? ' · ' + esc(sub) : ''}</small></div>${dotHtml(u.id)}<span class="fa">${btns}</span></div>`;
  const btn = (act, id, title, label) => `<button data-f="${act}" data-id="${esc(id)}" title="${title}" aria-label="${title}">${label}</button>`;
  let body;
  if (tab === 'add') body = `<div class="addf"><p>Add a friend by their username.</p><div class="inrow2"><input id="fuser" placeholder="username" autocomplete="off" autocapitalize="off" maxlength="33"><button class="pri" data-f="send">Send request</button></div><p class="fmsg">${esc(ui.fmsg)}</p></div>`;
  else if (tab === 'pending') body = inc.map(u => row(u, btn('accept', u.id, 'Accept', '✓') + btn('remove', u.id, 'Decline', '✕'), 'wants to be friends')).join('') + out.map(u => row(u, btn('remove', u.id, 'Cancel request', '✕'), 'request sent')).join('') || '<div class="empty">No pending requests.</div>';
  else { const list = tab === 'online' ? acc.filter(u => online(S.presence?.[u.id])) : acc; body = list.map(u => row(u, btn('dm', u.id, 'Message', '💬') + btn('remove', u.id, 'Remove friend', '✕'), online(S.presence?.[u.id]) ? 'Online' : 'Offline')).join('') || `<div class="empty">${tab === 'online' ? 'No friends online right now.' : 'No friends yet. Open “Add friend” to send a request.'}</div>`; }
  return `<div class="fp"><div class="tabs">${tabs}</div>${body}</div>`;
}
function homeList() {
  const dms = [...(S.dms || [])].sort((a, b) => lastTs(b) - lastTs(a)), reqs = (S.friends?.incoming || []).length;
  return `<div class="ch ${S.cur.c === 'friends' ? 'on' : ''}" data-c="friends"><span>👥</span>Friends${reqs ? bdg({ n: reqs, m: reqs }) : ''}</div><h5 class="sec">Direct messages</h5>`
    + (dms.map(d => `<div class="ch dmi ${S.cur.c === d.id ? 'on' : ''}" data-c="${esc(d.id)}">${av(d.user, 'sm')}<span class="dn">${esc(d.user.name)}</span>${dotHtml(d.user.id)}${bdg(counts(d.id))}</div>`).join('') || '<div class="empty small">No conversations yet. Message a friend, or someone from a server you share.</div>');
}
function membersHtml() {
  const list = (S.sm?.[S.cur.s] || []).map(userById).filter(Boolean), all = [S.user, ...list];
  const on = all.filter(u => u.id === S.user.id || online(S.presence?.[u.id])), off = all.filter(u => !on.includes(u));
  const row = u => `<div class="mem" data-u="${esc(u.id)}">${av(u)}<span>${esc(u.name)}</span>${u.official ? '<span class="bot">OFFICIAL</span>' : ''}${dotHtml(u.id)}</div>`;
  return `<h4>Online — ${on.length}</h4>${on.map(row).join('')}${off.length ? `<h4>Offline — ${off.length}</h4>${off.map(row).join('')}` : ''}`;
}
function openProfile(id) {
  const u = userById(id); if (!u) return;
  const me = u.id === S.user.id, F = S.friends || {}, isF = (F.accepted || []).some(x => x.id === id), sent = (F.outgoing || []).some(x => x.id === id), got = (F.incoming || []).some(x => x.id === id);
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><div class="prof">${av(u, 'big')}<div><h3>${esc(u.name)}</h3><div class="muted">@${esc(u.username || '')}</div><div class="muted">${me ? 'This is you' : online(S.presence?.[id]) ? '🟢 Online' : '⚪ Offline'}</div></div></div><menu>${me || u.official ? '' : '<button value="dm" class="pri">Message</button>'}${me || u.official || isF || sent ? '' : `<button value="fr">${got ? 'Accept friend request' : 'Add friend'}</button>`}<button value="x" formnovalidate>Close</button></menu></form>`;
  d.onclose = () => { if (d.returnValue === 'dm') openDM(id); else if (d.returnValue === 'fr') api('POST', '/friends', { username: u.username }).then(loadFriends).catch(toast); };
  d.showModal();
}

// ---- avatars and file uploads ----
function downscale(file, size = 256) {   // shrink an avatar in the browser before uploading it
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, size / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(b => b ? ok(b) : no(new Error('Could not read that image')), 'image/jpeg', 0.9); };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('That file is not an image')); };
    img.src = url;
  });
}
function putFile(blob, name, onProgress) {   // raw PUT with upload progress
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest(); x.open('PUT', C.apiUrl + '/upload?name=' + encodeURIComponent(name));
    x.setRequestHeader('Authorization', 'Bearer ' + C.token); x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? ok(d) : no(Object.assign(new Error(d.error || 'Upload failed'), { status: x.status })); };
    x.onerror = () => no(new Error('Upload failed: network error'));
    x.send(blob);
  });
}
function addFiles(files) {
  for (const f of files) {
    if (pend.length >= 5) return toast('You can attach up to 5 files');
    if (f.size > MAX_UP) { toast(f.name + ' is larger than 8 MB'); continue; }
    const p = { name: f.name, st: 'up', pct: 0 }; pend.push(p); paintPend();
    putFile(f, f.name, r => { p.pct = r; paintPend(); }).then(d => { Object.assign(p, d, { st: 'ok' }); paintPend(); }, err => { pend.splice(pend.indexOf(p), 1); toast(err); paintPend(); });
  }
}
function paintPend() {
  const el = $('#pend'); if (!el) return; el.hidden = !pend.length;
  el.innerHTML = pend.map((p, i) => `<span class="chip">${/^image\//.test(p.mime || '') ? '🖼️' : '📎'} ${esc(p.name)} ${p.st === 'up' ? Math.round(p.pct * 100) + '%' : ''}<button type="button" data-x="${i}" title="Remove" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join('');
}
function paintReply() {
  const el = $('#replybar'); if (!el) return; el.hidden = !replyTo;
  el.innerHTML = replyTo ? `Replying to <b>${esc(replyTo.name)}</b> <span>${esc(replyTo.text)}</span><button type="button" data-x="reply" title="Cancel reply" aria-label="Cancel reply">✕</button>` : '';
}
function startReply(id) {
  const m = (S.messages[S.cur.c] || []).find(x => x.id === id); if (!m) return;
  replyTo = { id: m.id, name: m.name, text: (m.text || 'Attachment').slice(0, 120) }; paintReply(); $('#inp').focus();
}
function jumpTo(id) {
  const t = $('#msgs').querySelector('.msg[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1500); }
}
function openSettings() {
  const d = $('#dlg'); let avatar = S.user.avatar || null, busy = false;
  d.innerHTML = `<form method="dialog"><h3>User settings</h3><div class="avrow"><span class="avp"></span><div><button type="button" id="avpick">Change avatar</button> <button type="button" id="avrm">Remove</button><small id="avmsg"></small></div></div><input type="file" id="avfile" accept="image/png,image/jpeg,image/webp,image/gif" hidden><label>Display name<input name="name" value="${esc(S.user.name)}" maxlength="32"></label><label>Name color<input name="color" type="color" value="${esc(S.user.color)}"></label>${'Notification' in window && Notification.permission === 'default' ? '<button type="button" id="ntf">Enable desktop notifications</button>' : ''}<menu><button value="ok" class="pri">Save</button><button value="x" formnovalidate>Cancel</button></menu></form>`;
  const paint = () => { d.querySelector('.avp').innerHTML = av({ ...S.user, avatar, name: d.querySelector('[name=name]').value || S.user.name, color: d.querySelector('[name=color]').value }, 'big'); };
  const msg = t => { d.querySelector('#avmsg').textContent = t; };
  paint(); d.querySelector('[name=name]').oninput = d.querySelector('[name=color]').oninput = paint;
  d.querySelector('#avpick').onclick = () => d.querySelector('#avfile').click();
  d.querySelector('#avrm').onclick = () => { avatar = null; paint(); };
  d.querySelector('#avfile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    busy = true; msg(' Uploading…');
    try { avatar = (await putFile(await downscale(f), 'avatar.jpg')).id; paint(); msg(''); } catch (err) { msg(' ' + err.message); }
    busy = false;
  };
  const n = d.querySelector('#ntf'); if (n) n.onclick = () => Notification.requestPermission().then(() => { n.remove(); });
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    if (busy) return toast('Wait for the avatar to finish uploading, then save again');
    const f = d.querySelector('form');
    act({ t: 'user.set', u: { id: S.user.id, name: f.name.value.trim() || S.user.name, color: f.color.value, avatar } });
  };
  d.showModal();
}

// ---- composer: reply bar, attachments, @mention autocomplete, typing, idle status ----
const chanPeople = () => { const c = chan(); return !c ? [] : c.type === 'dm' ? [S.user, c.user] : [S.user, ...(S.sm?.[S.cur.s] || []).map(userById).filter(Boolean)]; };
function updateAc() {
  const inp = $('#inp'), box = $('#acp'); if (!box) return;
  const m = /(^|\s)@([A-Za-z0-9_.-]{0,32})$/.exec(inp.value.slice(0, inp.selectionStart ?? inp.value.length));
  if (!m) { box.hidden = true; acList = []; return; }
  const q = m[2].toLowerCase();
  acList = chanPeople().filter(u => u.username && (u.username.toLowerCase().startsWith(q) || (u.name || '').toLowerCase().startsWith(q))).slice(0, 6);
  acSel = Math.min(acSel, Math.max(0, acList.length - 1)); box.hidden = !acList.length;
  box.innerHTML = acList.map((u, i) => `<div class="acr ${i === acSel ? 'on' : ''}" data-i="${i}">${av(u, 'sm')}<b>${esc(u.name)}</b> <small>@${esc(u.username)}</small></div>`).join('');
}
function pickAc(i) {
  const inp = $('#inp'), u = acList[i]; if (!u) return;
  const pos = inp.selectionStart ?? inp.value.length, pre = inp.value.slice(0, pos).replace(/@[A-Za-z0-9_.-]*$/, '@' + u.username + ' ');
  inp.value = pre + inp.value.slice(pos); inp.setSelectionRange(pre.length, pre.length); $('#acp').hidden = true; acList = []; inp.focus();
}
function sendTyping() {
  const c = chan(), inp = $('#inp'); if (!c || !inp.value.trim() || inp.value.startsWith('/') || Date.now() - lastTyping < 3000 || ws?.readyState !== 1) return;
  lastTyping = Date.now(); ws.send(JSON.stringify({ t: 'typing', cid: c.id }));
}
function trackIdle() {   // tell the server when you have been away for 5 minutes
  let timer, away = false;
  const set = v => { if (v !== away) { away = v; if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'presence', s: v ? 'idle' : 'online' })); } };
  const bump = () => { set(false); clearTimeout(timer); timer = setTimeout(() => set(true), 5 * 60e3); };
  ['pointerdown', 'keydown', 'touchstart', 'visibilitychange'].forEach(n => addEventListener(n, bump, { passive: true })); bump();
}
function setupComposer() {
  const comp = $('#composer'), inp = $('#inp'), main = $('main');
  comp.insertAdjacentHTML('afterbegin', '<div id="replybar" hidden></div><div id="pend" hidden></div><div id="acp" hidden></div>');
  const row = document.createElement('div'); row.className = 'inrow';
  row.innerHTML = '<button id="attach" type="button" title="Attach a file" aria-label="Attach a file">📎</button><input id="file" type="file" multiple hidden>';
  inp.before(row); row.insertBefore(inp, row.querySelector('#file'));
  $('#attach').onclick = () => $('#file').click();
  $('#file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  inp.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  main.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); main.classList.add('drop'); } });
  main.addEventListener('dragleave', e => { if (e.target === main) main.classList.remove('drop'); });
  main.addEventListener('drop', e => { e.preventDefault(); main.classList.remove('drop'); if (chan() && !inp.disabled) addFiles([...e.dataTransfer.files]); });
  comp.addEventListener('click', e => {
    const x = e.target.closest('[data-x]'); if (x) { if (x.dataset.x === 'reply') { replyTo = null; paintReply(); } else { pend.splice(+x.dataset.x, 1); paintPend(); } }
    const r = e.target.closest('.acr'); if (r) pickAc(+r.dataset.i);
  });
}

// ---- state reducer: the ONLY place state changes. Local, v2 and v3 events all end up here. ----
const find = e => (S.messages[e.cid] || []).find(m => m.id === e.id);
function reduce(e) {
  switch (e.t) {
    case 'msg.new': {   // a message with my local id as its nonce replaces the optimistic copy instead of duplicating it
      const a = (S.messages[e.cid] ??= []); if (a.some(m => m.id === e.m.id)) break;
      const i = e.m.nonce ? a.findIndex(m => m.id === e.m.nonce) : -1; if (i >= 0) a[i] = e.m; else { a.push(e.m); if (X) noteNew(e); } break;
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
    case 'member.new': if (e.user && e.user.id !== S.user.id) { if (!S.members.some(m => m.id === e.user.id)) S.members.push(e.user); if (e.sid) { const l = ((S.sm ??= {})[e.sid] ??= []); if (!l.includes(e.user.id)) l.push(e.user.id); } } break;
    case 'presence': (S.presence ??= {})[e.uid] = e.s ?? e.status; break;
    case 'typing': if (X) { (typing[e.cid] ??= Object.create(null))[e.uid] = Date.now() + 5000; setTimeout(render, 5100); } break;
    case 'dm.new': if (X && e.dm && !(S.dms ??= []).some(d => d.id === e.dm.id)) { S.dms.push(e.dm); S.messages[e.dm.id] ??= []; } break;
    case 'friends.update': if (X) loadFriends(); break;
    case 'user.set': {
      const u = e.u; if (u.id === S.user.id) Object.assign(S.user, u);
      if (X) {   // keep my name, colour and avatar current everywhere other people see them
        for (const p of people()) if (p.id === u.id && p !== S.user) Object.assign(p, { name: u.name, color: u.color, avatar: u.avatar });
        for (const a of Object.values(S.messages)) for (const m of a) if (m.uid === u.id) { m.name = u.name; m.color = u.color; m.avatar = u.avatar; }
      }
      break;
    }
  }
  fixNav();
}
function fixNav() {
  S.cur ??= {};
  if (X && S.cur.s === 'home') { if (S.cur.c !== 'friends' && !(S.dms || []).some(d => d.id === S.cur.c)) S.cur.c = 'friends'; return; }
  let s = S.servers.find(x => x.id === S.cur.s) || S.servers[0]; S.cur.s = s?.id;
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
      S = await r.json(); S.members ??= []; S.messages ??= {}; if (X) normState(S); connect();
    } catch (err) { console.error('Backend unreachable, using local data', err); S = load(); }
  } else S = load();
  S.members ??= [BOT]; fixNav(); if (X) { setupComposer(); trackIdle(); } render();
}
function connect() {   // legacy v2 WebSocket
  ws = new WebSocket(C.wsUrl + (C.token ? '?token=' + encodeURIComponent(C.token) : ''));
  ws.onopen = () => { if (wsWas && X) resyncX(); wsWas = true; };   // after a reconnect, reload what we missed
  ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if (X && m.t === 'resync') return resyncX(); reduce(m); render(); } catch (err) { console.error(err); } };
  ws.onclose = () => setTimeout(connect, 3000);
}

// ---- rendering ----
const srv = () => S.servers.find(s => s.id === S.cur.s);
const inHome = () => X && S.cur.s === 'home';
const chan = () => {
  if (inHome()) { const d = (S.dms || []).find(x => x.id === S.cur.c); return d ? { id: d.id, name: d.user.name, type: 'dm', user: d.user } : null; }
  return srv()?.channels.find(c => c.id === S.cur.c);
};
function typingText() {
  const now = Date.now(), t = typing[S.cur?.c] || {};
  const names = Object.keys(t).filter(u => t[u] > now && u !== S.user.id).map(u => (userById(u) || {}).name || 'Someone');
  return !names.length ? '' : names.length === 1 ? names[0] + ' is typing…' : names.length === 2 ? names.join(' and ') + ' are typing…' : 'Several people are typing…';
}
function msgHtml(m, g, mine) {
  const rx = Object.entries(m.r || {}).map(([e, a]) => `<button class="rx ${a.includes(S.user.id) ? 'me' : ''}" data-a="x" data-e="${esc(e)}">${esc(e)} ${a.length}</button>`).join('');
  const body = m.deleted ? '<i class="del">Message deleted</i>' : `${md(m.text)}${m.edited ? '<small> (edited)</small>' : ''}`;
  const tools = m.deleted ? '' : `<div class="tools"><button data-a="r">😀</button>${X ? '<button data-a="p" title="Reply">↩️</button>' : ''}${mine ? '<button data-a="e">✏️</button><button data-a="d">🗑️</button>' : ''}</div>`;
  const rp = X && m.reply ? `<div class="rp" data-jump="${esc(m.reply.id)}">↩ <b>${esc(m.reply.name)}</b> ${esc((m.reply.text || 'Attachment').slice(0, 80))}</div>` : '';
  const atts = X ? (m.att || []).filter(a => a && SAFE_ID.test(a.id)).map(a => /^image\//.test(a.mime)
    ? `<a href="${esc(furl(a.id))}" target="_blank" rel="noopener"><img class="att" src="${esc(furl(a.id))}" alt="${esc(a.name)}" loading="lazy"></a>`
    : `<a class="file" href="${esc(furl(a.id))}" target="_blank" rel="noopener">📄 ${esc(a.name)} <small>${fmtSize(+a.size || 0)}</small></a>`).join('') : '';
  const ua = X && m.uid ? `data-u="${esc(m.uid)}"` : '', ment = X && !mine && mentionsMe(m) ? ' ment' : '';
  return `<div class="msg ${g ? 'g' : ''}${ment}" data-id="${esc(m.id)}">${g ? '' : av(m, '', ua)}<div class="body">${g ? '' : `<div class="hd"><b style="color:${esc(m.color)}" ${ua}>${esc(m.name)}</b>${m.official ? ' <span class="bot">OFFICIAL</span>' : ''}<time>${fmt(m.ts)}</time></div>`}${rp}<div class="tx">${body}</div>${atts ? `<div class="atts">${atts}</div>` : ''}${rx ? `<div class="rxs">${rx}</div>` : ''}</div>${tools}</div>`;
}
function render() {
  known = null; const home = inHome();
  document.body.classList.toggle('side', ui.side); document.body.classList.toggle('nomem', !ui.mem);
  document.body.classList.toggle('home', home); document.body.classList.toggle('nocomp', home && S.cur.c === 'friends');
  $('#rail').innerHTML = (X ? `<button class="srv hm ${home ? 'on' : ''}" data-home="1" title="Direct messages" aria-label="Direct messages">💬${bdg(homeCounts())}</button>` : '')
    + S.servers.map(s => `<button class="srv ${s.id === S.cur.s ? 'on' : ''}" data-s="${esc(s.id)}" title="${esc(s.name)}">${esc(s.name.slice(0, 2))}${X ? bdg(sumCounts(s.channels.map(c => c.id))) : ''}</button>`).join('')
    + '<button class="srv add" id="addsrv" title="Add a server">+</button>';
  const s = srv(); $('#sname').textContent = home ? 'Direct Messages' : (s?.name || 'No server');
  $('#addch').style.display = home ? 'none' : '';
  $('#chlist').innerHTML = home ? homeList() : (s?.channels || []).map(c => `<div class="ch ${c.id === S.cur.c ? 'on' : ''}" data-c="${esc(c.id)}"><span>${c.type === 'voice' ? '🔊' : '#'}</span>${esc(c.name)}${X ? bdg(counts(c.id)) : ''}</div>`).join('');
  $('#me').innerHTML = `${av(S.user)}<div class="nm">${esc(S.user.name)}<small>Online</small></div><button id="cfg" title="User settings">⚙️</button>`;
  const c = chan(), msgs = $('#msgs'), inp = $('#inp'), ro = X && s?.id === 'official-hq';   // the Official server is read-only
  $('#chname').textContent = home ? (S.cur.c === 'friends' ? '👥 Friends' : c ? '@ ' + c.name : '') : c ? (c.type === 'voice' ? '🔊 ' : '# ') + c.name : '';
  inp.placeholder = ro ? 'This channel is read-only' : c ? (c.type === 'dm' ? `Message @${c.name}` : `Message #${c.name}`) : home ? '' : 'Create a server to start';
  inp.disabled = !c || c.type === 'voice' || ro;
  const at = $('#attach'); if (at) at.disabled = inp.disabled;
  $('#hint').textContent = editing ? 'Editing message · Enter to save · Esc to cancel' : typingText();
  // v3 history state for the open text channel: not fetched yet / fetch failed / ready
  const hist = V3 && c && c.type === 'text' ? (failed.has(c.id) ? 'failed' : S.messages[c.id] ? 'ok' : 'loading') : 'ok';
  if (home && S.cur.c === 'friends') { if (!(ui.tab === 'add' && document.activeElement?.id === 'fuser')) msgs.innerHTML = friendsHtml(); }   // never wipe the box you are typing in
  else if (!c) { msgs.innerHTML = '<div class="empty">Nothing here yet. Press + to create a server.</div>'; }
  else if (c.type === 'voice') { msgs.innerHTML = '<div class="empty">🔊 Voice and video are not available in this version yet.</div>'; }
  else if (hist === 'loading') { msgs.innerHTML = '<div class="empty">Loading messages…</div>'; }
  else if (hist === 'failed') { msgs.innerHTML = '<div class="empty">Could not load messages. Select the channel again to retry.</div>'; }
  else {
    const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120; let prev = null;
    msgs.innerHTML = (S.messages[c.id] || []).map(m => {
      const g = prev && prev.uid === m.uid && m.ts - prev.ts < 3e5 && !m.reply; prev = m;
      return msgHtml(m, g, m.uid === S.user.id);
    }).join('') || `<div class="empty">${c.type === 'dm' ? 'This is the start of your conversation with ' + esc(c.name) + '.' : 'This is the start of #' + esc(c.name) + '.'}</div>`;
    if (near || lastChan !== c.id) msgs.scrollTop = msgs.scrollHeight;
  }
  lastChan = c?.id;
  if (X) $('#members').innerHTML = membersHtml();
  else {
    const mem = [S.user, ...(S.members || [])];
    $('#members').innerHTML = `<h4>Members — ${mem.length}</h4>` + mem.map(u => {
      const st = u.id === S.user.id ? 'ONLINE' : S.presence?.[u.id];
      return `<div class="mem"><div class="av" style="background:${esc(u.color)}">${esc(u.name[0] || '?')}</div><span>${esc(u.name)}</span>${u.bot ? '<span class="bot">BOT</span>' : ''}${V3 ? `<i class="dot ${st && st !== 'OFFLINE' ? 'on' : ''}" title="${st && st !== 'OFFLINE' ? 'Online' : 'Offline'}"></i>` : ''}</div>`;
    }).join('');
  }
  if (X) { const t = sumCounts([...(S.dms || []).map(d => d.id), ...S.servers.flatMap(sv => sv.channels.map(ch => ch.id))]); document.title = (t.m ? '(' + t.m + ') ' : '') + document.title.replace(/^\(\d+\) /, ''); }
  ensureMessages();
}
const go = (s, c) => {
  S.cur = { s, c }; editing = null; $('#inp').value = ''; fixNav(); ui.side = false;
  if (failed.has(S.cur.c)) { failed.delete(S.cur.c); loaded.delete(S.cur.c); }   // selecting a channel again retries a failed load
  if (X) { delete unread[S.cur.c]; delete mention[S.cur.c]; replyTo = null; paintReply(); }
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
  const m = { id: uid(), uid: S.user.id, name: S.user.name, color: S.user.color, ts: Date.now(), text };
  if (X) {   // v2: username and avatar, a reply, attachments that finished uploading
    m.un = S.user.username; m.avatar = S.user.avatar || null; if (replyTo) m.reply = replyTo;
    const att = pend.filter(p => p.st === 'ok').map(({ id, name, mime, size }) => ({ id, name, mime, size })); if (att.length) m.att = att;
    pend.length = 0; replyTo = null; paintPend(); paintReply();
  }
  act({ t: 'msg.new', cid, m });
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
  if (b.dataset.home) return go('home', 'friends');
  go(b.dataset.s, null);
};
$('#rail').oncontextmenu = e => { const b = e.target.closest('.srv[data-s]'); if (!b) return; e.preventDefault(); if (confirm(ownsServer(b.dataset.s) ? 'Delete this server?' : 'Leave this server?')) act({ t: 'srv.del', sid: b.dataset.s }); };
$('#chlist').onclick = e => { const c = e.target.closest('.ch'); if (c) go(S.cur.s, c.dataset.c); };
$('#chlist').oncontextmenu = e => { const c = e.target.closest('.ch'); if (!c || inHome()) return; e.preventDefault(); if (confirm('Delete this channel?')) act({ t: 'ch.del', sid: S.cur.s, cid: c.dataset.c }); };
$('#addch').onclick = () => srv() && dlg('Create channel', [{ n: 'name', l: 'Channel name' }, { n: 'type', l: 'Type (text or voice)', v: 'text' }], v =>
  createChannel(S.cur.s, v.name.trim().toLowerCase().replace(/\s+/g, '-') || 'new-channel', /^v/i.test(v.type) ? 'voice' : 'text'));
$('#me').onclick = e => { if (e.target.closest('#cfg')) X ? openSettings() : dlg('User settings', [{ n: 'name', l: 'Display name', v: S.user.name }, { n: 'color', l: 'Name color', v: S.user.color, type: 'color' }], v => act({ t: 'user.set', u: { id: S.user.id, name: v.name.trim() || S.user.name, color: v.color } })); };
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
  if (X) {   // friends panel buttons, jump to a replied-to message, open someone's profile
    const f = e.target.closest('[data-f]'); if (f) return friendAction(f);
    const j = e.target.closest('[data-jump]'); if (j) return jumpTo(j.dataset.jump);
    const u = e.target.closest('[data-u]'); if (u && !e.target.closest('button')) return openProfile(u.dataset.u);
  }
  const b = e.target.closest('button[data-a]'), row = e.target.closest('.msg'); if (!b || !row) return; const id = row.dataset.id, cid = S.cur.c;
  const react = em => act({ t: 'msg.react', cid, id, emoji: em, uid: S.user.id });
  if (b.dataset.a === 'r') pickEmoji(b, react); else if (b.dataset.a === 'x') react(b.dataset.e);
  else if (b.dataset.a === 'p') startReply(id);
  else if (b.dataset.a === 'e') startEdit(id); else if (b.dataset.a === 'd' && confirm('Delete this message?')) act({ t: 'msg.del', cid, id });
};
$('#inp').oninput = () => { if (rt && S.cur?.c) rt.typing(S.cur.c); if (X) { sendTyping(); updateAc(); } };
$('#members').onclick = e => { const u = X && e.target.closest('[data-u]'); if (u) openProfile(u.dataset.u); };
$('#msgs').onkeydown = e => { if (X && e.key === 'Enter' && e.target.id === 'fuser') { e.preventDefault(); friendAction({ dataset: { f: 'send' } }); } };   // throttled to one typing signal per 3 s in v3.js
$('#inp').onkeydown = e => {
  const inp = e.target;
  if (X && acList.length && !$('#acp').hidden) {   // @mention autocomplete is open
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel + (e.key === 'ArrowDown' ? 1 : acList.length - 1)) % acList.length; return updateAc(); }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickAc(acSel); }
    if (e.key === 'Escape') { $('#acp').hidden = true; acList = []; return; }
  }
  const canSend = inp.value.trim() || (X && pend.some(p => p.st === 'ok'));
  if (e.key === 'Enter' && canSend) {
    if (X && pend.some(p => p.st === 'up')) return toast('Wait for the upload to finish');
    if (editing && !inp.value.trim()) return;
    if (editing) { act({ t: 'msg.edit', cid: S.cur.c, id: editing, text: inp.value.trim() }); editing = null; } else send(inp.value.trim());
    inp.value = ''; render();
  } else if (e.key === 'Escape' && (editing || replyTo)) { if (editing) { editing = null; inp.value = ''; } else { replyTo = null; paintReply(); } render(); }
  else if (e.key === 'ArrowUp' && !inp.value) { const mine = (S.messages[S.cur.c] || []).filter(m => m.uid === S.user.id).pop(); if (mine) { e.preventDefault(); startEdit(mine.id); } }
};
init();
})();
