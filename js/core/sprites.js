import { clamp } from './utils.js';

export const sprites = {};

const spriteConfigManual = {
  'cowboy1_draw-Sheet.png': { fw: 32, fh: 32, frames: 10 },
  'cowboy1_ONLYshooting(nodraw)-Sheet.png': { fw: 32, fh: 32, frames: 5 },
  'cowboy1_walk.png': { fw: 32, fh: 32, frames: 16 },
  'cowboy1_rotate_all_standing.png': { fw: 32, fh: 32, frames: 4 },
  'cowboy1_die.png': { fw: 32, fh: 32, frames: 14 },

  'cowboy2_draw-Sheet.png': { fw: 32, fh: 32, frames: 9 },
  'cowboy2_shootOnly-Sheet.png': { fw: 32, fh: 32, frames: 13 },
  'cowboy2_death-Sheet.png': { fw: 32, fh: 32, frames: 9 },

  'cowboy3_fire-Sheet.png': { fw: 32, fh: 64, frames: 24 },

  'trees1-Sheet.png': { fw: 64, fh: 80, frames: 15 },

  'duck1_fly-Sheet.png': { fw: 32, fh: 32, frames: 6 },
  'duck1_rotate-Sheet.png': { fw: 32, fh: 32, frames: 6 },
  'duck1shot-Sheet.png': { fw: 32, fh: 32, frames: 6 },
};

export const spriteList = [
  // Cowboys
  'cowboy1_draw-Sheet.png',
  'cowboy1_ONLYshooting(nodraw)-Sheet.png',
  'cowboy1_walk.png',
  'cowboy1_rotate_all_standing.png',
  'cowboy1_die.png',

  'cowboy2_draw-Sheet.png',
  'cowboy2_shootOnly-Sheet.png',
  'cowboy2_death-Sheet.png',

  // Cowboy 3 optional
  'cowboy3_death-Sheet.png',
  'cowboy3_hit-Sheet.png',
  'cowboy3_fire-Sheet.png',
  'cowboy3_rotate-Sheet.png',
  'cowboy3_drawonly.png',

  // Environment
  'trees1-Sheet.png',
  'bestbackground_west1.png',

  // Duck hunt
  'duck1_fly-Sheet.png',
  'duck1shot-Sheet.png',
  'duck1_rotate-Sheet.png',
  'ducklogo1.png',
];

export function spriteOk(name) {
  const img = sprites[name];
  return !!(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
}

export function getCfg(name, fallbackFw = 32, fallbackFh = 32) {
  if (spriteConfigManual[name]) return spriteConfigManual[name];
  const img = sprites[name];
  if (!spriteOk(name)) return { fw: fallbackFw, fh: fallbackFh, frames: 1 };

  if (img.naturalWidth % fallbackFw === 0) {
    return { fw: fallbackFw, fh: fallbackFh, frames: Math.max(1, Math.floor(img.naturalWidth / fallbackFw)) };
  }
  if (img.naturalWidth % img.naturalHeight === 0) {
    const fw = img.naturalHeight;
    return { fw, fh: img.naturalHeight, frames: Math.max(1, Math.floor(img.naturalWidth / fw)) };
  }
  return { fw: img.naturalWidth, fh: img.naturalHeight, frames: 1 };
}

export function drawSpriteFrame(ctx, name, frame, sx, sy, scaleX = 1, scaleY = 1, alpha = 1) {
  if (!spriteOk(name)) return;
  const img = sprites[name];
  const cfg = getCfg(name);

  const f = clamp(frame, 0, cfg.frames - 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(
    img,
    f * cfg.fw, 0,
    cfg.fw, cfg.fh,
    -cfg.fw / 2, -cfg.fh / 2,
    cfg.fw, cfg.fh
  );
  ctx.restore();
}

export function loadSprites(onComplete) {
  let loaded = 0;
  spriteList.forEach((name) => {
    const img = new Image();
    img.onload = () => {
      loaded++;
      if (loaded === spriteList.length) onComplete();
    };
    img.onerror = () => {
      loaded++;
      if (loaded === spriteList.length) onComplete();
    };
    img.src = name;
    sprites[name] = img;
  });
}
