import { AimModel } from '../core/aim.js';
import { Flags, Input, canvas, ctx, statusEl, subStatusEl, roundEl } from '../core/state.js';
import { clamp, rand, randInt, randomInDisc, distPointToSegment } from '../core/utils.js';
import { drawSpriteFrame, getCfg, spriteOk, sprites } from '../core/sprites.js';
import { hideMessage } from '../ui/message.js';

export class OverworldScene {
  constructor() {
    this.worldW = 2200;
    this.worldH = 2200;
    this.camera = { x: 0, y: 0 };

    this.BULLET_SPEED = 900;
    this.BULLET_TRAIL = 0.016;

    // auto-holster tuning (your request: “longer than you think”)
    this.AUTO_HOLSTER_WHILE_MOVING_SEC = 3.8;

    this.player = {
      x: this.worldW / 2 - 200,
      y: this.worldH / 2 + 120,
      speed: 140,
      radius: 12,
      facingX: 1, // for walk sheet
      dir: 0,
      walkT: 0,

      combat: {
        state: 'holstered', // holstered | drawing | aiming | shooting | holstering
        frame: 0,
        frameTime: 0,
        drawSpeed: 0.030,
        hasShot: false,
        releaseQueued: false,
        aimStartAt: null,
        aimSeed1: Math.random() * 10,
        aimSeed2: Math.random() * 10,

        // side-view gun facing (left/right)
        facing: 1,

        // auto-holster
        lastActionAt: 0,
      }
    };

    this.isMoving = false;
    this.moveX = 0;
    this.moveY = 0;

    this.obstacles = [];
    this.bullets = [];
    this.dust = [];
    this.tumbleweeds = [];
    this.flashAlpha = 0;

    this.duelSpot = { x: this.worldW / 2, y: this.worldH / 2, r: 40 };

    this.groundTile = document.createElement('canvas');
    this.groundTile.width = 256;
    this.groundTile.height = 256;
    this.makeGroundTile();

    this.time = 0;
  }

  onEnter() { this.reset(); }
  onExit() {}

  newMatch() { this.reset(); }
  reset() {
    this.time = 0;
    this.player.x = this.worldW / 2 - 200;
    this.player.y = this.worldH / 2 + 120;
    this.player.walkT = 0;
    this.player.dir = 0;
    this.player.facingX = 1;

    const c = this.player.combat;
    c.state = 'holstered';
    c.frame = 0;
    c.frameTime = 0;
    c.hasShot = false;
    c.releaseQueued = false;
    c.aimStartAt = null;
    c.facing = 1;
    c.lastActionAt = 0;

    this.isMoving = false;
    this.moveX = 0;
    this.moveY = 0;

    this.flashAlpha = 0;
    this.bullets.length = 0;
    this.obstacles.length = 0;
    this.dust.length = 0;
    this.tumbleweeds.length = 0;

    this.generateWorld();
    this.initDust();
    this.updateCamera();

    hideMessage();
  }

  onHolsterToggle() {
    const c = this.player.combat;
    if (c.state === 'holstered' || c.state === 'shooting') return;

    const drawCfg = getCfg('cowboy1_draw-Sheet.png');
    c.state = 'holstering';
    c.frameTime = 0;
    c.releaseQueued = false;
    c.aimStartAt = null;
    c.lastActionAt = this.time;

    if (c.state === 'aiming') c.frame = drawCfg.frames - 1;
  }

  onDrawPress() {
    const now = this.time;
    const c = this.player.combat;

    // Decide facing from pointer immediately (feels good)
    const aim = this.getAimBaseWorld();
    c.facing = (aim.x < this.player.x) ? -1 : 1;

    if (c.state === 'holstered') {
      c.state = 'drawing';
      c.frame = 0;
      c.frameTime = 0;
      c.hasShot = false;
      c.releaseQueued = false;
      c.aimStartAt = null;
      c.lastActionAt = now;
      return;
    }

    if (c.state === 'aiming' && !c.hasShot) {
      c.aimStartAt = now;
      c.lastActionAt = now;
    }
  }

  onDrawRelease() {
    if (Input.suppressNextRelease) {
      Input.suppressNextRelease = false;
      return;
    }

    const now = this.time;
    const c = this.player.combat;

    if (c.state === 'drawing' && !c.hasShot) {
      c.releaseQueued = true;
      return;
    }

    if (c.state === 'aiming' && !c.hasShot) {
      this.firePlayerShot(now);
    }
  }

  getAimBaseWorld() {
    return { x: this.camera.x + Input.pointer.x, y: this.camera.y + Input.pointer.y };
  }

  getCrosshair(now) {
    const base = this.getAimBaseWorld();
    const spread = AimModel.spread(now, this.player.combat.aimStartAt);
    const c = AimModel.crosshairCenter(now, base.x, base.y, spread, this.player.combat.aimSeed1, this.player.combat.aimSeed2);
    return { x: c.x, y: c.y, spread };
  }

  firePlayerShot(now) {
    const c = this.player.combat;
    if (c.hasShot) return;

    c.hasShot = true;
    c.releaseQueued = false;

    c.state = 'shooting';
    c.frame = 0;
    c.frameTime = 0;
    this.flashAlpha = 0.22;

    c.lastActionAt = now;

    const aim = this.getCrosshair(now);
    const off = randomInDisc(aim.spread);
    const aimX = aim.x + off.x;
    const aimY = aim.y + off.y * 0.7;

    const muzzleX = this.player.x + (c.facing > 0 ? 18 : -18);
    const muzzleY = this.player.y - 6;

    const dx = aimX - muzzleX;
    const dy = aimY - muzzleY;
    const dist = Math.hypot(dx, dy) || 1;

    this.bullets.push({
      x: muzzleX, y: muzzleY,
      prevX: muzzleX, prevY: muzzleY,
      vx: (dx / dist) * this.BULLET_SPEED,
      vy: (dy / dist) * this.BULLET_SPEED
    });
  }

  update(dt) {
    this.time += dt;

    this.updateMovement(dt);
    this.updateCombat(dt);
    this.updateBullets(dt);
    this.updateDust(dt);
    this.updateTumbleweeds(dt);
    this.updateCamera();

    if (this.flashAlpha > 0) this.flashAlpha -= dt * 2;

    this.updateUI();
  }

  updateMovement(dt) {
    const up = Input.keys.has('w') || Input.keys.has('arrowup');
    const down = Input.keys.has('s') || Input.keys.has('arrowdown');
    const left = Input.keys.has('a') || Input.keys.has('arrowleft');
    const right = Input.keys.has('d') || Input.keys.has('arrowright');

    let mx = 0, my = 0;
    if (up) my -= 1;
    if (down) my += 1;
    if (left) mx -= 1;
    if (right) mx += 1;

    this.isMoving = (mx !== 0 || my !== 0);
    this.moveX = mx;
    this.moveY = my;

    const c = this.player.combat;
    const combatSlow = (c.state !== 'holstered') ? 0.75 : 1.0;
    const speed = this.player.speed * combatSlow;

    if (this.isMoving) {
      const len = Math.hypot(mx, my) || 1;
      mx /= len; my /= len;

      if (mx < -0.1) this.player.facingX = -1;
      if (mx >  0.1) this.player.facingX =  1;

      // OPTIONAL: keep the 4-way stand orientation when not using gun sprites
      if (Math.abs(mx) > Math.abs(my)) this.player.dir = (mx < 0) ? 1 : 2;
      else this.player.dir = (my < 0) ? 3 : 0;

      const nx = this.player.x + mx * speed * dt;
      const ny = this.player.y + my * speed * dt;

      this.tryMove(nx, ny);
      this.player.walkT += dt;
    }
  }

  tryMove(nx, ny) {
    nx = clamp(nx, this.player.radius, this.worldW - this.player.radius);
    ny = clamp(ny, this.player.radius, this.worldH - this.player.radius);

    let x = nx, y = ny;

    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dy = y - o.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const minD = this.player.radius + o.r;
      if (d < minD) {
        const push = (minD - d);
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
    }

    this.player.x = clamp(x, this.player.radius, this.worldW - this.player.radius);
    this.player.y = clamp(y, this.player.radius, this.worldH - this.player.radius);
  }

  updateCombat(dt) {
    const c = this.player.combat;
    const now = this.time;

    // While gun is out, allow flipping while moving (your request)
    if (c.state !== 'holstered') {
      // if moving left/right, face that way
      if (Math.abs(this.moveX) > 0.1) c.facing = (this.moveX < 0) ? -1 : 1;
      else {
        // otherwise face pointer (feels good with mouse/touch)
        const base = this.getAimBaseWorld();
        c.facing = (base.x < this.player.x) ? -1 : 1;
      }
    }

    // Auto-holster while moving with gun out (long delay, not annoying)
    if (
      c.state === 'aiming' &&
      this.isMoving &&
      !Input.drawHeld &&
      (now - c.lastActionAt) > this.AUTO_HOLSTER_WHILE_MOVING_SEC
    ) {
      // start holster
      c.state = 'holstering';
      c.frameTime = 0;
      c.releaseQueued = false;
      c.aimStartAt = null;
      // start from last draw frame
      c.frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;
      c.lastActionAt = now;
      return;
    }

    if (c.state === 'holstering') {
      const cfg = getCfg('cowboy1_draw-Sheet.png');
      c.frameTime += dt;
      if (c.frameTime > c.drawSpeed) {
        c.frameTime = 0;
        c.frame--;
        if (c.frame <= 0) {
          c.state = 'holstered';
          c.frame = 0;
          c.aimStartAt = null;
          c.releaseQueued = false;
        }
      }
      return;
    }

    if (c.state === 'drawing') {
      if (!Input.drawHeld && !c.releaseQueued) return;

      const cfg = getCfg('cowboy1_draw-Sheet.png');
      c.frameTime += dt;
      if (c.frameTime > c.drawSpeed) {
        c.frameTime = 0;
        c.frame++;
        if (c.frame >= cfg.frames) {
          c.state = 'aiming';
          c.frame = cfg.frames - 1;

          c.aimSeed1 = Math.random() * 10;
          c.aimSeed2 = Math.random() * 10;
          c.aimStartAt = now;
          c.lastActionAt = now;

          if (c.releaseQueued && !c.hasShot) {
            this.firePlayerShot(now);
          }
        }
      }
      return;
    }

    if (c.state === 'aiming') {
      if (Input.drawHeld && !c.hasShot) {
        if (c.aimStartAt == null) c.aimStartAt = now;
        c.lastActionAt = now;
      }
    }

    if (c.state === 'shooting') {
      const cfg = getCfg('cowboy1_ONLYshooting(nodraw)-Sheet.png');
      c.frameTime += dt;
      if (c.frameTime > 0.05) {
        c.frameTime = 0;
        c.frame++;
        if (c.frame >= cfg.frames) {
          c.state = 'aiming';
          c.frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;
          c.hasShot = false;
          c.aimStartAt = null;
          // lastActionAt already set on shot
        }
      }
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prevX = b.x; b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      let hit = false;
      for (const o of this.obstacles) {
        const d = distPointToSegment(o.x, o.y, b.prevX, b.prevY, b.x, b.y);
        if (d <= o.r) { hit = true; break; }
      }
      if (hit) {
        this.bullets.splice(i, 1);
        continue;
      }

      if (b.x < 0 || b.x > this.worldW || b.y < 0 || b.y > this.worldH) {
        this.bullets.splice(i, 1);
      }
    }
  }

  initDust() {
    this.dust.length = 0;
    for (let i = 0; i < 40; i++) {
      this.dust.push({
        x: rand(0, canvas.width),
        y: rand(0, canvas.height),
        size: 1 + Math.random() * 2,
        speed: 8 + Math.random() * 18,
        alpha: 0.08 + Math.random() * 0.18
      });
    }
  }

  updateDust(dt) {
    for (const p of this.dust) {
      p.x += p.speed * dt;
      if (p.x > canvas.width + 10) {
        p.x = -10;
        p.y = rand(0, canvas.height);
      }
    }
  }

  updateTumbleweeds(dt) {
    if (this.tumbleweeds.length < 1 && Math.random() < 0.0015) {
      const fromLeft = Math.random() < 0.5;
      this.tumbleweeds.push({
        x: fromLeft ? -20 : canvas.width + 20,
        y: 200 + Math.random() * 220,
        vx: fromLeft ? 30 + Math.random() * 30 : -(30 + Math.random() * 30),
        rotation: 0,
        size: 7 + Math.random() * 6
      });
    }

    for (let i = this.tumbleweeds.length - 1; i >= 0; i--) {
      const t = this.tumbleweeds[i];
      t.x += t.vx * dt;
      t.rotation += t.vx * 0.04 * dt;
      if (t.x < -30 || t.x > canvas.width + 30) this.tumbleweeds.splice(i, 1);
    }
  }

  updateCamera() {
    this.camera.x = clamp(this.player.x - canvas.width / 2, 0, this.worldW - canvas.width);
    this.camera.y = clamp(this.player.y - canvas.height / 2, 0, this.worldH - canvas.height);
  }

  updateUI() {
    statusEl.textContent = 'Overworld';
    roundEl.textContent = 'Explore • TAB scene';

    const c = this.player.combat;

    if (c.state === 'aiming' && !c.hasShot) {
      const spread = AimModel.spread(this.time, c.aimStartAt);
      const steadiness = 1 - clamp((spread - AimModel.spreadMin) / (AimModel.spreadStart - AimModel.spreadMin), 0, 1);
      const pct = Math.round(steadiness * 100);

      subStatusEl.textContent = Flags.debug
        ? `Spread ${spread.toFixed(1)}px • Steady ${pct}% • Facing ${c.facing > 0 ? '→' : '←'} • Q holster`
        : `Steadiness ${pct}% • Release to shoot • Q holster`;
    } else if (c.state === 'drawing') {
      subStatusEl.textContent = c.releaseQueued ? 'Quick shot queued…' : 'Drawing…';
    } else if (c.state === 'holstering') {
      subStatusEl.textContent = 'Holstering…';
    } else {
      subStatusEl.textContent = 'WASD move • Hold/release to shoot';
    }
  }

  makeGroundTile() {
    const c = this.groundTile.getContext('2d');
    c.fillStyle = '#C9A86C';
    c.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 12; i++) {
      c.fillStyle = `rgba(100, 80, 50, ${0.08 + Math.random() * 0.10})`;
      c.beginPath();
      c.ellipse(rand(0, 256), rand(0, 256), rand(15, 40), rand(6, 18), rand(0, Math.PI), 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = '#b89a5a';
    for (let i = 0; i < 220; i++) c.fillRect(randInt(0, 255), randInt(0, 255), 2, 1);
    c.fillStyle = '#d4b87a';
    for (let i = 0; i < 140; i++) c.fillRect(randInt(0, 255), randInt(0, 255), 1, 1);
  }

  generateWorld() {
    const addTree = (x, y) => {
      this.obstacles.push({
        x, y,
        r: 18 + Math.random() * 6,
        kind: 'tree',
        type: randInt(0, 14),
        scale: 0.8 + Math.random() * 0.35
      });
    };
    const addCactus = (x, y) => {
      this.obstacles.push({
        x, y,
        r: 12 + Math.random() * 4,
        kind: 'cactus',
        scale: 0.8 + Math.random() * 0.6
      });
    };

    const clearR = 120;

    for (let i = 0; i < 70; i++) {
      const x = rand(80, this.worldW - 80);
      const y = rand(80, this.worldH - 80);
      const d = Math.hypot(x - this.duelSpot.x, y - this.duelSpot.y);
      if (d < clearR) continue;

      if (Math.random() < 0.55) addCactus(x, y);
      else addTree(x, y);
    }

    for (let i = 0; i < 12; i++) addTree(240 + rand(-120, 120), 240 + rand(-120, 120));
  }

  draw() {
    ctx.save();

    // tile sand
    ctx.fillStyle = '#C9A86C';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ox = -(this.camera.x % 256);
    const oy = -(this.camera.y % 256);
    for (let y = oy - 256; y < canvas.height + 256; y += 256) {
      for (let x = ox - 256; x < canvas.width + 256; x += 256) {
        ctx.drawImage(this.groundTile, x, y);
      }
    }

    // duel spot ring
    const dsx = this.duelSpot.x - this.camera.x;
    const dsy = this.duelSpot.y - this.camera.y;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(255, 230, 180, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dsx, dsy, this.duelSpot.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // obstacles sorted by y
    const obs = [...this.obstacles].sort((a, b) => a.y - b.y);
    for (const o of obs) this.drawObstacle(o);

    // bullets
    for (const b of this.bullets) {
      const sx = b.x - this.camera.x;
      const sy = b.y - this.camera.y;

      ctx.fillStyle = 'rgba(255,200,50,0.35)';
      ctx.beginPath();
      ctx.arc(sx - b.vx * this.BULLET_TRAIL, sy - b.vy * this.BULLET_TRAIL, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffdd44';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // dust (screen)
    for (const p of this.dust) {
      ctx.fillStyle = `rgba(210, 190, 150, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // player
    this.drawPlayer();

    // tumbleweed
    for (const t of this.tumbleweeds) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.fillStyle = '#8B7355';
      ctx.beginPath();
      ctx.arc(0, 0, t.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // flash
    if (this.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 240, 200, ${this.flashAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // crosshair while aiming
    const c = this.player.combat;
    if (c.state === 'aiming' && !c.hasShot) {
      const aim = this.getCrosshair(this.time);
      const sx = aim.x - this.camera.x;
      const sy = aim.y - this.camera.y;
      this.drawCrosshair(sx, sy, aim.spread);
    }

    ctx.restore();

    // vignette
    const vignetteGrad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 150, canvas.width / 2, canvas.height / 2, 420);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawCrosshair(x, y, spread) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 235, 190, 0.40)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, spread, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 245, 220, 0.95)';
    ctx.lineWidth = 1;
    const size = 10;
    ctx.beginPath();
    ctx.moveTo(x - size, y); ctx.lineTo(x - 2, y);
    ctx.moveTo(x + 2, y); ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size); ctx.lineTo(x, y - 2);
    ctx.moveTo(x, y + 2); ctx.lineTo(x, y + size);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 220, 140, 0.85)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.restore();
  }

  drawObstacle(o) {
    const sx = o.x - this.camera.x;
    const sy = o.y - this.camera.y;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 10, o.r * 0.9, o.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    if (o.kind === 'tree' && spriteOk('trees1-Sheet.png')) {
      const cfg = getCfg('trees1-Sheet.png', 64, 80);
      const s = o.scale;

      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(
        sprites['trees1-Sheet.png'],
        (o.type % cfg.frames) * cfg.fw, 0,
        cfg.fw, cfg.fh,
        sx - (cfg.fw * s) / 2,
        sy - (cfg.fh * s) + 20,
        cfg.fw * s, cfg.fh * s
      );
      ctx.restore();
      return;
    }

    // cactus fallback
    ctx.fillStyle = '#5a7a4a';
    ctx.fillRect(sx - 3, sy - 18, 6, 18);
    ctx.fillRect(sx - 10, sy - 13, 7, 4);
    ctx.fillRect(sx - 10, sy - 13, 4, -8);
    ctx.fillRect(sx + 3, sy - 10, 7, 4);
    ctx.fillRect(sx + 7, sy - 10, 4, -6);

    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(sx - 1, sy - 18, 2, 18);
  }

  drawPlayer() {
    const px = this.player.x - this.camera.x;
    const py = this.player.y - this.camera.y;
    const scale = 3;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(px, py + 14, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const c = this.player.combat;

    if (c.state !== 'holstered') {
      if (c.state === 'holstering') {
        drawSpriteFrame(ctx, 'cowboy1_draw-Sheet.png', c.frame, px, py, c.facing * scale, scale, 1);
        return;
      }

      let name = 'cowboy1_draw-Sheet.png';
      if (c.state === 'shooting') name = 'cowboy1_ONLYshooting(nodraw)-Sheet.png';

      const cfg = getCfg(name);
      let frame = 0;
      if (c.state === 'aiming') frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;
      else frame = clamp(c.frame, 0, cfg.frames - 1);

      drawSpriteFrame(ctx, name, frame, px, py, c.facing * scale, scale, 1);
      return;
    }

    const walkName = 'cowboy1_walk.png';
    const standName = 'cowboy1_rotate_all_standing.png';

    const moving = this.isMoving;

    if (moving && spriteOk(walkName)) {
      const cfg = getCfg(walkName);
      const fps = 10;
      const frame = Math.floor(this.player.walkT * fps) % Math.max(1, cfg.frames);

      // flip on x axis only for walking
      drawSpriteFrame(ctx, walkName, frame, px, py, this.player.facingX * scale, scale, 1);
      return;
    }

    if (spriteOk(standName)) {
      const cfg = getCfg(standName);
      const frame = clamp(this.player.dir, 0, cfg.frames - 1);
      drawSpriteFrame(ctx, standName, frame, px, py, scale, scale, 1);
      return;
    }

    drawSpriteFrame(ctx, 'cowboy1_draw-Sheet.png', getCfg('cowboy1_draw-Sheet.png').frames - 1, px, py, scale, scale, 1);
  }
}
