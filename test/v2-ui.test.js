
'use strict';
// Drives app.js (legacy v2 mode) with a fake DOM, fake REST API and fake WebSocket: DMs, friends, replies,
// mentions, unread badges, typing, presence, read-only Official server, avatars and attachments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
class El {
  constructor(id) { this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.style = {}; this.dataset = {}; this._c = new Set(); this.children = []; this.hidden = false; this.disabled = false; this.scrollHeight = 0; this.scrollTop = 0; this.clientHeight = 0; this.handlers = {};
    this.classList = { add: c => this._c.add(c), remove: c => this._c.delete(c), toggle: (c, on) => (on === undefined ? !this._c.has(c) : on) ? this._c.add(c) : this._c.delete(c), contains: c => this._c.has(c) }; }
  addEventListener(n, f) { (this.handlers[n] ||= []).push(f); }
  querySelector(s) { return (this._q ||= {})[s] ||= new El(s); }
  insertAdjacentHTML() {} before() {} insertBefore() {} append() {} remove() {} focus() {} click() {} showModal() { this.opened = true; } close() {} scrollIntoView() {} setSelectionRange() {}
  closest() { return null; }
}
const els = {};
const document = { querySelector: s => els[s] ||= new El(s), getElementById: () => null, createElement: () => new El('new'), body: new El('body'), activeElement: null, hidden: false, title: 'Discord Clone', addEventListener() {} };
const sent = [], timers = [];
class WS { constructor(u) { this.url = u; this.readyState = 1; WS.last = this; } send(m) { sent.push(JSON.parse(m)); } }
const state = {
  user: { id: 'u1', username: 'alice', name: 'Alice', color: '#5865f2', avatar: null },
  members: [{ id: 'u2', username: 'bob', name: 'Bob', color: '#3ba55d', avatar: 'f'.repeat(32) }, { id: 'official', username: 'official', name: 'Official', color: '#5865f2', avatar: null, official: true }],
  sm: { s1: ['u2'], 'official-hq': ['official'] },
  servers: [{ id: 's1', name: 'Home', channels: [{ id: 'c1', name: 'general', type: 'text' }, { id: 'c2', name: 'random', type: 'text' }] }, { id: 'official-hq', name: 'Official', channels: [{ id: 'official-news', name: 'announcements', type: 'text' }] }],
  messages: { c1: [{ id: 'm1', uid: 'u2', un: 'bob', name: 'Bob', color: '#3ba55d', avatar: 'f'.repeat(32), ts: Date.now() - 5000, text: 'hello @alice and <b>x</b>' }, { id: 'm2', uid: 'u1', un: 'alice', name: 'Alice', color: '#5865f2', ts: Date.now(), text: '', reply: { id: 'm1', name: 'Bob', text: 'hello' }, att: [{ id: 'a'.repeat(32), name: 'p.png', mime: 'image/png', size: 100 }, { id: 'b'.repeat(32), name: 'n.txt', mime: 'application/octet-stream', size: 2048 }] }], 'official-news': [{ id: 'om', uid: 'official', un: 'official', name: 'Official', color: '#5865f2', ts: Date.now(), text: 'Welcome', official: 1 }] },
  dms: [{ id: 'dm1', user: { id: 'u2', username: 'bob', name: 'Bob', color: '#3ba55d', avatar: null } }],
  friends: { accepted: [{ id: 'u2', username: 'bob', name: 'Bob', color: '#3ba55d', avatar: null }], incoming: [{ id: 'u3', username: 'carol', name: 'Carol', color: '#eb459e', avatar: null }], outgoing: [] },
  presence: { u2: 'online' },
};
state.messages.dm1 = [{ id: 'd1', uid: 'u2', un: 'bob', name: 'Bob', color: '#3ba55d', ts: Date.now(), text: 'psst' }];
const calls = [];
const fetchStub = async (url, opt = {}) => { const m = opt.method || 'GET', p = url.replace('https://x/api', ''); calls.push(m + ' ' + p);
  const body = p === '/state' ? state : p === '/friends' && m === 'GET' ? { ...state.friends, presence: { u2: 'online' } } : p === '/dms' ? { id: 'dm1', user: state.dms[0].user } : { ok: true };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) }; };
const win = { CONFIG: { proto: 'v2', backend: 'remote', apiUrl: 'https://x/api', wsUrl: 'wss://x/ws', token: 't' } };
const ctx = { window: win, document, fetch: fetchStub, WebSocket: WS, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout() {}, confirm: () => true, alert() {}, addEventListener() {}, console, URL, Date, Math, JSON, Promise, Object, Array, Set, Map, RegExp, Error, Notification: undefined, Image: class {}, XMLHttpRequest: class {}, history: {}, location: { reload() { ctx.reloaded = true; } }, CSS: { escape: s => s } };
ctx.globalThis = ctx; vm.createContext(ctx);
const fail = []; const ok = (c, m) => { if (!c) fail.push(m); };
const tgt = map => ({ closest: s => map[s] || null });
const flush = () => new Promise(r => setImmediate(r));
test('v2 backend UI: DMs, friends, replies, mentions, typing, presence', async () => {
  vm.runInContext(code, ctx); await flush(); await flush();
  const $ = s => document.querySelector(s);
  ok(/data-home/.test($('#rail').innerHTML), 'home button in rail');
  ok(/data-c="c1"/.test($('#chlist').innerHTML), 'channel list');
  const msgs = $('#msgs').innerHTML;
  ok(/class="rp"/.test(msgs) && /class="att"/.test(msgs) && /class="file"/.test(msgs), 'reply, image and file attachment rendered');
  ok(/class="mention">@alice/.test(msgs), 'mention highlighted'); ok(/msg  ment|msg ment/.test(msgs), 'mention message flagged');
  ok(!/<b>x<\/b>/.test(msgs), 'html in messages is escaped');
  ok(/<img src="https:\/\/x\/api\/files\/f{32}"/.test($('#members').innerHTML), 'member avatar image');
  ok(/Online — 2/.test($('#members').innerHTML), 'members grouped: me and bob online');
  // websocket events
  const ws = WS.last; ok(!!ws, 'websocket opened');
  ws.onmessage({ data: JSON.stringify({ t: 'msg.new', cid: 'c2', m: { id: 'n1', uid: 'u2', un: 'bob', name: 'Bob', color: '#000', ts: Date.now(), text: 'hi @alice' } }) });
  ok(/class="bdg m">1/.test($('#chlist').innerHTML), 'mention badge on channel');
  ok(/class="bdg m">1/.test($('#rail').innerHTML), 'badge on server');
  ws.onmessage({ data: JSON.stringify({ t: 'typing', cid: 'c1', uid: 'u2', name: 'Bob' }) });
  ok(/Bob is typing/.test($('#hint').textContent), 'typing indicator');
  ws.onmessage({ data: JSON.stringify({ t: 'presence', uid: 'u2', s: 'offline' }) });
  ok(/Offline — 1/.test($('#members').innerHTML), 'presence update moves member to offline');
  ws.onmessage({ data: JSON.stringify({ t: 'user.set', u: { id: 'u2', name: 'Robert', color: '#111111', avatar: null } }) });
  ok(/Robert/.test($('#msgs').innerHTML), 'renamed user updates old messages');
  ws.onmessage({ data: JSON.stringify({ t: 'dm.new', dm: { id: 'dm9', user: { id: 'u5', username: 'dave', name: 'Dave', color: '#fff', avatar: null } } }) });
  ws.onmessage({ data: JSON.stringify({ t: 'resync' }) }); await flush(); await flush();
  ok(calls.includes('GET /state'), 'resync refetches state'); ok(!ctx.reloaded, 'resync does not reload the page');
  // home / friends
  $('#rail').onclick({ target: tgt({ button: { dataset: { home: '1' }, id: '' } }) });
  ok(/class="fp"/.test($('#msgs').innerHTML), 'friends panel'); ok(/Friends/.test($('#chlist').innerHTML) && /data-c="dm1"/.test($('#chlist').innerHTML), 'dm list');
  ok(document.body.classList.contains('nocomp'), 'composer hidden on friends tab');
  $('#msgs').onclick({ target: tgt({ '[data-f]': { dataset: { f: 'tab', t: 'pending' } } }) });
  ok(/Carol/.test($('#msgs').innerHTML) && /data-f="accept"/.test($('#msgs').innerHTML), 'pending requests listed');
  $('#msgs').onclick({ target: tgt({ '[data-f]': { dataset: { f: 'accept', id: 'u3' } } }) }); await flush(); await flush();
  ok(calls.includes('POST /friends/u3/accept'), 'accept request sent');
  $('#msgs').onclick({ target: tgt({ '[data-f]': { dataset: { f: 'dm', id: 'u2' } } }) }); await flush(); await flush();
  ok(calls.includes('POST /dms'), 'open DM request'); ok(/psst/.test($('#msgs').innerHTML), 'dm messages shown');
  ok(/Message @Bob/.test($('#inp').placeholder) || /Message @/.test($('#inp').placeholder), 'dm placeholder: ' + $('#inp').placeholder);
  // reply + send in DM
  $('#msgs').onclick({ target: tgt({ 'button[data-a]': { dataset: { a: 'p' } }, '.msg': { dataset: { id: 'd1' } } }) });
  const inp = $('#inp'); inp.value = 'hey there'; $('#inp').onkeydown({ key: 'Enter', target: inp, preventDefault() {} });
  const sentMsg = sent.find(x => x.t === 'msg.new');
  ok(sentMsg && sentMsg.cid === 'dm1' && sentMsg.m.text === 'hey there' && sentMsg.m.reply && sentMsg.m.reply.id === 'd1' && sentMsg.m.un === 'alice', 'message sent with reply: ' + JSON.stringify(sentMsg));
  inp.value = 'typing now'; $('#inp').oninput(); ok(sent.some(x => x.t === 'typing' && x.cid === 'dm1'), 'typing event sent');
  // official server is read-only
  $('#rail').onclick({ target: tgt({ button: { dataset: { s: 'official-hq' }, id: '' } }) });
  ok($('#inp').disabled === true && /read-only/.test($('#inp').placeholder), 'official server read-only'); ok(/OFFICIAL/.test($('#msgs').innerHTML), 'official badge');
  // profile dialog
  $('#members').onclick({ target: tgt({ '[data-u]': { dataset: { u: 'official' } } }) });
  ok($('#dlg').opened === true, 'profile dialog opens');
  assert.deepStrictEqual(fail, []);
});
