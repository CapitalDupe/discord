(() => {
const $ = s => document.querySelector(s), B = document.body;
const mob = () => innerWidth <= 800, touch = () => matchMedia('(hover:none)').matches;

// Members list as a right-hand drawer on phones
$('#tgm').addEventListener('click', e => { if (!mob()) return; e.stopImmediatePropagation(); B.classList.toggle('memo'); }, true);
$('#burger').addEventListener('click', () => B.classList.remove('memo'));
$('main').addEventListener('click', e => { if (!e.target.closest('#tgm')) B.classList.remove('memo'); });
addEventListener('resize', () => { if (!mob()) B.classList.remove('memo'); });

// Tap a message to reveal react / edit / delete (no hover on touch screens)
$('#msgs').addEventListener('click', e => {
  if (!touch() || e.target.closest('button,a')) return;
  const m = e.target.closest('.msg'), was = m?.classList.contains('sel');
  document.querySelectorAll('.msg.sel').forEach(x => x.classList.remove('sel'));
  if (m && !was) m.classList.add('sel');
});

// Long-press a server or channel to delete it (touch replacement for right-click)
let swallow = 0;
function longPress(sel) {
  const el = $(sel); let t, x, y;
  el.addEventListener('contextmenu', e => { if (e.isTrusted && touch()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  el.addEventListener('click', e => { if (Date.now() - swallow < 800) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  el.addEventListener('touchstart', e => {
    const h = e.target.closest('[data-s],[data-c]'); if (!h) return;
    x = e.touches[0].clientX; y = e.touches[0].clientY;
    t = setTimeout(() => { navigator.vibrate?.(20); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); swallow = Date.now(); }, 550);
  }, { passive: true });
  el.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - x) + Math.abs(e.touches[0].clientY - y) > 10) clearTimeout(t); }, { passive: true });
  ['touchend', 'touchcancel'].forEach(n => el.addEventListener(n, () => clearTimeout(t)));
}
longPress('#rail'); longPress('#chlist');
})();
