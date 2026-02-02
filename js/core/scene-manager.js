export class SceneManager {
  constructor({ setSceneUI, initial = 'duel', order = ['duel', 'overworld', 'duckhunt'] } = {}) {
    this.scenes = {};
    this.order = order;
    this.idx = 0;
    this.currentName = initial;
    this.current = null;
    this.setSceneUI = setSceneUI;
  }

  add(name, scene) {
    this.scenes[name] = scene;
  }

  switchTo(name) {
    if (!this.scenes[name]) return;
    this.current?.onExit?.();
    this.current = this.scenes[name];
    this.currentName = name;
    this.current?.onEnter?.();
    this.setSceneUI?.(name, this);
  }

  nextScene() {
    this.idx = (this.idx + 1) % this.order.length;
    this.switchTo(this.order[this.idx]);
  }
}
