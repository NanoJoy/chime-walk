// Turns input into slow, eased motion along the path's arc length.
//
// Keys point in screen directions; the walker goes forward or back along the
// path by however much the path heads that way. The hex steps on screen are
// W, NW, NE, E, SE, SW, plus N/S for the straight way in.
export function createWalker(length, foreshorten = 1) {
  const held = new Set();
  const input = { active: false };
  const state = { s: 0, v: 0, pace: 0.85 }; // pace in path widths per second

  // Screen vectors, x right and y down (like world +z). Diagonals follow the
  // hex steps (60° from horizontal on the ground) as the tilted camera sees them.
  const dy = Math.sin(Math.PI / 3) * foreshorten;
  const dirs = {
    KeyQ: [-0.5, -dy], KeyW: [0, -1], KeyE: [0.5, -dy],
    KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0],
    KeyZ: [-0.5, dy], KeyC: [0.5, dy],
  };
  for (const d of Object.values(dirs)) {
    const l = Math.hypot(d[0], d[1]);
    d[0] /= l;
    d[1] /= l;
  }
  const DEAD_ZONE = 0.2;
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range';

  window.addEventListener('keydown', (e) => {
    if (typing(e) || !(e.code in dirs) || e.ctrlKey || e.metaKey || e.altKey) return;
    held.add(e.code);
    input.active = true;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    input.active = held.size > 0;
  });
  window.addEventListener('blur', () => {
    held.clear();
    input.active = false;
  });

  /** Advances by dt seconds; tx, tz is the path's unit tangent at state.s. */
  function update(dt, tx, tz) {
    let kx = 0, ky = 0;
    for (const code of held) {
      kx += dirs[code][0];
      ky += dirs[code][1];
    }
    const kl = Math.hypot(kx, ky);
    let target = 0;
    if (kl > 1e-3) {
      const sx = tx, sy = tz * foreshorten;
      const dot = (kx * sx + ky * sy) / (kl * (Math.hypot(sx, sy) || 1));
      if (Math.abs(dot) > DEAD_ZONE) target = dot * state.pace;
    }
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
