const THRESHOLD = 80;
const MAX_TRANSLATE = 44;

let startY = 0;
let pullDelta = 0;
let pulling = false;
let indicator = null;

function createIndicator() {
  const el = document.createElement('div');
  el.className = 'ptr-indicator';
  el.innerHTML = '<div class="ptr-spinner"></div>';
  document.body.appendChild(el);
  return el;
}

function update(d) {
  const progress = Math.min(d / THRESHOLD, 1);
  const ty = Math.min(d * 0.5, MAX_TRANSLATE) - MAX_TRANSLATE;
  indicator.style.opacity = String(progress);
  indicator.style.transform = `translateX(-50%) translateY(${ty}px) scale(${0.6 + progress * 0.4})`;
}

function hide() {
  indicator.style.opacity = '0';
  indicator.style.transform = `translateX(-50%) translateY(${-MAX_TRANSLATE}px) scale(0.7)`;
}

export function init() {
  const content = document.getElementById('main-content');
  if (!content || content._ptr) return;
  content._ptr = true;

  indicator = createIndicator();
  hide();

  content.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
    pullDelta = 0;
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const d = e.touches[0].clientY - startY;
    if (d <= 0) { pulling = false; hide(); return; }
    pullDelta = d;
    update(d);
    if (d > 10) e.preventDefault();
  }, { passive: false });

  content.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const triggered = pullDelta >= THRESHOLD;
    pullDelta = 0;
    hide();
    if (triggered) window.planium?.refresh();
  }, { passive: true });
}
