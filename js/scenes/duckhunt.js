import { AimModel } from '../core/aim.js';
import { Flags, Input, canvas, ctx, statusEl, subStatusEl, roundEl } from '../core/state.js';
import { clamp, lerp, rand, randomInDisc } from '../core/utils.js';
import { getCfg, spriteOk, sprites } from '../core/sprites.js';
import { hideMessage } from '../ui/message.js';

export class DuckHuntScene {
  constructor() {
    this.time = 0;

    // gun feel
    this.aiming = false;
    this.aimStartAt = null;
    this.aimSeed1 = Math.random() * 10;
    this.aimSeed2 = Math.random() * 10;

    this.recoil = 0;
    this.flashAlpha = 0;
    this.tracer = null; // {t, x1,y1,x2,y2}

    // scoring
    this.round = 1;
    this.hits = 0;
    this.misses = 0;
    this.escapes = 0;
    this.streak = 0;
    this.bestStreak = 0;

    // ammo (classic-ish)
    this.magSize = 3;
    this.shells = this.magSize;
    this.reloadT = 0;

    // ducks
    this.ducks = [];
    this.pendingSpawns = 0;
    this.spawnGapT = 0;

    // tuning
    this.hitRadius = 18;
    this.waveEscapeMin = 2.2;
    this.waveEscapeMax = 4.0;

    this.speedMin = 80;
    this.speedMax = 165;

    // background tint fallback
    this.sky = null;
  }

  onEnter() { this.reset(); }
  onExit() {}

  newMatch() { this.reset(); }
  reset() {
    this.time = 0;

    this.aiming = false;
    this.aimStartAt = null;
    this.recoil = 0;
    this.flashAlpha = 0;
    this.tracer = null;

    this.round = 1;
    this.hits = 0;
    this.misses = 0;
    this.escapes = 0;
    this.streak = 0;
    this.bestStreak = 0;

    this.shells = this.magSize;
    this.reloadT = 0;

    this.ducks.length = 0;
    this.pendingSpawns = 0;
    this.spawnGapT = 0;

    hideMessage();
    this.startWave();
  }

  startWave() {
    // 1–2 ducks per wave (feels more like Duck Hunt)
    this.pendingSpawns = (Math.random() < 0.45) ? 1 : 2;
    this.spawnGapT = 0;
  }

  onHolsterToggle() {
    // cancel aim, no shot
    this.aiming = false;
    this.aimStartAt = null;
  }

  onDrawPress() {
    if (this.reloadT > 0) return;
    this.aiming = true;
    this.aimStartAt = this.time;
    this.aimSeed1 = Math.random() * 10;
    this.aimSeed2 = Math.random() * 10;
  }

  onDrawRelease() {
    if (Input.suppressNextRelease) {
      Input.suppressNextRelease = false;
      return;
    }

    if (!this.aiming) return;

    // always end aim on release (keeps metaphor consistent)
    this.aiming = false;

    if (this.reloadT > 0 || this.shells <= 0) {
      // empty click
      this.aimStartAt = null;
      this.streak = 0;
      return;
    }

    this.shells--;
    const now = this.time;

    const shot = this.getShotPoint(now);

    // tracer from "barrel" to shot
    const muzzle = this.getMuzzleScreen();
    this.tracer = { t: 0.07, x1: muzzle.x, y1: muzzle.y, x2: shot.x, y2: shot.y };

    // resolve hit (hitscan)
    const hitIdx = this.findDuckHit(shot.x, shot.y);
    if (hitIdx >= 0) {
      const d = this.ducks[hitIdx];
      if (d.state === 'fly' || d.state === 'turn') {
        d.state = 'hit';
        d.hitT = 0;
        d.vx *= 0.3;
        d.vy = 40;
        this.hits++;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
      }
    } else {
      this.misses++;
      this.streak = 0;
    }

    // recoil + flash
    this.recoil = 1.0;
    this.flashAlpha = 0.22;

    // reload behavior
    if (this.shells <= 0) {
      this.reloadT = 0.95;
    }

    this.aimStartAt = null;
  }

  getCrosshair(now) {
    const baseX = Input.pointer.x;
    const baseY = Input.pointer.y;

    // A little slower stabilization here feels more “duck hunt”
    const spread = AimModel.spread(now, this.aimStartAt);
    const c = AimModel.crosshairCenter(now, baseX, baseY, spread, this.aimSeed1, this.aimSeed2);
    return { x: c.x, y: c.y, spread };
  }

  getShotPoint(now) {
    const aim = this.getCrosshair(now);
    const off = randomInDisc(aim.spread);
    return { x: aim.x + off.x, y: aim.y + off.y * 0.7 };
  }

  findDuckHit(x, y) {
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      if (d.state === 'gone') continue;
      if (d.state === 'escape') continue;
      const dx = x - d.x;
      const dy = y - d.y;
      if (Math.hypot(dx, dy) <= this.hitRadius) return i;
    }
    return -1;
  }

  spawnDuck() {
    const fromLeft = Math.random() < 0.5;

    const x = fromLeft ? -40 : (canvas.width + 40);
    const y = rand(110, 260);

    const speed = rand(this.speedMin, this.speedMax) + Math.min(this.round * 6, 70);
    const angle = fromLeft ? rand(-0.25, 0.25) : Math.PI + rand(-0.25, 0.25);

    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed * 0.65;

    this.ducks.push({
      x, y,
      vx, vy,
      speed,
      facing: (vx >= 0) ? 1 : -1,

      // steering
      turnT: rand(0.20, 0.70),
      targetAngle: angle,
      turnAnim: 0, // uses rotate sheet briefly on direction change

      // lifespan
      age: 0,
      escapeAfter: rand(this.waveEscapeMin, this.waveEscapeMax),

      // animation
      frame: 0,
      frameT: 0,

      // hit/fall
      state: 'fly', // fly | turn | hit | fall | escape | gone
      hitT: 0
    });
  }

  updateDuckSteering(d, dt) {
    d.turnT -= dt;
    if (d.turnT <= 0) {
      d.turnT = rand(0.18, 0.75);

      // pick a new target angle that tends to stay on-screen
      const margin = 70;
      let biasX = 0;
      let biasY = 0;
      if (d.x < margin) biasX += 0.9;
      if (d.x > canvas.width - margin) biasX -= 0.9;
      if (d.y < 90) biasY += 0.65;
      if (d.y > 280) biasY -= 0.65;

      // base random turn
      const turn = rand(-0.9, 0.9);

      // combine into a new direction
      const curAng = Math.atan2(d.vy, d.vx);
      let nextAng = curAng + turn * 0.55;
      nextAng += biasX * 0.40;
      nextAng += biasY * 0.25;

      // clamp to avoid straight-down nonsense
      nextAng = clamp(nextAng, -2.6, 2.6);

      d.targetAngle = nextAng;
    }

    // steer toward targetAngle
    const tx = Math.cos(d.targetAngle) * d.speed;
    const ty = Math.sin(d.targetAngle) * d.speed * 0.65;

    const steer = 3.2; // responsiveness
    const oldFacing = d.facing;

    d.vx = lerp(d.vx, tx, clamp(dt * steer, 0, 1));
    d.vy = lerp(d.vy, ty, clamp(dt * steer, 0, 1));

    d.facing = (d.vx >= 0) ? 1 : -1;

    // if direction flips, play turn animation
    if (d.facing !== oldFacing) {
      d.turnAnim = 0.22;
      d.state = 'turn';
    }
  }

  update(dt) {
    this.time += dt;

    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.shells = this.magSize;
      }
    }

    // spawn logic: only spawn new wave when no ducks remain
    if (this.ducks.length === 0 && this.pendingSpawns === 0) {
      this.round++;
      this.startWave();
    }

    // spawn queued ducks
    if (this.pendingSpawns > 0) {
      this.spawnGapT -= dt;
      if (this.spawnGapT <= 0) {
        this.spawnDuck();
        this.pendingSpawns--;
        this.spawnGapT = 0.35;
      }
    }

    const flyCfg = getCfg('duck1_fly-Sheet.png');
    const rotCfg = getCfg('duck1_rotate-Sheet.png');
    const shotCfg = getCfg('duck1shot-Sheet.png');

    for (const d of this.ducks) {
      if (d.state === 'gone') continue;

      d.age += dt;
      d.frameT += dt;

      // escape if time runs out
      if ((d.state === 'fly' || d.state === 'turn') && d.age > d.escapeAfter) {
        d.state = 'escape';
        d.vy = -240;
        d.vx *= 0.35;
        this.escapes++;
        this.streak = 0;
      }

      if (d.state === 'fly' || d.state === 'turn') {
        // animation
        if (d.frameT > 0.08) {
          d.frameT = 0;
          d.frame = (d.frame + 1) % Math.max(1, flyCfg.frames);
        }

        // steering updates
        this.updateDuckSteering(d, dt);

        // motion
        d.x += d.vx * dt;
        d.y += d.vy * dt;

        // keep inside bounds by soft bounce
        const pad = 30;
        if (d.x < -60) d.x = -60;
        if (d.x > canvas.width + 60) d.x = canvas.width + 60;
        if (d.y < 70) d.y = 70;
        if (d.y > 320) d.y = 320;

        // turn anim decays
        if (d.turnAnim > 0) {
          d.turnAnim -= dt;
          if (d.turnAnim <= 0 && d.state === 'turn') d.state = 'fly';
        }
      }

      if (d.state === 'hit') {
        d.hitT += dt;

        if (d.frameT > 0.08) {
          d.frameT = 0;
          d.frame = (d.frame + 1) % Math.max(1, shotCfg.frames);
        }

        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy += 180 * dt;

        if (d.hitT > 0.18) d.state = 'fall';
      }

      if (d.state === 'fall') {
        if (d.frameT > 0.08) {
          d.frameT = 0;
          d.frame = (d.frame + 1) % Math.max(1, rotCfg.frames);
        }

        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy += 260 * dt;

        if (d.y > canvas.height + 60) d.state = 'gone';
      }

      if (d.state === 'escape') {
        // fly up and out
        if (d.frameT > 0.08) {
          d.frameT = 0;
          d.frame = (d.frame + 1) % Math.max(1, flyCfg.frames);
        }

        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -60) d.state = 'gone';
      }
    }

    // cleanup
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      if (this.ducks[i].state === 'gone') this.ducks.splice(i, 1);
    }

    // fx
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 6.0);
    if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);
    if (this.tracer) {
      this.tracer.t -= dt;
      if (this.tracer.t <= 0) this.tracer = null;
    }

    this.updateUI();
  }

  updateUI() {
    statusEl.textContent = 'Duck Hunt';
    roundEl.textContent = `Round ${this.round} • Hits ${this.hits} • Miss ${this.misses} • Esc ${this.escapes}`;
    const shells = '●'.repeat(this.shells) + '○'.repeat(this.magSize - this.shells);

    if (this.reloadT > 0) {
      subStatusEl.textContent = `Reloading… ${shells}`;
      return;
    }

    if (this.aiming) {
      const aim = this.getCrosshair(this.time);
      const chance = AimModel.approxHitChance(this.hitRadius, aim.spread);
      subStatusEl.textContent = Flags.debug
        ? `Spread ${aim.spread.toFixed(1)}px • ~Center hit ${Math.round(chance * 100)}% • Shells ${shells} • Q cancel`
        : `Shells ${shells} • Release to shoot • Q cancel`;
    } else {
      subStatusEl.textContent = `Shells ${shells} • Hold to steady, release to shoot.`;
    }
  }

  getMuzzleScreen() {
    // “barrel” origin for tracer/flash
    return { x: canvas.width / 2, y: canvas.height - 62 };
  }

  drawFirstPersonGunOverlay() {
    // very simple barrel + sight so it reads as “first person”
    const bob = Math.sin(this.time * 6.0) * 1.2;
    const recoilY = this.recoil * 10;

    const baseX = canvas.width / 2;
    const baseY = canvas.height - 40 + bob + recoilY;

    // barrel
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(20,20,20,0.85)';
    ctx.beginPath();
    ctx.roundRect(baseX - 26, baseY - 70, 52, 90, 8);
    ctx.fill();

    // top highlight
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(baseX - 18, baseY - 66, 6, 80);

    // front sight
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(30,30,30,0.9)';
    ctx.fillRect(baseX - 3, baseY - 88, 6, 18);

    ctx.restore();

    // muzzle flash
    if (this.flashAlpha > 0) {
      const m = this.getMuzzleScreen();
      ctx.save();
      ctx.globalAlpha = this.flashAlpha;
      ctx.fillStyle = 'rgba(255, 240, 200, 0.9)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawReticle() {
    const now = this.time;
    const aim = this.getCrosshair(now);

    // Always show a reticle so it’s clear you’re targeting
    const x = aim.x;
    const y = aim.y;

    // When aiming, also show spread ring
    if (this.aiming) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 235, 190, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, aim.spread, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
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

  draw() {
    ctx.save();

    // background
    if (spriteOk('bestbackground_west1.png')) {
      const img = sprites['bestbackground_west1.png'];
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, '#6fb6d9');
      sky.addColorStop(0.55, '#cfe9f5');
      sky.addColorStop(0.56, '#caa56e');
      sky.addColorStop(1, '#b89056');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ducks
    for (const d of this.ducks) {
      if (d.state === 'gone') continue;

      let sprite = 'duck1_fly-Sheet.png';
      if (d.state === 'hit') sprite = 'duck1shot-Sheet.png';
      if (d.state === 'fall') sprite = spriteOk('duck1_rotate-Sheet.png') ? 'duck1_rotate-Sheet.png' : 'duck1shot-Sheet.png';
      if (d.state === 'turn' && spriteOk('duck1_rotate-Sheet.png')) sprite = 'duck1_rotate-Sheet.png';

      const cfg = getCfg(sprite);
      const frame = clamp(d.frame, 0, cfg.frames - 1);

      ctx.save();
      ctx.translate(d.x, d.y);

      // duck facing: flip on vx sign
      ctx.scale(d.facing * 2.4, 2.4);
      ctx.drawImage(
        sprites[sprite],
        frame * cfg.fw, 0,
        cfg.fw, cfg.fh,
        -cfg.fw / 2, -cfg.fh / 2,
        cfg.fw, cfg.fh
      );
      ctx.restore();

      if (Flags.debug) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = 'rgba(255, 120, 120, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, this.hitRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // tracer
    if (this.tracer) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(255, 245, 220, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.tracer.x1, this.tracer.y1);
      ctx.lineTo(this.tracer.x2, this.tracer.y2);
      ctx.stroke();
      ctx.restore();
    }

    // reticle
    this.drawReticle();

    // duck logo (optional)
    if (spriteOk('ducklogo1.png')) {
      const img = sprites['ducklogo1.png'];
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.drawImage(img, 10, 90, 90, 60);
      ctx.restore();
    }

    // gun overlay
    this.drawFirstPersonGunOverlay();

    ctx.restore();

    // vignette
    const vignetteGrad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 150, canvas.width / 2, canvas.height / 2, 420);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}
