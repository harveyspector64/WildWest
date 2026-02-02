import { messageEl } from '../core/state.js';

export function showMessage(html) {
  messageEl.innerHTML = html;
  messageEl.classList.add('visible');
}

export function hideMessage() {
  messageEl.classList.remove('visible');
}
