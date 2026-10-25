// Login gate + account buttons.
// No backend saved yet: show the sign-up/login page with a Backend URL field (or continue offline).
// Backend saved: validate the session, else show login/register, then load app.js + mobile.js.
(() => {
  const C = window.CONFIG, B = document.body, remote = C.backend === 'remote';
  const L = (() => { try { return localStorage; } catch { return { getItem() {}, setItem() {}, removeItem() {} }; } })();
  if (new URLSearchParams(location.search).has('login')) { L.removeItem('dc-offline'); history.replaceState(null, '', location.pathname); }
  const load = (...src) => src.reduce((p, s) => p.then(() => new Promise(r => { const e = document.createElement('script'); e.src = s; e.onload = e.onerror = r; B.append(e); })), Promise.resolve());
  const boot = () => load('app.js', 'mobile.js');
  if (!remote && L.getItem('dc-offline')) return boot();   // offline mode; open the site with ?login to come back here

  const css = document.createElement('style');
  css.textContent = '#auth{position:fixed;inset:0;display:grid;place-items:center;background:#1e1f22;z-index:50;padding:16px;color:#dbdee1;font-family:system-ui,sans-serif;overflow:auto}#auth form{background:#313338;border-radius:8px;padding:24px;width:min(400px,100%)}#auth h2{margin:0 0 16px}#auth label{display:block;margin-bottom:12px;color:#949ba4;font-size:12px;text-transform:uppercase}#auth input{display:block;width:100%;margin-top:6px;height:40px;padding:0 10px;border:0;border-radius:4px;background:#1e1f22;color:#dbdee1;font-size:16px}#auth button{width:100%;height:42px;border:0;border-radius:4px;background:#5865f2;color:#fff;font-size:16px;cursor:pointer}#auth .alt{background:none;color:#00a8fc;height:auto;margin-top:12px}#auth .err{color:#f23f42;min-height:20px;margin:0 0 8px;font-size:14px}#side>header button{font-size:16px;color:#949ba4;padding:0 4px}#side>header button:hover{color:#dbdee1}';
  document.head.append(css);

  const api = (p, o = {}, base = C.apiUrl) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(C.token ? { Authorization: 'Bearer ' + C.token } : {}) }, body: o.body && JSON.stringify(o.body) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status }); return d; });

  function loginUI(note) {
    let reg = false; const box = document.createElement('div'); box.id = 'auth'; B.append(box);
    const draw = () => {
      box.innerHTML = `<form><h2>${reg ? 'Create account' : 'Welcome back'}</h2><p class="err">${note || ''}</p>
        ${remote ? '' : '<label>Backend URL<input name="url" type="url" inputmode="url" placeholder="https://your-service.onrender.com" required></label>'}
        <label>Username<input name="username" autocomplete="username" required></label>
        <label>Password${reg ? ' (10+ characters)' : ''}<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
        ${reg ? '<label>Signup code (if required)<input name="code" autocomplete="off"></label>' : ''}
        <button>${reg ? 'Create account' : 'Log in'}</button><button type="button" class="alt" id="sw">${reg ? 'Have an account? Log in' : 'Need an account? Register'}</button>
        ${remote ? '' : '<button type="button" class="alt" id="off">Continue offline (this browser only)</button>'}</form>`;
      const f = box.querySelector('form'), err = box.querySelector('.err');
      f.querySelector('#sw').onclick = () => { reg = !reg; note = ''; draw(); };
      const off = f.querySelector('#off'); if (off) off.onclick = () => { L.setItem('dc-offline', '1'); location.reload(); };
      f.onsubmit = async e => {
        e.preventDefault(); err.textContent = '';
        const b = Object.fromEntries(new FormData(f)), root = remote ? '' : String(b.url).trim().replace(/\/+$/, ''); delete b.url;
        try {
          const d = await api(reg ? '/register' : '/login', { method: 'POST', body: b }, remote ? C.apiUrl : root + '/api');
          if (!remote) L.setItem('dc-backend', root);
          L.setItem('dc-token', d.token); location.reload();
        } catch (x) { err.textContent = x.status ? x.message : 'Cannot reach the server. If it is on a free host it may be waking up, try again in a minute.'; }
      };
    };
    draw();
  }

  async function start() {
    // Reload to real server state whenever the server rejects an action
    const WS = WebSocket; window.WebSocket = class extends WS { constructor(...a) { super(...a); this.addEventListener('message', e => { try { if (JSON.parse(e.data).t === 'resync') location.reload(); } catch {} }); } };
    const j = new URLSearchParams(location.search).get('join');
    if (j) { try { await api('/invites/' + encodeURIComponent(j) + '/join', { method: 'POST' }); } catch (e) { alert(e.message); } history.replaceState(null, '', location.pathname); }
    await boot();
    document.querySelector('#side header').insertAdjacentHTML('beforeend', '<button id="inv" title="Invite link">🔗</button><button id="jn" title="Join with invite code">⤵️</button><button id="lo" title="Log out">⎋</button>');
    document.getElementById('inv').onclick = async () => {
      const sid = document.querySelector('.srv.on')?.dataset.s; if (!sid) return;
      try { const d = await api(`/servers/${sid}/invites`, { method: 'POST', body: {} }); prompt('Invite link (valid 7 days, 10 uses):', `${location.origin}${location.pathname}?join=${d.code}`); } catch (e) { alert(e.message); }
    };
    document.getElementById('jn').onclick = async () => {
      const v = prompt('Paste an invite code or link:'); if (!v) return;
      try { await api('/invites/' + encodeURIComponent(v.split('join=').pop().trim()) + '/join', { method: 'POST' }); location.reload(); } catch (e) { alert(e.message); }
    };
    document.getElementById('lo').onclick = () => api('/logout', { method: 'POST' }).catch(() => {}).finally(() => { L.removeItem('dc-token'); location.reload(); });
  }

  (async () => {
    if (!remote || !C.token) return loginUI();
    try { await api('/me'); start(); }
    catch (e) { if (e.status === 401) { L.removeItem('dc-token'); loginUI('Session expired, please log in again.'); } else loginUI('Cannot reach the server. If it is on a free host it may be waking up, try again in a minute.'); }
  })();
})();
