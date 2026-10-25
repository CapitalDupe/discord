// Login gate + account buttons.
//  v3 (default): the access token lives in memory; a page reload restores the session from the HttpOnly refresh cookie.
//  v2 (legacy, ?proto=v2): the session token is kept in localStorage, as before.
(() => {
  const C = window.CONFIG, B = document.body, remote = C.backend === 'remote', v3 = C.proto === 'v3';
  const L = (() => { try { return localStorage; } catch { return { getItem() {}, setItem() {}, removeItem() {} }; } })();
  const qs = new URLSearchParams(location.search);
  // Remove one query parameter without losing the others.
  const strip = (...keys) => { const u = new URL(location.href); keys.forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + u.search + u.hash); };
  if (qs.has('login')) { L.removeItem('dc-offline'); strip('login'); }
  const load = (...src) => src.reduce((p, s) => p.then(() => new Promise(r => { const e = document.createElement('script'); e.src = s; e.onload = e.onerror = r; B.append(e); })), Promise.resolve());
  const boot = () => load('app.js', 'mobile.js');
  if (!remote && L.getItem('dc-offline')) return boot();   // offline mode; open the site with ?login to come back here

  const css = document.createElement('style');
  css.textContent = '#auth{position:fixed;inset:0;display:grid;place-items:center;background:#1e1f22;z-index:50;padding:16px;color:#dbdee1;font-family:system-ui,sans-serif;overflow:auto}#auth form{background:#313338;border-radius:8px;padding:24px;width:min(400px,100%)}#auth h2{margin:0 0 16px}#auth label{display:block;margin-bottom:12px;color:#949ba4;font-size:12px;text-transform:uppercase}#auth input{display:block;width:100%;margin-top:6px;height:40px;padding:0 10px;border:0;border-radius:4px;background:#1e1f22;color:#dbdee1;font-size:16px}#auth button{width:100%;height:42px;border:0;border-radius:4px;background:#5865f2;color:#fff;font-size:16px;cursor:pointer}#auth button:disabled{opacity:.6;cursor:wait}#auth .alt{background:none;color:#00a8fc;height:auto;margin-top:12px}#auth .err{color:#f23f42;min-height:20px;margin:0 0 8px;font-size:14px}#auth .ok{color:#23a55a;min-height:20px;margin:0 0 8px;font-size:14px}#side>header button{font-size:16px;color:#949ba4;padding:0 4px}#side>header button:hover{color:#dbdee1}';
  document.head.append(css);

  const NET_ERR = 'Cannot reach the server. If it is on a free host it may be waking up, try again in a minute.';

  // ---------------------------------------------------------------- v2 (legacy)
  const api2 = (p, o = {}, base = C.apiUrl) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(C.token ? { Authorization: 'Bearer ' + C.token } : {}) }, body: o.body && JSON.stringify(o.body) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status }); return d; });
  // One entry point for both protocols (same {method, body} options).
  const call = (p, o = {}) => v3 ? window.V3.api(p, o) : api2(p, o);

  function loginUI2(note) {
    let reg = false; const box = document.createElement('div'); box.id = 'auth'; B.append(box);
    const draw = () => {
      box.innerHTML = `<form><h2>${reg ? 'Create account' : 'Welcome back'}</h2><p class="err">${note || ''}</p>
        ${remote ? '' : '<label>Backend URL<input name="url" type="url" inputmode="url" placeholder="https://your-service.onrender.com" required></label>'}
        <label>Username<input name="username" autocomplete="username" required></label>
        <label>Password${reg ? ' (10+ characters)' : ''}<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
        <button>${reg ? 'Create account' : 'Log in'}</button><button type="button" class="alt" id="sw">${reg ? 'Have an account? Log in' : 'Need an account? Register'}</button>
        ${remote ? '' : '<button type="button" class="alt" id="off">Continue offline (this browser only)</button>'}</form>`;
      const f = box.querySelector('form'), err = box.querySelector('.err');
      f.querySelector('#sw').onclick = () => { reg = !reg; note = ''; draw(); };
      const off = f.querySelector('#off'); if (off) off.onclick = () => { L.setItem('dc-offline', '1'); location.reload(); };
      f.onsubmit = async e => {
        e.preventDefault(); err.textContent = '';
        const b = Object.fromEntries(new FormData(f)), root = remote ? '' : String(b.url).trim().replace(/\/+$/, ''); delete b.url;
        try {
          const d = await api2(reg ? '/register' : '/login', { method: 'POST', body: b }, remote ? C.apiUrl : root + '/api');
          if (!remote) L.setItem('dc-backend', root);
          L.setItem('dc-token', d.token); location.reload();
        } catch (x) { err.textContent = x.status ? x.message : NET_ERR; }
      };
    };
    draw();
  }

  // ---------------------------------------------------------------- v3
  // No API known yet (for example this page is on GitHub Pages): ask for the API address, then reload.
  function backendUI() {
    const box = document.createElement('div'); box.id = 'auth'; B.append(box);
    box.innerHTML = '<form><h2>Connect to a server</h2><p class="err"></p><label>API address<input name="url" type="url" inputmode="url" placeholder="https://chat.example.com" required></label><button>Continue</button><button type="button" class="alt" id="off">Continue offline (this browser only)</button></form>';
    box.querySelector('form').onsubmit = e => { e.preventDefault(); L.setItem('dc-backend', String(new FormData(e.target).get('url')).trim().replace(/\/+$/, '')); location.reload(); };
    box.querySelector('#off').onclick = () => { L.setItem('dc-offline', '1'); location.reload(); };
  }

  // mode: login | register | forgot | mfa | reset
  function ui3(mode, note = '', kind = 'err', resetToken = '') {
    let mfaToken = null, backup = false;
    const box = document.getElementById('auth') || B.appendChild(Object.assign(document.createElement('div'), { id: 'auth' }));
    const field = (n, label, o = {}) => `<label>${label}<input name="${n}" type="${o.type || 'text'}"${o.ac ? ` autocomplete="${o.ac}"` : ''}${o.extra ? ' ' + o.extra : ''} required></label>`;
    const pw = (n, label, ac) => field(n, label, { type: 'password', ac, extra: 'minlength="10" maxlength="128"' });
    const forms = () => ({
      login: ['Welcome back', field('identifier', 'Username or email', { ac: 'username' }) + field('password', 'Password', { type: 'password', ac: 'current-password' }), 'Log in'],
      register: ['Create account', field('email', 'Email', { type: 'email', ac: 'email' }) + field('username', 'Username', { ac: 'username', extra: 'minlength="3" maxlength="32"' }) + pw('password', 'Password (10+ characters)', 'new-password') + field('birthDate', 'Date of birth', { type: 'date' }), 'Create account'],
      forgot: ['Reset your password', field('email', 'Email', { type: 'email', ac: 'email' }), 'Send reset link'],
      mfa: ['Two-factor code', field('code', backup ? 'Backup code' : 'Code from your authenticator app', { ac: 'one-time-code', extra: backup ? '' : 'inputmode="numeric"' }), 'Verify'],
      reset: ['Choose a new password', pw('newPassword', 'New password (10+ characters)', 'new-password'), 'Save password'],
    })[mode];
    const links = () => ({
      login: [['register', 'Need an account? Register'], ['forgot', 'Forgot your password?']],
      register: [['login', 'Have an account? Log in']],
      forgot: [['login', 'Back to log in']],
      mfa: [['backup', backup ? 'Use your authenticator code' : 'Use a backup code'], ['login', 'Back to log in']],
      reset: [],
    })[mode];

    const post = (path, body) => window.V3.raw(path, { method: 'POST', noAuth: true, body });
    // The API asks for a proof-of-work check (no third-party CAPTCHA) when traffic looks automated.
    const withChallenge = async (path, body, say) => {
      try { return await post(path, body); }
      catch (e) {
        if (e.code !== 'CHALLENGE_REQUIRED') throw e;
        say('Running a quick check that you are not a bot…', 'ok');
        const ch = await window.V3.raw('/auth/challenge', { noAuth: true });
        return post(path, { ...body, challenge: { id: ch.id, solution: await window.V3.solve(ch) } });
      }
    };
    const done = d => { window.V3.setToken(d); box.remove(); start(); };

    const draw = () => {
      const [title, inputs, cta] = forms();
      box.innerHTML = `<form><h2>${title}</h2><p role="status"></p>${inputs}<button>${cta}</button>${links().map(([k, t]) => `<button type="button" class="alt" data-go="${k}">${t}</button>`).join('')}</form>`;
      const f = box.querySelector('form'), p = f.querySelector('p'), btn = f.querySelector('button:not(.alt)');
      const say = (t, k = 'err') => { p.className = k; p.textContent = t; };   // textContent: server messages are never parsed as HTML
      say(note, kind); note = '';
      f.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.go === 'backup') backup = !backup; else mode = b.dataset.go; draw(); });
      f.onsubmit = async e => {
        e.preventDefault(); const b = Object.fromEntries(new FormData(f)); say(''); btn.disabled = true;
        try {
          if (mode === 'login') {
            const d = await withChallenge('/auth/login', { identifier: b.identifier.trim(), password: b.password }, say);
            if (d.mfaRequired) { mfaToken = d.mfaToken; mode = 'mfa'; return draw(); }
            return done(d);
          }
          if (mode === 'mfa') return done(await post('/auth/mfa/verify', { mfaToken, code: b.code.trim(), type: backup ? 'backup' : 'totp' }));
          if (mode === 'register') {
            await withChallenge('/auth/register', { email: b.email.trim(), username: b.username.trim(), password: b.password, birthDate: b.birthDate }, say);
            mode = 'login'; note = 'Check your email to confirm your account, then log in.'; kind = 'ok'; return draw();
          }
          if (mode === 'forgot') {
            await post('/auth/password/forgot', { email: b.email.trim() });
            mode = 'login'; note = 'If that email has an account, a reset link is on its way.'; kind = 'ok'; return draw();
          }
          if (mode === 'reset') {
            await post('/auth/password/reset', { token: resetToken, newPassword: b.newPassword });
            strip('reset'); mode = 'login'; note = 'Password changed. Log in with your new password.'; kind = 'ok'; return draw();
          }
        } catch (x) { kind = 'err'; say(x.status ? x.message : NET_ERR); btn.disabled = false; }
      };
    };
    draw();
  }

  // ---------------------------------------------------------------- shared: signed-in setup
  async function start() {
    // v2 only: reload to real server state whenever the server rejects an action
    if (!v3) { const WS = WebSocket; window.WebSocket = class extends WS { constructor(...a) { super(...a); this.addEventListener('message', e => { try { if (JSON.parse(e.data).t === 'resync') location.reload(); } catch {} }); } }; }
    const acceptPath = c => '/invites/' + encodeURIComponent(c) + (v3 ? '/accept' : '/join');
    const j = qs.get('join');
    if (j) { try { await call(acceptPath(j), { method: 'POST' }); } catch (e) { alert(e.message); } strip('join'); }
    await boot();
    document.querySelector('#side header').insertAdjacentHTML('beforeend', '<button id="inv" title="Invite link">🔗</button><button id="jn" title="Join with invite code">⤵️</button><button id="lo" title="Log out">⎋</button>');
    document.getElementById('inv').onclick = async () => {
      const sid = document.querySelector('.srv.on')?.dataset.s; if (!sid) return;
      try { const d = await call(`/servers/${sid}/invites`, { method: 'POST', body: {} }); prompt('Invite link:', `${location.origin}${location.pathname}?join=${d.code}`); } catch (e) { alert(e.message); }
    };
    document.getElementById('jn').onclick = async () => {
      const v = prompt('Paste an invite code or link:'); if (!v) return;
      try { await call(acceptPath(v.split('join=').pop().trim()), { method: 'POST' }); location.reload(); } catch (e) { alert(e.message); }
    };
    document.getElementById('lo').onclick = () => {
      if (v3) call('/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => { window.V3.clear(); location.reload(); });
      else api2('/logout', { method: 'POST' }).catch(() => {}).finally(() => { L.removeItem('dc-token'); location.reload(); });
    };
    document.dispatchEvent(new Event('dc:ready'));
  }

  // ---------------------------------------------------------------- entry
  (async () => {
    if (v3) {
      if (!remote) return backendUI();
      await load('v3.js');
      if (!window.V3) return ui3('login', 'Could not load the app. Check your connection and reload.');
      if (qs.has('reset')) return ui3('reset', '', 'err', qs.get('reset'));
      let note = '', kind = 'err';
      if (qs.has('verify')) {   // link from the confirmation email
        try { await window.V3.raw('/auth/verify-email', { method: 'POST', noAuth: true, body: { token: qs.get('verify') } }); note = 'Email confirmed. You can log in now.'; kind = 'ok'; }
        catch (e) { note = e.status ? e.message : NET_ERR; }
        strip('verify');
      }
      if (await window.V3.refresh()) return start();
      return ui3('login', note, kind);
    }
    if (!remote || !C.token) return loginUI2();
    try { await api2('/me'); start(); }
    catch (e) { if (e.status === 401) { L.removeItem('dc-token'); loginUI2('Session expired, please log in again.'); } else loginUI2(NET_ERR); }
  })();
})();
