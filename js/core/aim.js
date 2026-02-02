import { clamp, lerp } from './utils.js';

export const AimModel = {
  spreadStart: 34,
  spreadMin: 6,
  stabilize: 0.34,
  fatigueStart: 0.95,
  fatigueRamp: 0.85,
  fatigueMax: 24,
  driftFactor: 0.30,

  spread(now, aimStartAt) {
    if (aimStartAt == null) return this.spreadStart;
    const aimTime = Math.max(0, now - aimStartAt);

    const t1 = clamp(aimTime / this.stabilize, 0, 1);
    let s = lerp(this.spreadStart, this.spreadMin, t1);

    if (aimTime > this.fatigueStart) {
      const t2 = clamp((aimTime - this.fatigueStart) / this.fatigueRamp, 0, 1);
      s = lerp(this.spreadMin, this.fatigueMax, t2);
    }
    return s;
  },

  approxHitChance(hitRadius, spread) {
    if (spread <= 0) return 1;
    if (spread <= hitRadius) return 1;
    return clamp((hitRadius * hitRadius) / (spread * spread), 0, 1);
  },

  crosshairCenter(now, baseX, baseY, spread, seed1, seed2) {
    const driftAmp = spread * this.driftFactor;
    const t = now;

    const sx = Math.sin(t * 7.2 + seed1) + Math.sin(t * 12.8 + seed2) * 0.6;
    const sy = Math.cos(t * 6.4 + seed2) + Math.sin(t * 10.6 + seed1) * 0.5;

    return {
      x: baseX + sx * driftAmp * 0.35,
      y: baseY + sy * driftAmp * 0.22
    };
  }
};
