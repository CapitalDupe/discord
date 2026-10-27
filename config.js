// Backend is chosen at runtime so no URL or secret has to live in this public repo.
//  proto v2 (default for now): the legacy backend (/api + /ws, token kept in localStorage). This is what the deployed VPS runs.
//  proto v3: REST under /api/v1 + Socket.IO. Opt in with ?proto=v3, back with ?proto=v2. Only works once the v3 backend has its routes.
//  ?backend=https://api.example sets the API origin when this page is hosted somewhere else; ?backend=local = browser-only mode.
(() => {
  let L = null; try { L = localStorage; } catch {}
  const url = new URL(location.href), q = url.searchParams;
  try {
    if (q.has('backend')) { const b = q.get('backend').trim().replace(/\/+$/, ''); b && b !== 'local' ? L.setItem('dc-backend', b) : L.removeItem('dc-backend'); }
    if (q.has('proto')) q.get('proto') === 'v3' ? L.setItem('dc-proto', 'v3') : L.removeItem('dc-proto');
    if (q.has('token')) L.setItem('dc-token', q.get('token'));
    // Remove only our own setup params so other links (?join=, ?verify=, ?reset=) keep working.
    const had = ['backend', 'proto', 'token'].some(k => q.has(k));
    ['backend', 'proto', 'token'].forEach(k => q.delete(k));
    if (had) history.replaceState(null, '', url.pathname + (q.toString() ? '?' + q : '') + url.hash);
  } catch {}
  const proto = (L && L.getItem('dc-proto')) === 'v3' ? 'v3' : 'v2';
  const saved = (L && L.getItem('dc-backend')) || '';
  // v3 served from the API's own domain: same origin, so the refresh cookie is first-party. GitHub Pages has no API, so it starts in local mode.
  const sameOrigin = proto === 'v3' && /^https?:$/.test(location.protocol) && !/\.github\.io$/.test(location.hostname);
  const base = saved || (sameOrigin ? location.origin : '');
  window.CONFIG = {
    proto,
    backend: base ? 'remote' : 'local',
    apiUrl: base ? base + (proto === 'v3' ? '/api/v1' : '/api') : '',
    wsUrl: !base ? '' : proto === 'v3' ? base : base.replace(/^http/, 'ws') + '/ws',
    token: proto === 'v2' && L ? (L.getItem('dc-token') || '') : ''   // v3 keeps the access token in memory only
  };
})();
