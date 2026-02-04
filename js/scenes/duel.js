import { AimModel } from '../core/aim.js';
import { Flags, MatchSettings, Input, canvas, ctx, scoreEl, firstToEl, tensionFill, tensionBar, enemyTypeEl, btnMatch, statusEl, subStatusEl, roundEl } from '../core/state.js';
import { clamp, lerp, ms, rand, randInt, sign, distPointToSegment, randomInDisc } from '../core/utils.js';
import { drawSpriteFrame, getCfg, spriteOk, sprites } from '../core/sprites.js';
import { showMessage, hideMessage } from '../ui/message.js';
import { matchLabel } from '../ui/controls.js';

export class DuelScene {
  constructor() {
    this.GO_MIN = 1.5;
    this.GO_MAX = 3.8;

    this.BULLET_SPEED = 900;
    this.BULLET_TRAIL = 0.016;

    this.HIT_RADIUS = 16;

    this.GO_BANNER_TIME = 0.70;
    this.TIE_EPS = 0.045;

    this.shakeAmount = 0;
    this.shakeDuration = 0;
    this.flashAlpha = 0;

    this.playerScore = 0;
    this.enemyScore = 0;

    this.bullets = [];
    this.blood = [];
    this.dust = [];
    this.tumbleweeds = [];

    this.trees = [];
    this.mesas = [];
    this.groundPatches = [];

    // ---- IMPORTANT: baseFacing defines how the ART is drawn by default.
    // +1 means the sprite sheet is drawn facing RIGHT.
    // -1 means the sprite sheet is drawn facing LEFT.
    this.PLAYER_BASE_FACING = +1; // your cowboy1 art faces right

    // Per-skin override memory (press F)
    this.enemyFacingOverrides = {}; // skinId -> +1/-1 multiplier

    this.personalities = [
      // lowered accuracy a bit so it doesn’t feel like lasers
      { name:'Nervous',   reactionMin:0.16, reactionMax:0.46, drawSpeed:0.055, aimMin:0.10, aimMax:0.30, accuracy:0.50, falseStartChance:0.030, flinchChance:0.25 },
      { name:'Steady',    reactionMin:0.18, reactionMax:0.46, drawSpeed:0.050, aimMin:0.14, aimMax:0.36, accuracy:0.62, falseStartChance:0.010, flinchChance:0.08 },
      { name:'Veteran',   reactionMin:0.10, reactionMax:0.30, drawSpeed:0.045, aimMin:0.22, aimMax:0.50, accuracy:0.78, falseStartChance:0.000, flinchChance:0.00 },
      { name:'Quickdraw', reactionMin:0.06, reactionMax:0.20, drawSpeed:0.040, aimMin:0.06, aimMax:0.18, accuracy:0.66, falseStartChance:0.012, flinchChance:0.02 },
      { name:'Wild',      reactionMin:0.00, reactionMax:0.36, drawSpeed:0.050, aimMin:0.00, aimMax:0.16, accuracy:0.45, falseStartChance:0.080, flinchChance:0.12 },
    ];
    this.currentPersonality = this.personalities[0];

    this.enemySkin = null;

    this.player = this.makePlayer();
    this.enemy = this.makeEnemy();

    this.round = {
      state: 'standoff',
      startPerf: 0,
      time: 0,
      goTime: 0,
      goFired: false,
      goAt: 0,
      goBannerUntil: 0,
      result: null,
      reason: ''
    };
  }

  makePlayer() {
    return {
      x: 170, y: 320,
      state: 'idle', // idle | drawing | aiming | shooting | holstering | dead
      frame: 0, frameTime: 0,
      drawSpeed: 0.030,
      health: 100,
      hasShot: false,
      releaseQueued: false,
      aimStartAt: null,
      aimSeed1: Math.random() * 10,
      aimSeed2: Math.random() * 10,
      metrics: { drewAt: null, drawnAt: null, shotAt: null },
      deadAt: null,
      hitFlash: 0
    };
  }

  makeEnemy() {
    return {
      x: 470, y: 320,
      state: 'idle',
      frame: 0, frameTime: 0,
      drawSpeed: 0.05,
      health: 100,
      hasShot: false,
      aimStartAt: null,
      metrics: { drewAt: null, drawnAt: null, shotAt: null },
      deadAt: null,
      hitFlash: 0,
      ai: {
        drawAt: null,
        fireAt: null,
        plannedAimDelay: 0,
        flinchUntil: 0,
        flinched: false
      }
    };
  }

  onEnter() {
    this.generateEnvironment();
    this.initDust();
    this.reset(true);
  }
  onExit() {}

  onFlipEnemyFacing() {
    if (!this.enemySkin) return;
    const id = this.enemySkin.id;
    const cur = this.enemyFacingOverrides[id] ?? 1;
    this.enemyFacingOverrides[id] = -cur;

    // tiny feedback
    if (Flags.debug) {
      showMessage(`Enemy facing flipped for <b>${this.enemySkin.label}</b><br><small>(press R to continue)</small>`);
      setTimeout(() => { if (this.round.state !== 'over') hideMessage(); }, 600);
    }
  }

  onMatchChanged() {
    this.updateScoreUI();
  }

  roundNowSeconds() {
    return (performance.now() - this.round.startPerf) / 1000;
  }

  matchTarget() {
    return MatchSettings.targets[MatchSettings.idx];
  }

  isMatchOver() {
    const t = this.matchTarget();
    if (t === Infinity) return false;
    return (this.playerScore >= t || this.enemyScore >= t);
  }

  availableEnemySkins() {
    const skins = [];

    // cowboy2
    if (spriteOk('cowboy2_draw-Sheet.png') && spriteOk('cowboy2_shootOnly-Sheet.png') && spriteOk('cowboy2_death-Sheet.png')) {
      skins.push({
        id: 'cowboy2',
        label: 'Black Hat',
        baseFacing: -1, // IMPORTANT: cowboy2 art faces LEFT by default (per your pipeline)
        draw: 'cowboy2_draw-Sheet.png',
        shoot: 'cowboy2_shootOnly-Sheet.png',
        death: 'cowboy2_death-Sheet.png'
      });
    }

    // cowboy3 (optional) — baseFacing unknown; default -1 but press F if needed
    const c3DrawCandidates = ['cowboy3_draw-Sheet.png', 'cowboy3_drawonly.png', 'cowboy3_rotate-Sheet.png'];
    const c3Draw = c3DrawCandidates.find(spriteOk);
    if (c3Draw && spriteOk('cowboy3_fire-Sheet.png') && spriteOk('cowboy3_death-Sheet.png')) {
      skins.push({
        id: 'cowboy3',
        label: 'Outlaw',
        baseFacing: +1,
        shootFrameOffset: -1,
        shootOffsetY: 16,
        draw: c3Draw,
        shoot: 'cowboy3_fire-Sheet.png',
        death: 'cowboy3_death-Sheet.png'
      });
    }

    if (skins.length === 0) {
      skins.push({
        id: 'cowboy2',
        label: 'Black Hat',
        baseFacing: -1,
        draw: 'cowboy2_draw-Sheet.png',
        shoot: 'cowboy2_shootOnly-Sheet.png',
        death: 'cowboy2_death-Sheet.png'
      });
    }

    return skins;
  }

  pickPersonality() {
    let pool = [...this.personalities];
    const rounds = this.playerScore + this.enemyScore;
    const ramp = Math.min(rounds * 0.008, 0.10);

    if (this.playerScore > this.enemyScore) pool = pool.concat(this.personalities.slice(2));

    const base = pool[randInt(0, pool.length - 1)];
    return {
      ...base,
      reactionMin: Math.max(0, base.reactionMin - ramp),
      reactionMax: Math.max(base.reactionMin, base.reactionMax - ramp),
      accuracy: clamp(base.accuracy + ramp * 0.5, 0.10, 0.92)
    };
  }

  newMatch() {
    this.playerScore = 0;
    this.enemyScore = 0;
    this.reset(true);
  }

  reset(isNewMatch = false) {
    if (!isNewMatch && this.isMatchOver()) return;

    this.currentPersonality = this.pickPersonality();

    // choose enemy skin per round
    const skins = this.availableEnemySkins();
    this.enemySkin = skins[randInt(0, skins.length - 1)];

    this.round.state = 'standoff';
    this.round.startPerf = performance.now();
    this.round.time = 0;
    this.round.goTime = rand(this.GO_MIN, this.GO_MAX);
    this.round.goFired = false;
      this.round.goAt = 0;
      this.round.goBannerUntil = 0;
      this.round.result = null;
      this.round.reason = '';
      this.round.message = '';
      this.round.messageShown = false;
      this.round.messageAt = 0;
      this.round.endedAt = 0;

    this.bullets.length = 0;
    this.blood.length = 0;
    this.tumbleweeds.length = 0;

    this.shakeAmount = 0;
    this.shakeDuration = 0;
    this.flashAlpha = 0;

    this.player = this.makePlayer();
    this.enemy = this.makeEnemy();
    this.enemy.drawSpeed = this.currentPersonality.drawSpeed;

    tensionFill.style.width = '0%';
    tensionBar.classList.remove('visible');
    enemyTypeEl.classList.remove('visible');
    hideMessage();

    // practice: instantly enter duel
    if (Flags.practice) {
      const now = this.roundNowSeconds();
      this.forceGoNow(now);
    }

    this.updateScoreUI();
  }

  forceGoNow(now) {
    this.round.goFired = true;
    this.round.state = 'duel';
    this.round.goAt = now;
    this.round.goTime = now;
    this.round.goBannerUntil = 0;
    tensionBar.classList.remove('visible');

    enemyTypeEl.textContent = `${this.enemySkin.label} • ${this.currentPersonality.name}${Flags.practice ? ' (practice)' : ''}`;
    enemyTypeEl.classList.add('visible');

    if (Flags.enemyAI) this.scheduleEnemyFromGo(now);
    else {
      this.enemy.ai.drawAt = null;
      this.enemy.ai.fireAt = null;
    }
  }

  scheduleEnemyFromGo(now) {
    const p = this.currentPersonality;
    let reactionDelay = rand(p.reactionMin, p.reactionMax);

    this.enemy.ai.flinched = false;
    this.enemy.ai.flinchUntil = 0;

    if (Math.random() < p.flinchChance) {
      this.enemy.ai.flinched = true;
      const extra = rand(0.10, 0.26);
      this.enemy.ai.flinchUntil = now + rand(0.20, 0.45);
      reactionDelay += extra;
    }

    this.enemy.ai.drawAt = this.round.goAt + reactionDelay;
    this.enemy.ai.fireAt = null;
    this.enemy.ai.plannedAimDelay = 0;
  }

  enemyShootFrameLimit(cfg) {
    const offset = this.enemySkin?.shootFrameOffset ?? 0;
    return Math.max(1, cfg.frames + offset);
  }

  // ---------------------------------------------------------
  // Facing helpers (THIS fixes your duel flip problem)
  // ---------------------------------------------------------
  desiredFacingToward(a, b) {
    // face toward target b
    return sign(b.x - a.x);
  }

  enemyScaleX(desiredFacing) {
    const base = this.enemySkin?.baseFacing ?? -1;
    const override = this.enemyFacingOverrides[this.enemySkin?.id] ?? 1;
    return desiredFacing * base * override;
  }

  playerScaleX(desiredFacing) {
    return desiredFacing * this.PLAYER_BASE_FACING;
  }

  muzzleOffsetX(desiredFacing) {
    return desiredFacing * 25;
  }

  // --------------------
  // Input hooks
  // --------------------
  onDrawPress() {
    if (this.round.state === 'over') return;
    if (this.isMatchOver()) return;

    const now = this.roundNowSeconds();

    if (Flags.practice && this.round.state !== 'duel') {
      this.forceGoNow(now);
    }

    if (!Flags.practice && !this.round.goFired && now >= this.round.goTime) {
      this.triggerGo(now);
    }

    // False start
    if (!Flags.practice && !this.round.goFired && this.round.state === 'standoff') {
      this.endRound('lost', 'FALSE START', now);
      return;
    }

    if (this.round.state !== 'duel') return;

    if (this.player.state === 'idle') {
      this.startPlayerDraw(now);
      return;
    }

    if (this.player.state === 'aiming' && !this.player.hasShot) {
      if (this.player.aimStartAt == null) this.player.aimStartAt = now;
    }
  }

  onDrawRelease() {
    if (Input.suppressNextRelease) {
      Input.suppressNextRelease = false;
      return;
    }

    if (this.round.state !== 'duel') return;
    if (this.round.state === 'over') return;

    const now = this.roundNowSeconds();

    if (this.player.state === 'drawing' && !this.player.hasShot) {
      this.player.releaseQueued = true;
      return;
    }

    if (this.player.state === 'aiming' && !this.player.hasShot && this.player.health > 0 && this.enemy.health > 0) {
      this.firePlayerShot(now, 'release');
    }
  }

  onHolsterToggle() {
    if (this.player.state === 'dead' || this.player.state === 'shooting') return;

    const drawCfg = getCfg('cowboy1_draw-Sheet.png');

    if (this.player.state === 'aiming') {
      this.player.state = 'holstering';
      this.player.frame = drawCfg.frames - 1;
      this.player.frameTime = 0;
      this.player.releaseQueued = false;
      this.player.aimStartAt = null;
      return;
    }

    if (this.player.state === 'drawing') {
      this.player.state = 'holstering';
      this.player.frameTime = 0;
      this.player.releaseQueued = false;
      this.player.aimStartAt = null;
      return;
    }
  }

  // --------------------
  // Round flow
  // --------------------
  triggerGo(now) {
    if (this.round.goFired) return;

    this.round.goFired = true;
    this.round.state = 'duel';
    this.round.goAt = this.round.goTime;
    this.round.goBannerUntil = now + this.GO_BANNER_TIME;

    enemyTypeEl.textContent = `${this.enemySkin.label} • ${this.currentPersonality.name}`;
    enemyTypeEl.classList.add('visible');

    tensionBar.classList.remove('visible');

    if (Flags.enemyAI) this.scheduleEnemyFromGo(now);
  }

  endRound(result, reason, now = this.roundNowSeconds()) {
    if (Flags.practice) return;
    if (this.round.state === 'over') return;

    this.round.state = 'over';
    this.round.result = result;
    this.round.reason = reason;
    this.round.endedAt = now;

    if (result === 'won') this.playerScore++;
    else if (result === 'lost') this.enemyScore++;

    this.updateScoreUI();

    const matchEnded = this.isMatchOver();

    const goAt = this.round.goAt;

    const pReact = (this.player.metrics.drewAt != null && goAt != null) ? (this.player.metrics.drewAt - goAt) : null;
    const eReact = (this.enemy.metrics.drewAt != null && goAt != null) ? (this.enemy.metrics.drewAt - goAt) : null;

    const pDraw = (this.player.metrics.drawnAt != null && this.player.metrics.drewAt != null) ? (this.player.metrics.drawnAt - this.player.metrics.drewAt) : null;
    const eDraw = (this.enemy.metrics.drawnAt != null && this.enemy.metrics.drewAt != null) ? (this.enemy.metrics.drawnAt - this.enemy.metrics.drewAt) : null;

    const pAim  = (this.player.metrics.shotAt != null && this.player.metrics.drawnAt != null) ? (this.player.metrics.shotAt - this.player.metrics.drawnAt) : null;
    const eAim  = (this.enemy.metrics.shotAt != null && this.enemy.metrics.drawnAt != null) ? (this.enemy.metrics.shotAt - this.enemy.metrics.drawnAt) : null;

    const pShot = (this.player.metrics.shotAt != null && goAt != null) ? (this.player.metrics.shotAt - goAt) : null;
    const eShot = (this.enemy.metrics.shotAt != null && goAt != null) ? (this.enemy.metrics.shotAt - goAt) : null;

    let headline = '';
    if (matchEnded) headline = (this.playerScore >= this.matchTarget()) ? '🏆 MATCH WON 🏆' : 'MATCH LOST';
    else headline = (result === 'won') ? 'ENEMY DOWN' : (result === 'lost') ? 'YOU DIED' : 'DRAW';

    const reasonLine = reason ? `<small style="color:#c9b08e">${reason}</small><br>` : '';
    const statsBlock = `
      <div style="margin-top:10px; font-size:12px; color:#bfa37a; line-height:1.35">
        <div style="opacity:0.9"><b>You</b> — react ${ms(pReact)} • draw ${ms(pDraw)} • aim ${ms(pAim)} • shot ${ms(pShot)}</div>
        <div style="opacity:0.9"><b>Them</b> — react ${ms(eReact)} • draw ${ms(eDraw)} • aim ${ms(eAim)} • shot ${ms(eShot)}</div>
      </div>
    `;
    const prompt = matchEnded
      ? `<br><small>Press N for new match</small>`
      : `<br><small>Press R to continue • N for new match</small>`;

    const message = `${headline}<br>${reasonLine}${statsBlock}${prompt}`;
    const delay = this.endScreenDelay();

    this.round.message = message;
    this.round.messageShown = false;
    this.round.messageAt = now + delay;

    if (delay <= 0) {
      showMessage(message);
      this.round.messageShown = true;
    }
  }

  updateScoreUI() {
    scoreEl.textContent = `YOU ${this.playerScore} - ${this.enemyScore} THEM`;
    const t = this.matchTarget();
    firstToEl.textContent = (t === Infinity) ? 'Endless' : `First to ${t}`;
    btnMatch.textContent = `Match: ${matchLabel()}`;
  }

  endScreenDelay() {
    const reason = this.round.reason || '';
    if (reason.includes('FALSE START')) return 0.2;

    let delay = 0;
    if (this.player.health <= 0) {
      delay = Math.max(delay, this.deathAnimDuration('cowboy1_die.png'));
    }
    if (this.enemy.health <= 0 && this.enemySkin?.death) {
      delay = Math.max(delay, this.deathAnimDuration(this.enemySkin.death));
    }
    return delay + 0.2;
  }

  deathAnimDuration(spriteName) {
    const cfg = getCfg(spriteName);
    return cfg.frames * 0.1;
  }

  // --------------------
  // Combat
  // --------------------
  startPlayerDraw(now) {
    this.player.state = 'drawing';
    this.player.frame = 0;
    this.player.frameTime = 0;
    this.player.hasShot = false;
    this.player.releaseQueued = false;
    this.player.aimStartAt = null;

    this.player.metrics.drewAt = now;
    this.player.metrics.drawnAt = null;
    this.player.metrics.shotAt = null;
  }

  spawnBlood(x, y, direction) {
    const count = 12 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      const angle = direction + (Math.random() - 0.5) * 1.5;
      const speed = 50 + Math.random() * 150;
      this.blood.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 50,
        size: 2 + Math.random() * 4,
        life: 1,
        decay: 0.6 + Math.random() * 0.6
      });
    }
  }

  hitTarget(target, bulletVx, now) {
    target.hitFlash = 0.22;

    const bloodDir = bulletVx > 0 ? 0 : Math.PI;
    this.spawnBlood(target.x, target.y - 10, bloodDir);

    this.shakeAmount = 10;
    this.shakeDuration = 0.4;

    if (Flags.practice) return;

    target.health = 0;
    target.state = 'dead';
    target.frame = 0;
    target.frameTime = 0;
    target.deadAt = now;
  }

  addBullet(shooter, target, aimX, aimY) {
    const face = this.desiredFacingToward(shooter, target);
    const muzzleX = shooter.x + this.muzzleOffsetX(face);
    const muzzleY = shooter.y - 10;

    const dx = aimX - muzzleX;
    const dy = aimY - muzzleY;
    const dist = Math.hypot(dx, dy) || 1;

    this.bullets.push({
      x: muzzleX, y: muzzleY,
      prevX: muzzleX, prevY: muzzleY,
      vx: (dx / dist) * this.BULLET_SPEED,
      vy: (dy / dist) * this.BULLET_SPEED,
      shooter, target
    });
  }

  getPlayerAim(now) {
    const baseX = this.enemy.x;
    const baseY = this.enemy.y - 10;

    const spread = AimModel.spread(now, this.player.aimStartAt);
    const c = AimModel.crosshairCenter(now, baseX, baseY, spread, this.player.aimSeed1, this.player.aimSeed2);
    return { x: c.x, y: c.y, spread };
  }

  firePlayerShot(now) {
    if (this.player.hasShot) return;

    this.player.hasShot = true;
    this.player.releaseQueued = false;
    this.player.metrics.shotAt = now;

    this.player.state = 'shooting';
    this.player.frame = 0;
    this.player.frameTime = 0;
    this.flashAlpha = 0.30;

    const aim = this.getPlayerAim(now);
    const off = randomInDisc(aim.spread);
    const aimX = aim.x + off.x;
    const aimY = aim.y + off.y * 0.7;

    this.addBullet(this.player, this.enemy, aimX, aimY);
  }

  fireEnemyShot(now) {
    if (this.enemy.hasShot) return;
    if (this.enemy.state !== 'aiming') return;

    this.enemy.hasShot = true;
    this.enemy.metrics.shotAt = now;

    this.enemy.state = 'shooting';
    this.enemy.frame = 0;
    this.enemy.frameTime = 0;
    this.flashAlpha = 0.25;

    const p = this.currentPersonality;

    const baseX = this.player.x;
    const baseY = this.player.y - 10;

    const aimDelay = this.enemy.ai.plannedAimDelay || rand(p.aimMin, p.aimMax);
    const aimSpan = Math.max(0.001, p.aimMax - p.aimMin);
    const aimFactor = clamp((aimDelay - p.aimMin) / aimSpan, 0, 1);

    let acc = clamp(p.accuracy + 0.10 * aimFactor, 0.10, 0.92);
    if (this.enemy.health <= 0 || this.enemy.state === 'dead') acc *= 0.25;
    if (this.enemy.ai.flinched) acc = clamp(acc - 0.12, 0.10, 0.92);

    const willHit = Math.random() < acc;

    let aimX, aimY;
    if (willHit) {
      const r = lerp(this.HIT_RADIUS * 1.10, this.HIT_RADIUS * 0.45, acc);
      const o = randomInDisc(r);
      aimX = baseX + o.x;
      aimY = baseY + o.y * 0.75;
    } else {
      const minR = this.HIT_RADIUS + 12;
      const maxR = this.HIT_RADIUS + 70;
      const a = Math.random() * Math.PI * 2;
      const rr = minR + Math.random() * (maxR - minR);
      aimX = baseX + Math.cos(a) * rr;
      aimY = baseY + Math.sin(a) * rr * 0.75;
    }

    this.addBullet(this.enemy, this.player, aimX, aimY);
  }

  // --------------------
  // Update
  // --------------------
  update(dt) {
    const now = this.roundNowSeconds();
    this.round.time = now;

    if (!Flags.practice && this.round.state === 'standoff') {
      this.updateStandoff(dt, now);
    }

    this.updatePlayer(dt, now);
    this.updateEnemy(dt, now);
    this.updateBullets(dt, now);

    this.updateBlood(dt);
    this.updateDust(dt);
    this.updateTumbleweeds(dt);
    this.updateShake(dt);

    if (!Flags.practice) this.evaluateRoundEnd(now);

    this.updateUI(now);

    if (this.round.state === 'over' && this.round.message && !this.round.messageShown && now >= this.round.messageAt) {
      showMessage(this.round.message);
      this.round.messageShown = true;
    }
  }

  updateStandoff(dt, now) {
    if (now > 0.6) tensionBar.classList.add('visible');

    const t = clamp(now / this.round.goTime, 0, 1);
    tensionFill.style.width = `${(t * 100).toFixed(1)}%`;

    if (now > 1.2) {
      enemyTypeEl.textContent = `${this.enemySkin.label} • ${this.currentPersonality.name}`;
      enemyTypeEl.classList.add('visible');
    }

    const p = this.currentPersonality;
    if (p.falseStartChance > 0 && Math.random() < p.falseStartChance * dt) {
        this.endRound('won', 'ENEMY FALSE START', now);
      return;
    }

    if (!this.round.goFired && now >= this.round.goTime) {
      this.triggerGo(now);
    }
  }

  updatePlayer(dt, now) {
    this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);

    if (this.player.state === 'dead') {
      const cfg = getCfg('cowboy1_die.png');
      this.player.frameTime += dt;
      if (this.player.frameTime > 0.1) {
        this.player.frameTime = 0;
        if (this.player.frame < cfg.frames - 1) this.player.frame++;
      }
      return;
    }

    if (this.player.state === 'holstering') {
      const cfg = getCfg('cowboy1_draw-Sheet.png');
      this.player.frameTime += dt;
      if (this.player.frameTime > this.player.drawSpeed) {
        this.player.frameTime = 0;
        this.player.frame--;
        if (this.player.frame <= 0) {
          this.player.state = 'idle';
          this.player.frame = 0;
          this.player.aimStartAt = null;
          this.player.releaseQueued = false;
        }
      }
      return;
    }

    if (this.player.state === 'shooting') {
      const cfg = getCfg('cowboy1_ONLYshooting(nodraw)-Sheet.png');
      this.player.frameTime += dt;
      if (this.player.frameTime > 0.05) {
        this.player.frameTime = 0;
        this.player.frame++;
        if (this.player.frame >= cfg.frames) {
          this.player.state = 'aiming';
          this.player.frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;

          if (Flags.practice) {
            this.player.hasShot = false;
            this.player.aimStartAt = null;
          }
        }
      }
      return;
    }

    if (this.player.state === 'drawing') {
      if (!Input.drawHeld && !this.player.releaseQueued) return;

      const cfg = getCfg('cowboy1_draw-Sheet.png');
      this.player.frameTime += dt;
      if (this.player.frameTime > this.player.drawSpeed) {
        this.player.frameTime = 0;
        this.player.frame++;
        if (this.player.frame >= cfg.frames) {
          this.player.state = 'aiming';
          this.player.frame = cfg.frames - 1;

          this.player.metrics.drawnAt = now;
          this.player.aimSeed1 = Math.random() * 10;
          this.player.aimSeed2 = Math.random() * 10;
          this.player.aimStartAt = now;

          if (this.player.releaseQueued && !this.player.hasShot && this.enemy.health > 0) {
            this.firePlayerShot(now);
          }
        }
      }
      return;
    }

    if (this.player.state === 'aiming') {
      this.player.frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;
      if (Input.drawHeld && !this.player.hasShot) {
        if (this.player.aimStartAt == null) this.player.aimStartAt = now;
      }
    }
  }

  updateEnemy(dt, now) {
    this.enemy.hitFlash = Math.max(0, this.enemy.hitFlash - dt);

    const drawSprite = this.enemySkin.draw;
    const shootSprite = this.enemySkin.shoot;
    const deathSprite = this.enemySkin.death;

    if (this.enemy.state === 'dead') {
      const cfg = getCfg(deathSprite);
      this.enemy.frameTime += dt;
      if (this.enemy.frameTime > 0.1) {
        this.enemy.frameTime = 0;
        if (this.enemy.frame < cfg.frames - 1) this.enemy.frame++;
      }
      return;
    }

    if (this.enemy.state === 'shooting') {
      const cfg = getCfg(shootSprite);
      this.enemy.frameTime += dt;
      if (this.enemy.frameTime > 0.05) {
        this.enemy.frameTime = 0;
        this.enemy.frame++;
        const frameLimit = this.enemyShootFrameLimit(cfg);
        if (this.enemy.frame >= frameLimit) {
          this.enemy.state = 'aiming';
          this.enemy.frame = getCfg(drawSprite).frames - 1;

          if (Flags.practice) {
            this.enemy.hasShot = false;
            this.enemy.ai.fireAt = now + rand(0.45, 1.10);
          }
        }
      }
      return;
    }

    if (this.enemy.state === 'drawing') {
      const cfg = getCfg(drawSprite);
      this.enemy.frameTime += dt;
      if (this.enemy.frameTime > this.enemy.drawSpeed) {
        this.enemy.frameTime = 0;
        this.enemy.frame++;
        if (this.enemy.frame >= cfg.frames) {
          this.enemy.state = 'aiming';
          this.enemy.frame = cfg.frames - 1;
          this.enemy.metrics.drawnAt = now;
          this.enemy.aimStartAt = now;

          const p = this.currentPersonality;
          this.enemy.ai.plannedAimDelay = rand(p.aimMin, p.aimMax);
          this.enemy.ai.fireAt = now + this.enemy.ai.plannedAimDelay;
        }
      }
      return;
    }

    if (this.enemy.state === 'aiming') {
      this.enemy.frame = getCfg(drawSprite).frames - 1;
      if (Flags.enemyAI && !this.enemy.hasShot) {
        if (this.enemy.ai.fireAt == null) {
          const p = this.currentPersonality;
          this.enemy.ai.fireAt = now + rand(p.aimMin, p.aimMax);
        }
        if (now >= this.enemy.ai.fireAt && this.player.health > 0) {
          this.fireEnemyShot(now);
        }
      }
      return;
    }

    if (!Flags.enemyAI) return;

    if (this.round.state === 'duel' && this.enemy.ai.drawAt != null && now >= this.enemy.ai.drawAt) {
      this.enemy.state = 'drawing';
      this.enemy.frame = 0;
      this.enemy.frameTime = 0;
      this.enemy.metrics.drewAt = now;
      this.enemy.metrics.drawnAt = null;
      this.enemy.ai.drawAt = null;
    }
  }

  updateBullets(dt, now) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.target.health > 0 || Flags.practice) {
        const tx = b.target.x;
        const ty = b.target.y - 10;
        const d = distPointToSegment(tx, ty, b.prevX, b.prevY, b.x, b.y);
        if (d <= this.HIT_RADIUS) {
          this.hitTarget(b.target, b.vx, now);
          this.bullets.splice(i, 1);
          continue;
        }
      }

      if (b.x < -60 || b.x > canvas.width + 60 || b.y < -60 || b.y > canvas.height + 60) {
        this.bullets.splice(i, 1);
      }
    }
  }

  updateBlood(dt) {
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const p = this.blood[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= p.decay * dt;

      if (p.y > 360) {
        p.y = 360;
        p.vx *= 0.5;
        p.vy = 0;
        p.decay *= 0.3;
      }
      if (p.life <= 0) this.blood.splice(i, 1);
    }
  }

  initDust() {
    this.dust.length = 0;
    for (let i = 0; i < 30; i++) {
      this.dust.push({
        x: Math.random() * canvas.width,
        y: 200 + Math.random() * 250,
        size: 1 + Math.random() * 2,
        speed: 5 + Math.random() * 15,
        alpha: 0.1 + Math.random() * 0.2
      });
    }
  }

  updateDust(dt) {
    for (const p of this.dust) {
      p.x += p.speed * dt;
      if (p.x > canvas.width + 10) {
        p.x = -10;
        p.y = 200 + Math.random() * 250;
      }
    }
  }

  updateTumbleweeds(dt) {
    if (this.tumbleweeds.length < 2 && Math.random() < 0.002) {
      const fromLeft = Math.random() < 0.5;
      this.tumbleweeds.push({
        x: fromLeft ? -20 : canvas.width + 20,
        y: 300 + Math.random() * 100,
        vx: fromLeft ? 40 + Math.random() * 30 : -(40 + Math.random() * 30),
        rotation: 0,
        size: 8 + Math.random() * 8
      });
    }

    for (let i = this.tumbleweeds.length - 1; i >= 0; i--) {
      const t = this.tumbleweeds[i];
      t.x += t.vx * dt;
      t.rotation += t.vx * 0.05 * dt;
      if (t.x < -30 || t.x > canvas.width + 30) this.tumbleweeds.splice(i, 1);
    }
  }

  updateShake(dt) {
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      this.shakeAmount *= 0.9;
      if (this.shakeDuration <= 0) this.shakeAmount = 0;
    }
    if (this.flashAlpha > 0) this.flashAlpha -= dt * 2;
  }

  evaluateRoundEnd(now) {
    if (this.round.state !== 'duel') return;

    const pDead = this.player.health <= 0;
    const eDead = this.enemy.health <= 0;

    if (pDead || eDead) {
        if (pDead && eDead) {
          const dt = Math.abs((this.player.deadAt ?? now) - (this.enemy.deadAt ?? now));
          if (dt <= this.TIE_EPS) this.endRound('draw', 'SIMULTANEOUS HIT', now);
          else if ((this.player.deadAt ?? now) < (this.enemy.deadAt ?? now)) this.endRound('lost', 'YOU WENT DOWN FIRST', now);
          else this.endRound('won', 'THEM WENT DOWN FIRST', now);
        } else if (pDead) this.endRound('lost', 'SHOT', now);
        else this.endRound('won', 'SHOT', now);
      return;
    }

    if (this.player.hasShot && this.enemy.hasShot && this.bullets.length === 0) {
        this.endRound('draw', 'BOTH MISSED', now);
    }
  }

  updateUI(now) {
    const roundNum = this.playerScore + this.enemyScore + 1;
    roundEl.textContent = `Round ${roundNum}${Flags.practice ? ' (Practice)' : ''}`;

    if (Flags.practice) statusEl.textContent = 'Practice Range (DUEL)';
    else if (this.round.state === 'standoff') statusEl.textContent = 'Wait for DRAW!';
    else statusEl.textContent = 'Duel';

    if (this.player.state === 'aiming' && !this.player.hasShot) {
      const aim = this.getPlayerAim(now);
      const chance = AimModel.approxHitChance(this.HIT_RADIUS, aim.spread);
      subStatusEl.textContent = Flags.debug
        ? `Spread ${aim.spread.toFixed(1)}px • ~Hit ${Math.round(chance * 100)}% • Release to shoot • Q holster`
        : `Release to shoot • Q holster`;
    } else if (this.player.state === 'drawing') {
      subStatusEl.textContent = this.player.releaseQueued ? 'Quick shot queued…' : 'Drawing…';
    } else if (this.player.state === 'holstering') {
      subStatusEl.textContent = 'Holstering…';
    } else {
      subStatusEl.textContent = Flags.practice ? 'Hold/release to test aim. Q holsters without firing.' : '';
    }
  }

  // --------------------
  // Draw
  // --------------------
  draw() {
    ctx.save();
    if (this.shakeAmount > 0) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmount * 2, (Math.random() - 0.5) * this.shakeAmount * 2);
    }

    // Sky + sun
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 260);
    skyGrad.addColorStop(0, '#5BA3C8');
    skyGrad.addColorStop(0.5, '#87CEEB');
    skyGrad.addColorStop(1, '#E8D4A8');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, 260);

    const sunGrad = ctx.createRadialGradient(320, 80, 0, 320, 80, 100);
    sunGrad.addColorStop(0, 'rgba(255, 250, 200, 0.9)');
    sunGrad.addColorStop(0.3, 'rgba(255, 240, 180, 0.4)');
    sunGrad.addColorStop(1, 'rgba(255, 230, 150, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(220, 0, 200, 180);

    ctx.fillStyle = '#FFF8DC';
    ctx.beginPath();
    ctx.arc(320, 80, 25, 0, Math.PI * 2);
    ctx.fill();

    // Mesas
    for (const m of this.mesas) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(m.x, 260);
      ctx.lineTo(m.x + 15, 260 - m.h);
      ctx.lineTo(m.x + m.w - 15, 260 - m.h);
      ctx.lineTo(m.x + m.w, 260);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(m.x + 15, 260 - m.h);
      ctx.lineTo(m.x + m.w / 2, 260 - m.h);
      ctx.lineTo(m.x + m.w / 2 - 10, 260);
      ctx.lineTo(m.x, 260);
      ctx.closePath();
      ctx.fill();
    }

    // Ground
    ctx.fillStyle = '#C9A86C';
    ctx.fillRect(0, 260, canvas.width, 220);

    // Ground patches
    for (const p of this.groundPatches) {
      ctx.fillStyle = `rgba(100, 80, 50, ${p.alpha})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sand speckles
    ctx.fillStyle = '#b89a5a';
    for (let i = 0; i < 80; i++) ctx.fillRect((i * 73 + 11) % canvas.width, 265 + (i * 47) % 190, 2, 1);
    ctx.fillStyle = '#d4b87a';
    for (let i = 0; i < 50; i++) ctx.fillRect((i * 97 + 33) % canvas.width, 270 + (i * 31) % 180, 1, 1);

    // Trees
    for (const t of this.trees) {
      const sprite = 'trees1-Sheet.png';
      if (!spriteOk(sprite)) continue;

      const cfg = getCfg(sprite, 64, 80);
      const s = t.scale;

      ctx.save();
      ctx.globalAlpha = t.y < 260 ? 0.6 : 1;
      ctx.drawImage(
        sprites[sprite],
        (t.type % cfg.frames) * cfg.fw, 0,
        cfg.fw, cfg.fh,
        t.x - (cfg.fw * s) / 2,
        t.y - (cfg.fh * s) + 20,
        cfg.fw * s, cfg.fh * s
      );
      ctx.restore();
    }

    // Dust
    for (const p of this.dust) {
      ctx.fillStyle = `rgba(210, 190, 150, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shadows
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(this.player.x, this.player.y + 30, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(this.enemy.x, this.enemy.y + 30, 18, 5, 0, 0, Math.PI * 2); ctx.fill();

    // Blood ground
    for (const p of this.blood) {
      if (p.y >= 355) {
        ctx.fillStyle = `rgba(100, 20, 20, ${p.life * 0.8})`;
        ctx.fillRect(p.x - p.size / 2, p.y, p.size, p.size * 0.3);
      }
    }

    // Cowboys
    this.drawPlayer();
    this.drawEnemy();

    // Hit flashes
    this.drawHitFlash(this.player);
    this.drawHitFlash(this.enemy);

    // Blood air
    for (const p of this.blood) {
      if (p.y < 355) {
        ctx.fillStyle = `rgba(140, 30, 30, ${p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Tumbleweeds
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

    // Bullets
    for (const b of this.bullets) {
      ctx.fillStyle = 'rgba(255,200,50,0.35)';
      ctx.beginPath();
      ctx.arc(b.x - b.vx * this.BULLET_TRAIL, b.y - b.vy * this.BULLET_TRAIL, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffdd44';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Vignette
    const vignetteGrad = ctx.createRadialGradient(320, 240, 150, 320, 240, 400);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Flash
    if (this.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 240, 200, ${this.flashAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Aim visuals
    if (this.round.state === 'duel' && this.player.state === 'aiming' && !this.player.hasShot) {
      const aim = this.getPlayerAim(this.round.time);
      const chance = AimModel.approxHitChance(this.HIT_RADIUS, aim.spread);

      // enemy hit ring
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = 'rgba(255, 120, 120, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.enemy.x, this.enemy.y - 10, this.HIT_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // spread ring & crosshair
      const g = Math.round(lerp(80, 220, chance));
      const r = Math.round(lerp(220, 120, chance));

      ctx.save();
      ctx.strokeStyle = `rgba(${r}, ${g}, 120, 0.40)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, aim.spread, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 245, 220, 0.95)';
      ctx.lineWidth = 1;
      const size = 10;
      ctx.beginPath();
      ctx.moveTo(aim.x - size, aim.y); ctx.lineTo(aim.x - 2, aim.y);
      ctx.moveTo(aim.x + 2, aim.y); ctx.lineTo(aim.x + size, aim.y);
      ctx.moveTo(aim.x, aim.y - size); ctx.lineTo(aim.x, aim.y - 2);
      ctx.moveTo(aim.x, aim.y + 2); ctx.lineTo(aim.x, aim.y + size);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 220, 140, 0.85)';
      ctx.fillRect(aim.x - 1, aim.y - 1, 2, 2);
      ctx.restore();
    }

    // Enemy flinch indicator
    if (this.enemy.ai.flinchUntil > this.round.time) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold 20px Georgia';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff1c9';
      ctx.fillText('!', this.enemy.x, this.enemy.y - 70);
      ctx.restore();
    }
  }

  drawHitFlash(ent) {
    if (ent.hitFlash <= 0) return;
    ctx.save();
    ctx.globalAlpha = ent.hitFlash;
    ctx.fillStyle = 'rgba(220, 60, 60, 0.35)';
    ctx.beginPath();
    ctx.arc(ent.x, ent.y - 10, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer() {
    const scale = 3;

    let name = 'cowboy1_draw-Sheet.png';
    if (this.player.state === 'dead') name = 'cowboy1_die.png';
    else if (this.player.state === 'shooting') name = 'cowboy1_ONLYshooting(nodraw)-Sheet.png';
    else name = 'cowboy1_draw-Sheet.png';

    const cfg = getCfg(name);
    let frame = 0;

    if (this.player.state === 'aiming') frame = getCfg('cowboy1_draw-Sheet.png').frames - 1;
    else if (this.player.state === 'holstering') frame = clamp(this.player.frame, 0, getCfg('cowboy1_draw-Sheet.png').frames - 1);
    else frame = clamp(this.player.frame, 0, cfg.frames - 1);

    const desiredFacing = this.desiredFacingToward(this.player, this.enemy); // should be +1
    const sx = this.playerScaleX(desiredFacing);

    drawSpriteFrame(ctx, name, frame, this.player.x, this.player.y, sx * scale, scale, 1);
  }

  drawEnemy() {
    const scale = 3;

    let name = this.enemySkin.draw;
    if (this.enemy.state === 'dead') name = this.enemySkin.death;
    else if (this.enemy.state === 'shooting') name = this.enemySkin.shoot;
    else name = this.enemySkin.draw;

    const cfg = getCfg(name);
    let frame = 0;

    if (this.enemy.state === 'aiming') frame = getCfg(this.enemySkin.draw).frames - 1;
    else if (this.enemy.state === 'shooting') {
      const frameLimit = this.enemyShootFrameLimit(cfg);
      frame = clamp(this.enemy.frame, 0, Math.min(frameLimit - 1, cfg.frames - 1));
    }
    else frame = clamp(this.enemy.frame, 0, cfg.frames - 1);

    const desiredFacing = this.desiredFacingToward(this.enemy, this.player); // should be -1
    const sx = this.enemyScaleX(desiredFacing);

    const yOffset = (this.enemy.state === 'shooting') ? (this.enemySkin.shootOffsetY ?? 0) : 0;
    drawSpriteFrame(ctx, name, frame, this.enemy.x, this.enemy.y + yOffset, sx * scale, scale, 1);
  }

  generateEnvironment() {
    this.trees.length = 0;
    this.mesas.length = 0;
    this.groundPatches.length = 0;

    this.mesas.push({ x: 80, w: 120, h: 60, color: '#a08870' });
    this.mesas.push({ x: 250, w: 80, h: 40, color: '#9a8268' });
    this.mesas.push({ x: 450, w: 140, h: 70, color: '#a58a72' });
    this.mesas.push({ x: 580, w: 90, h: 45, color: '#9a8268' });

    this.trees.push({ x: 30, y: 260, type: 3, scale: 0.9 });
    this.trees.push({ x: 60, y: 280, type: 7, scale: 1.0 });
    this.trees.push({ x: 15, y: 310, type: 2, scale: 0.8 });

    this.trees.push({ x: 590, y: 255, type: 5, scale: 0.85 });
    this.trees.push({ x: 620, y: 275, type: 1, scale: 0.95 });
    this.trees.push({ x: 610, y: 305, type: 4, scale: 0.75 });

    this.trees.push({ x: 200, y: 230, type: 8, scale: 0.5 });
    this.trees.push({ x: 440, y: 225, type: 6, scale: 0.45 });

    for (let i = 0; i < 12; i++) {
      this.groundPatches.push({
        x: Math.random() * canvas.width,
        y: 260 + Math.random() * 200,
        w: 30 + Math.random() * 60,
        h: 10 + Math.random() * 20,
        alpha: 0.1 + Math.random() * 0.15
      });
    }

    this.trees.sort((a, b) => a.y - b.y);
  }
}
