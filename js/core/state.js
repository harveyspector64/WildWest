export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

export const statusEl = document.getElementById('status');
export const subStatusEl = document.getElementById('substatus');
export const roundEl = document.getElementById('round');

export const scoreWrap = document.getElementById('score');
export const scoreEl = document.getElementById('scoreText');
export const firstToEl = document.getElementById('firstTo');

export const instructionsEl = document.getElementById('instructions');
export const messageEl = document.getElementById('message');

export const tensionBar = document.getElementById('tensionBar');
export const tensionFill = document.getElementById('tensionFill');
export const enemyTypeEl = document.getElementById('enemyType');

export const btnScene = document.getElementById('btnScene');
export const btnHolster = document.getElementById('btnHolster');
export const btnPractice = document.getElementById('btnPractice');
export const btnEnemy = document.getElementById('btnEnemy');
export const btnMatch = document.getElementById('btnMatch');
export const btnDebug = document.getElementById('btnDebug');

export const Flags = {
  practice: false,
  enemyAI: true,
  debug: false
};

export const MatchSettings = {
  targets: [3, 5, 7, 10, Infinity],
  idx: 0
};

export const Input = {
  keys: new Set(),
  drawHeld: false,
  suppressNextRelease: false,
  pointer: { x: canvas.width / 2, y: canvas.height / 2, down: false, id: null }
};
