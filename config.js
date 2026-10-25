// Backend is chosen at runtime so no URL or secret has to live in this public repo.
// One-time setup: open the site with  ?backend=https://YOUR-BACKEND&token=YOUR-TOKEN
// To go back to browser-only mode: open it with  ?backend=local
(() => {
  let L = null; try { L = localStorage; } catch {}
  const q = new URLSearchParams(location.search);
  try {
    if (q.has('backend')) { const b = q.get('backend').trim().replace(/\/+$/, ''); b && b !== 'local' ? L.setItem('dc-backend', b) : L.removeItem('dc-backend'); }
    if (q.has('token')) L.setItem('dc-token', q.get('token'));
    if (q.has('backend') || q.has('token')) history.replaceState(null, '', location.pathname);
  } catch {}
  const b = (L && L.getItem('dc-backend')) || '';
  window.CONFIG = {
    backend: b ? 'remote' : 'local',
    apiUrl: b ? b + '/api' : '',
    wsUrl: b ? b.replace(/^http/, 'ws') + '/ws' : '',
    token: (L && L.getItem('dc-token')) || ''
  };
})();
