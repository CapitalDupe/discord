// Account & IDs panel: username, user ID, server ID, channel IDs and your session token (with copy buttons).
(() => {
  const C = window.CONFIG, $ = s => document.querySelector(s), remote = C.backend === 'remote' && !!C.token;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const copy = async t => { try { await navigator.clipboard.writeText(t); } catch { prompt('Copy this:', t); } };
  const st = document.createElement('style');
  st.textContent = '#side>header button{font-size:16px;color:#949ba4;padding:0 4px}#side>header button:hover{color:#dbdee1}#idp{max-height:86vh;overflow:auto;width:min(460px,94vw)}#idp .r{margin-bottom:12px}#idp .r b{display:block;color:#949ba4;font-size:11px;text-transform:uppercase}#idp code{display:block;margin:4px 0;padding:6px;background:#1e1f22;border-radius:4px;font-size:13px;word-break:break-all}#idp .r button,#idp .x{background:#4e5058;color:#fff;border-radius:4px;padding:4px 10px;margin-right:6px}#idp .warn{color:#f0b232;font-size:13px}';
  document.head.append(st);
  $('#side header').insertAdjacentHTML('beforeend', '<button id="ids" title="Account and IDs">🪪</button>');

  let me = null;
  const fetchMe = async () => {
    if (!remote) return null;
    try { const r = await fetch(C.apiUrl + '/me', { headers: { Authorization: 'Bearer ' + C.token } }); return r.ok ? await r.json() : null; } catch { return null; }
  };
  // show @username under your name in the sidebar
  const paint = () => { const s = $('#me .nm small'); if (s && me && s.textContent !== '@' + me.username) s.textContent = '@' + me.username; };
  new MutationObserver(paint).observe($('#me'), { childList: true, subtree: true });
  fetchMe().then(m => { me = m; paint(); });

  const row = (label, val) => `<div class="r"><b>${label}</b><code>${esc(val)}</code><button data-c="${esc(val)}">Copy</button></div>`;
  $('#ids').onclick = async () => {
    me = me || await fetchMe();
    const sid = $('.srv.on')?.dataset.s, chans = [...document.querySelectorAll('.ch[data-c]')], srvs = [...document.querySelectorAll('.srv[data-s]')];
    let d = document.getElementById('idp'); if (!d) { d = document.createElement('dialog'); d.id = 'idp'; document.body.append(d); }
    d.innerHTML = `<h3>Account &amp; IDs</h3>
      ${row('Username', me ? '@' + me.username : '(offline mode, no account)')}
      ${row('Display name', me ? me.name : '')}
      ${row('User ID', me ? me.id : 'me')}
      ${row('Current server ID', sid || '(none)')}
      ${srvs.length > 1 ? '<div class="r"><b>All server IDs</b>' + srvs.map(e => `<code>${esc(e.title)}: ${esc(e.dataset.s)}</code>`).join('') + '</div>' : ''}
      <div class="r"><b>Channel IDs (this server)</b>${chans.map(e => `<code>${esc(e.textContent.trim())}: ${esc(e.dataset.c)}</code><button data-c="${esc(e.dataset.c)}">Copy ID</button>`).join('') || '<code>(none)</code>'}</div>
      ${remote ? '<div class="r"><b>Session token</b><code id="tk">••••••••••••</code><button id="tks">Show</button><button id="tkc">Copy</button><p class="warn">Anyone with this token can act as you. Never share it. Logging out revokes it.</p></div>' : ''}
      <menu style="padding:0;margin:8px 0 0"><form method="dialog"><button class="x">Close</button></form></menu>`;
    d.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) copy(b.dataset.c);
      else if (b.id === 'tks') { const t = d.querySelector('#tk'), hidden = t.textContent.startsWith('•'); t.textContent = hidden ? C.token : '••••••••••••'; b.textContent = hidden ? 'Hide' : 'Show'; }
      else if (b.id === 'tkc') copy(C.token);
    };
    d.showModal();
  };
})();
