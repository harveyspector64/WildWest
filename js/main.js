import { Input } from './core/state.js';
import { loadSprites } from './core/sprites.js';
import { SceneManager } from './core/scene-manager.js';
import { initInput } from './core/input.js';
import { setSceneUI, bindUI, updateToggleButtons, updateInstructions } from './ui/controls.js';
import { DuelScene } from './scenes/duel.js';
import { OverworldScene } from './scenes/overworld.js';
import { DuckHuntScene } from './scenes/duckhunt.js';

const sceneManager = new SceneManager({ setSceneUI });

let setDrawHeld = () => {};

function requestHolster() {
  // Prevent Q while holding from also firing on the release event.
  Input.suppressNextRelease = true;
  setDrawHeld(false);
  sceneManager.current?.onHolsterToggle?.();
}

bindUI(sceneManager, { requestHolster });

const inputHandlers = initInput(sceneManager, { requestHolster });
setDrawHeld = inputHandlers.setDrawHeld;

let lastPerf = performance.now();
function loop() {
  const nowPerf = performance.now();
  let dt = (nowPerf - lastPerf) / 1000;
  dt = Math.min(dt, 0.05);
  lastPerf = nowPerf;

  sceneManager.current?.update?.(dt);
  sceneManager.current?.draw?.();

  requestAnimationFrame(loop);
}

function init() {
  sceneManager.add('duel', new DuelScene());
  sceneManager.add('overworld', new OverworldScene());
  sceneManager.add('duckhunt', new DuckHuntScene());

  sceneManager.switchTo('duel');

  updateToggleButtons(sceneManager);
  updateInstructions(sceneManager);

  requestAnimationFrame(loop);
}

loadSprites(init);
