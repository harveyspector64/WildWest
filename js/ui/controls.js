import {
  btnDebug,
  btnEnemy,
  btnHolster,
  btnMatch,
  btnPractice,
  btnScene,
  enemyTypeEl,
  instructionsEl,
  scoreWrap,
  tensionBar
} from '../core/state.js';
import { Flags, MatchSettings } from '../core/state.js';
import { isTouchLike } from '../core/utils.js';
import { hideMessage } from './message.js';

export function matchLabel() {
  const t = MatchSettings.targets[MatchSettings.idx];
  return (t === Infinity) ? '∞' : `FT${t}`;
}

export function updateToggleButtons(sceneManager) {
  btnScene.textContent = `Scene: ${sceneManager.currentName.toUpperCase()}`;

  const s = sceneManager.currentName;
  btnHolster.textContent = (s === 'duckhunt') ? 'Cancel Aim (Q)' : 'Holster (Q)';

  btnPractice.textContent = `Practice: ${Flags.practice ? 'ON' : 'OFF'}`;
  btnPractice.classList.toggle('off', !Flags.practice);

  btnEnemy.textContent = `Enemy: ${Flags.enemyAI ? 'ON' : 'OFF'}`;
  btnEnemy.classList.toggle('off', !Flags.enemyAI);

  btnMatch.textContent = `Match: ${matchLabel()}`;

  btnDebug.textContent = `Debug: ${Flags.debug ? 'ON' : 'OFF'}`;
  btnDebug.classList.toggle('off', !Flags.debug);
}

export function updateInstructions(sceneManager) {
  const touch = isTouchLike();
  const s = sceneManager.currentName;

  if (s === 'duel') {
    instructionsEl.innerHTML = touch
      ? `DUEL — HOLD on game to draw/steady • RELEASE to shoot • Q holster • F flip enemy if needed • TAB scene<br>P practice • E enemy • M match • H debug • R reset • N new match`
      : `DUEL — HOLD SPACE to draw/steady • RELEASE to shoot • Q holster • F flip enemy if needed • TAB scene<br>P practice • E enemy • M match • H debug • R reset • N new match`;
  } else if (s === 'overworld') {
    instructionsEl.innerHTML = touch
      ? `OVERWORLD — drag aim • hold/release to shoot • Q holster • TAB scene<br>(keyboard: WASD/Arrows move) • gun flips while moving • H debug • R reset • N regen`
      : `OVERWORLD — WASD/Arrows move • HOLD SPACE aim • RELEASE shoot • Q holster • TAB scene<br>Gun flips while moving • H debug • R reset • N regen`;
  } else {
    instructionsEl.innerHTML = touch
      ? `DUCK HUNT — HOLD to steady • RELEASE to shoot • Q cancel • TAB scene<br>3 shots then reload • H debug • R reset`
      : `DUCK HUNT — HOLD SPACE to steady • RELEASE to shoot • Q cancel • TAB scene<br>3 shots then reload • H debug • R reset`;
  }
}

export function setSceneUI(sceneName, sceneManager) {
  hideMessage();

  const isDuel = (sceneName === 'duel');

  scoreWrap.style.display = isDuel ? 'block' : 'none';
  tensionBar.style.display = isDuel ? 'block' : 'none';
  enemyTypeEl.style.display = isDuel ? 'block' : 'none';

  btnEnemy.classList.toggle('hidden', !isDuel);
  btnMatch.classList.toggle('hidden', !isDuel);

  updateToggleButtons(sceneManager);
  updateInstructions(sceneManager);
}

export function bindUI(sceneManager, { requestHolster } = {}) {
  btnScene.addEventListener('click', () => sceneManager.nextScene());
  btnHolster.addEventListener('click', () => requestHolster?.());
  btnPractice.addEventListener('click', () => togglePractice(sceneManager));
  btnEnemy.addEventListener('click', () => toggleEnemy(sceneManager));
  btnMatch.addEventListener('click', () => cycleMatch(sceneManager));
  btnDebug.addEventListener('click', () => toggleDebug(sceneManager));
}

export function togglePractice(sceneManager) {
  Flags.practice = !Flags.practice;
  sceneManager.current?.reset?.();
  updateToggleButtons(sceneManager);
}

export function toggleEnemy(sceneManager) {
  Flags.enemyAI = !Flags.enemyAI;
  sceneManager.current?.reset?.();
  updateToggleButtons(sceneManager);
}

export function toggleDebug(sceneManager) {
  Flags.debug = !Flags.debug;
  updateToggleButtons(sceneManager);
}

export function cycleMatch(sceneManager) {
  MatchSettings.idx = (MatchSettings.idx + 1) % MatchSettings.targets.length;
  sceneManager.current?.onMatchChanged?.();
  updateToggleButtons(sceneManager);
}
