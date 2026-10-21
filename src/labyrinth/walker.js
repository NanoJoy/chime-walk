// Turns input into slow, eased motion over the ground.
//
// WASD or the arrow keys walk in screen directions; the camera faces north,
// so that is x east and z south on the ground. Walls are left to the caller's
// collide(x, z), which pushes a point back out of them.
export function createWalker(x = 0, z = 0) {
  const held = new Set();
  const input = { active: false };
  const state = { x, z, vx: 0, vz: 0, pace: 0.9 }; // pace in world units per second

  const dirs = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const MAX_STEP = 0.05; // sub-step length, well under a wall's thickness
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

  /** Advances by dt seconds; collide(x, z) returns [x, z] clear of the walls. */
  function update(dt, collide) {
    let kx = 0, ky = 0;
    for (const code of held) {
      kx += dirs[code][0];
      ky += dirs[code][1];
    }
    const kl = Math.hypot(kx, ky);
    const tx = kl > 1e-3 ? (kx / kl) * state.pace : 0;
    const tz = kl > 1e-3 ? (ky / kl) * state.pace : 0;
    // Ease in and out: start like a first step, settle like a breath.
    const k = 1 - Math.exp(-dt * (kl > 1e-3 ? 5 : 7));
    state.vx += (tx - state.vx) * k;
    state.vz += (tz - state.vz) * k;
    if (Math.hypot(state.vx, state.vz) < 1e-4 && kl <= 1e-3) state.vx = state.vz = 0;

    const dist = Math.hypot(state.vx, state.vz) * dt;
    if (dist === 0) return state;
    const n = Math.ceil(dist / MAX_STEP);
    const x0 = state.x, z0 = state.z;
    let x = x0, z = z0;
    for (let i = 0; i < n; i++) {
      [x, z] = collide(x + (state.vx * dt) / n, z + (state.vz * dt) / n);
    }
    // Keep only the motion that happened, so pushing into a wall slides along it.
    state.vx = (x - x0) / dt;
    state.vz = (z - z0) / dt;
    state.x = x;
    state.z = z;
    return state;
  }

  /** Stands still at (x, z). */
  function reset(nx, nz) {
    state.x = nx;
    state.z = nz;
    state.vx = state.vz = 0;
  }

  return { state, input, update, reset };
}
