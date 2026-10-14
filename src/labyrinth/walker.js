// Turns input into slow, eased motion along the path's arc length.
export function createWalker(pane, length) {
  const input = { keyFwd: false, keyBack: false, hold: false };
  const state = { s: 0, v: 0, pace: 0.85 }; // pace in path widths per second

  const fwdKeys = new Set(['KeyW', 'ArrowUp']);
  const backKeys = new Set(['KeyS', 'ArrowDown']);
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range';

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (fwdKeys.has(e.code)) input.keyFwd = true;
    else if (backKeys.has(e.code)) input.keyBack = true;
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (fwdKeys.has(e.code)) input.keyFwd = false;
    if (backKeys.has(e.code)) input.keyBack = false;
  });
  window.addEventListener('blur', () => {
    input.keyFwd = input.keyBack = input.hold = false;
  });

  pane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    input.hold = true;
    pane.setPointerCapture(e.pointerId);
  });
  const release = () => {
    input.hold = false;
  };
  pane.addEventListener('pointerup', release);
  pane.addEventListener('pointercancel', release);

  function update(dt) {
    const dir = (input.keyFwd || input.hold ? 1 : 0) - (input.keyBack ? 1 : 0);
    const target = dir * state.pace;
    // Ease in and out: start like a first step, settle like a breath.
    const rate = target === 0 ? 2.2 : 1.3;
    state.v += (target - state.v) * (1 - Math.exp(-dt * rate));
    if (Math.abs(state.v) < 1e-4 && target === 0) state.v = 0;
    state.s += state.v * dt;
    if (state.s <= 0 || state.s >= length) {
      state.s = Math.min(Math.max(state.s, 0), length);
      state.v = 0;
    }
    return state;
  }

  /** Back to the entrance of a path of the given length. */
  function reset(newLength) {
    length = newLength;
    state.s = 0;
    state.v = 0;
  }

  return { state, input, update, reset };
}
