import { Input, canvas } from './state.js';
import { clamp } from './utils.js';
import { toggleDebug, toggleEnemy, togglePractice, cycleMatch } from '../ui/controls.js';

export function initInput(sceneManager, { requestHolster } = {}) {
  function setDrawHeld(held) {
    if (Input.drawHeld === held) return;
    Input.drawHeld = held;

    const scene = sceneManager.current;
    if (!scene) return;

    if (held) scene.onDrawPress?.();
    else scene.onDrawRelease?.();
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.code === 'Space') e.preventDefault();

    if (!e.repeat && e.key === 'Tab') {
      e.preventDefault();
      sceneManager.nextScene();
      return;
    }

    if (!e.repeat && k === 'q') requestHolster?.();
    if (!e.repeat && k === 'p') togglePractice(sceneManager);
    if (!e.repeat && k === 'e') toggleEnemy(sceneManager);
    if (!e.repeat && k === 'h') toggleDebug(sceneManager);
    if (!e.repeat && k === 'm') cycleMatch(sceneManager);
    if (!e.repeat && k === 'r') sceneManager.current?.reset?.();
    if (!e.repeat && k === 'n') sceneManager.current?.newMatch?.();
    if (!e.repeat && k === 'f') sceneManager.current?.onFlipEnemyFacing?.();

    if (e.code === 'Space' && !e.repeat) setDrawHeld(true);

    Input.keys.add(k);
  }, { passive: false });

  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (e.code === 'Space') {
      e.preventDefault();
      setDrawHeld(false);
    }
    Input.keys.delete(k);
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (Input.pointer.id !== null) return;
    Input.pointer.id = e.pointerId;
    Input.pointer.down = true;
    updatePointerPos(e);
    try { canvas.setPointerCapture(Input.pointer.id); } catch {}
    setDrawHeld(true);
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    updatePointerPos(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if (e.pointerId !== Input.pointer.id) return;
    Input.pointer.id = null;
    Input.pointer.down = false;
    updatePointerPos(e);
    setDrawHeld(false);
  }, { passive: false });

  canvas.addEventListener('pointercancel', () => {
    Input.pointer.id = null;
    Input.pointer.down = false;
    setDrawHeld(false);
  });

  function updatePointerPos(e) {
    const r = canvas.getBoundingClientRect();
    Input.pointer.x = clamp((e.clientX - r.left) * (canvas.width / r.width), 0, canvas.width);
    Input.pointer.y = clamp((e.clientY - r.top) * (canvas.height / r.height), 0, canvas.height);
  }

  return {
    setDrawHeld
  };
}

export function suppressNextRelease() {
  Input.suppressNextRelease = true;
}
