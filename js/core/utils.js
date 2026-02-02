export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const sign = (v) => (v < 0 ? -1 : 1);

export function ms(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  return `${Math.round(sec * 1000)}ms`;
}

export function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const tt = clamp(t, 0, 1);
  const cx = x1 + tt * dx;
  const cy = y1 + tt * dy;
  return Math.hypot(px - cx, py - cy);
}

export function randomInDisc(radius) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export function isTouchLike() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}
