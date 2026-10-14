// Wind field around the chimes: a movable source, gusts, per-body turbulence,
// a glowing handle the user can drag, and drifting motes that show the flow.
import * as THREE from 'three';
import { noise1, fbm1 } from '../noise.js';
import { softSprite } from '../textures.js';

const MIN_DIST = 0.35;
export const MAX_DIST = 4;
const MOTES = 420;

export const PRESETS = {
  calm: { strength: 2.6, gustiness: 0.4 },
  breezy: { strength: 4, gustiness: 0.5 },
  stormy: { strength: 6.5, gustiness: 0.85 },
};

export function createWind(scene, center) {
  const state = {
    // Source position relative to the chime centre, on the horizontal plane.
    offset: new THREE.Vector2(-1.25, -0.45),
    strength: 4,
    gustiness: 0.5,
  };
  const dir = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _out = new THREE.Vector3();

  function sourceWorld(out) {
    return out.set(center.x + state.offset.x, center.y, center.z + state.offset.y);
  }

  // Overall gust envelope at time t, around 1.
  function gustAt(t) {
    const g = state.gustiness;
    const n = fbm1(t * 0.21, 3);
    const lull = noise1(t * 0.05 + 9);
    return Math.max(0.04, 1 + g * 2.2 * (n - 0.5) - g * 0.6 * Math.max(0, 0.45 - lull));
  }

  /** Wind velocity (m/s) at world position `pos` and time `t`. `seed` decorrelates bodies. */
  function windAt(pos, t, seed, out) {
    const g = state.gustiness;
    const sx = center.x + state.offset.x;
    const sz = center.z + state.offset.y;
    // Blow from the source toward the chimes, wandering a little with gusts.
    const wobble = g * 0.7 * (noise1(t * 0.13 + 50) - 0.5);
    const base = Math.atan2(center.z - sz, center.x - sx) + wobble;
    const dx = pos.x - sx, dz = pos.z - sz;
    const d2 = dx * dx + dz * dz;
    const falloff = 1.25 / (1 + 0.14 * d2);
    const speed = state.strength * falloff * gustAt(t);
    out.set(Math.cos(base) * speed, 0, Math.sin(base) * speed);
    const turb = speed * (0.18 + 0.4 * g);
    const k = seed * 7.31;
    out.x += turb * (noise1(t * 1.3 + k) - 0.5);
    out.y += turb * 0.35 * (noise1(t * 1.1 + k + 20) - 0.5);
    out.z += turb * (noise1(t * 1.5 + k + 40) - 0.5);
    return out;
  }

  // Handle: a soft glow with an invisible, larger sphere for picking.
  const sprite = softSprite();
  const handle = new THREE.Group();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sprite, color: 0xffcf7a, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  }));
  glow.scale.setScalar(0.3);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sprite, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  }));
  core.scale.setScalar(0.07);
  const pick = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial());
  pick.visible = false;
  handle.add(glow, core, pick);
  scene.add(handle);

  // Faint mark on the ground under the source, to read its position in depth.
  const marker = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 32),
    new THREE.MeshBasicMaterial({ map: sprite, color: 0xfff6e4, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.01;
  scene.add(marker);

  // Motes: dust and pollen carried by the wind.
  const pos = new Float32Array(MOTES * 3);
  const col = new Float32Array(MOTES * 4);
  const motes = Array.from({ length: MOTES }, (_, i) => ({ age: 0, life: 0, seed: i * 0.37 + 100, alive: false }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: sprite, size: 0.014, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
  points.frustumCulled = false;
  scene.add(points);

  let spawnDebt = 0;
  const _src = new THREE.Vector3();

  function spawn(i) {
    const m = motes[i];
    sourceWorld(_src);
    dir.set(center.x - _src.x, 0, center.z - _src.z).normalize();
    // Random point on a disc facing the chimes, slightly behind the source.
    const r = 0.45 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const back = 0.2 * Math.random();
    pos[i * 3] = _src.x - dir.z * Math.cos(a) * r - dir.x * back;
    pos[i * 3 + 1] = _src.y + Math.sin(a) * r * 0.8;
    pos[i * 3 + 2] = _src.z + dir.x * Math.cos(a) * r - dir.z * back;
    m.age = 0;
    m.life = 3 + Math.random() * 4;
    m.alive = true;
    const warm = Math.random();
    col[i * 4] = 1;
    col[i * 4 + 1] = 0.94 + warm * 0.05;
    col[i * 4 + 2] = 0.82 + warm * 0.12;
  }

  function update(dt, t) {
    const gust = gustAt(t);
    sourceWorld(handle.position);
    marker.position.x = handle.position.x;
    marker.position.z = handle.position.z;
    const breathe = 1 + 0.12 * Math.sin(t * 2.1) + 0.25 * (gust - 1);
    glow.scale.setScalar(0.3 * breathe);

    // Spawn more motes in stronger wind.
    spawnDebt += dt * state.strength * gust * 9;
    for (let i = 0; i < MOTES && spawnDebt >= 1; i++) {
      if (!motes[i].alive) {
        spawn(i);
        spawnDebt -= 1;
      }
    }
    spawnDebt = Math.min(spawnDebt, 5);

    for (let i = 0; i < MOTES; i++) {
      const m = motes[i];
      if (!m.alive) {
        col[i * 4 + 3] = 0;
        continue;
      }
      m.age += dt;
      if (m.age > m.life) {
        m.alive = false;
        col[i * 4 + 3] = 0;
        continue;
      }
      _p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      windAt(_p, t, m.seed, _out);
      // Shown slower than the true wind so the eye can follow the drift.
      const v = 0.16;
      pos[i * 3] += (_out.x * v + 0.03 * (noise1(t * 0.9 + m.seed) - 0.5)) * dt;
      pos[i * 3 + 1] += (_out.y * v + 0.05 * (noise1(t * 0.7 + m.seed + 5) - 0.5)) * dt;
      pos[i * 3 + 2] += (_out.z * v + 0.03 * (noise1(t * 0.8 + m.seed + 9) - 0.5)) * dt;
      const f = m.age / m.life;
      col[i * 4 + 3] = 0.55 * Math.min(1, m.age * 2) * Math.min(1, (1 - f) * 4);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  function setOffset(x, z) {
    const len = Math.hypot(x, z);
    const clamped = THREE.MathUtils.clamp(len, MIN_DIST, MAX_DIST);
    if (len < 1e-6) state.offset.set(0, clamped);
    else state.offset.set((x / len) * clamped, (z / len) * clamped);
  }

  return { state, windAt, update, setOffset, handle, pick, gustAt };
}
