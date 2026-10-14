// The labyrinth half: stone-lined generated labyrinths in a meadow, a small
// lantern-carrying walker, and a low camera that follows just behind it.
import * as THREE from 'three';
import { createEnvironment } from '../environment.js';
import { earthTexture, grassTexture } from '../textures.js';
import { rng } from '../noise.js';
import { buildHex, wallStones } from './geometry.js';
import { createWalker } from './walker.js';

const CAMERA_PITCH = THREE.MathUtils.degToRad(18); // above the horizontal
const LOOK_HEIGHT = 0.35; // aim at the walker's torso, not its feet

function ribbon(lab, halfWidth, y, everyN = 2) {
  const idx = [];
  for (let i = 0; i < lab.count; i += everyN) idx.push(i);
  if (idx.at(-1) !== lab.count - 1) idx.push(lab.count - 1);
  const pos = new Float32Array(idx.length * 2 * 3);
  const uv = new Float32Array(idx.length * 2 * 2);
  // Signed turn rate over a short window, so the inside edge of a tight bend
  // can be pulled in rather than folding back over itself.
  const span = 3;
  const heading = (i) => {
    const [tx, tz] = lab.tangentAt(Math.min(Math.max(i, 0), lab.count - 1));
    return Math.atan2(tz, tx);
  };
  idx.forEach((i, k) => {
    const [tx, tz] = lab.tangentAt(i);
    const nx = -tz, nz = tx;
    let turn = heading(i + span) - heading(i - span);
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const ds = lab.cum[Math.min(i + span, lab.count - 1)] - lab.cum[Math.max(i - span, 0)] || 1;
    const inner = Math.abs(turn) > 1e-6 ? Math.min(halfWidth, (0.9 * ds) / Math.abs(turn)) : halfWidth;
    const left = turn > 0 ? inner : halfWidth;
    const right = turn < 0 ? inner : halfWidth;
    pos.set([lab.xs[i] + nx * left, y, lab.zs[i] + nz * left], k * 6);
    pos.set([lab.xs[i] - nx * right, y, lab.zs[i] - nz * right], k * 6 + 3);
    const v = lab.cum[i] / (halfWidth * 4);
    uv.set([0, v, 1, v], k * 4);
  });
  const index = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Arc length at each segment start, for partial drawing.
  geo.userData.segmentS = idx.map((i) => lab.cum[i]);
  return geo;
}

function rockGeometry(seed) {
  const r = rng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // Displace by direction so shared vertices move together and the rock stays closed.
  const offsets = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.78 + r() * 0.4);
    v.multiplyScalar(offsets.get(key));
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3; // flatter underside, sits on the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeWalkerFigure() {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe6dac4, roughness: 0.9 });
  const robe = new THREE.Mesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.15, 0),
      new THREE.Vector2(0.13, 0.12),
      new THREE.Vector2(0.095, 0.32),
      new THREE.Vector2(0.075, 0.44),
      new THREE.Vector2(0.03, 0.48),
      new THREE.Vector2(0.0, 0.48),
    ], 20),
    cloth,
  );
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), cloth);
  head.position.y = 0.53;
  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc46b, emissiveIntensity: 2.2 }),
  );
  lantern.position.set(0.11, 0.26, 0.07);
  const light = new THREE.PointLight(0xffc98a, 1.4, 3, 2);
  light.position.copy(lantern.position);
  for (const m of [robe, head]) m.castShadow = m.receiveShadow = true;
  group.add(robe, head, lantern, light);
  return { group, lantern, light };
}

// The walk goes through a run of generated labyrinths, one size up each time
// the centre is reached; after the largest it keeps offering new ones.
const RADII = [2, 3, 4, 5, 6, 7, 8, 9];
const MIX = 2;

export function createLabyrinth(renderer, pane, bus) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 600);

  const env = createEnvironment(renderer, scene, { fogDensity: 0.011, shadowExtent: 11.5, shadowDistance: 30 });
  env.focus(new THREE.Vector3(0, 0, 0.8));

  // Meadow.
  const grass = grassTexture();
  grass.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xdfe2c4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Materials and the rock shape are shared by every layout; geometry is per layout.
  const earth = earthTexture();
  const vergeMat = new THREE.MeshStandardMaterial({ map: earth, color: 0x9a9a72, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  const pathMat = new THREE.MeshStandardMaterial({ map: earth, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xffe3b0, transparent: true, opacity: 0.45, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3,
  });
  const rock = rockGeometry(4);
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  // Centre stone, which glows softly on arrival.
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xbab3a4, roughness: 0.85, emissive: 0xffd9a0, emissiveIntensity: 0 });

  const figure = makeWalkerFigure();
  scene.add(figure.group);

  let level = 0;
  let lab = null;
  let layout = null;
  let trailGeo = null;
  let walker = null;

  function buildLayout(index) {
    const R = RADII[Math.min(index, RADII.length - 1)];
    lab = buildHex({ R, mix: MIX, seed: index + 1 });

    const group = new THREE.Group();
    // Worn verge, then packed earth down the middle of the path.
    const verge = new THREE.Mesh(ribbon(lab, 0.47, 0.004), vergeMat);
    const path = new THREE.Mesh(ribbon(lab, 0.36, 0.008), pathMat);
    verge.receiveShadow = path.receiveShadow = true;
    group.add(verge, path);

    // The walked trail, drawn up to the walker.
    trailGeo = ribbon(lab, 0.07, 0.014, 4);
    trailGeo.setDrawRange(0, 0);
    group.add(new THREE.Mesh(trailGeo, trailMat));

    // Stones.
    const stones = wallStones(lab);
    const r = rng(19 + index);
    const stoneMesh = new THREE.InstancedMesh(rock, stoneMat, stones.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const tint = new THREE.Color();
    stones.forEach((st, i) => {
      const s = 0.085 + r() * 0.05;
      sc.set(s * (0.9 + r() * 0.4), s * (0.55 + r() * 0.45), s * (0.9 + r() * 0.4));
      q.setFromEuler(e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3));
      m.compose(p.set(st.x, sc.y * 0.3, st.z), q, sc);
      stoneMesh.setMatrixAt(i, m);
      const ochre = r() < 0.25;
      stoneMesh.setColorAt(i, tint.setHSL(ochre ? 0.08 + r() * 0.03 : 0.1 + r() * 0.05, ochre ? 0.22 : 0.03 + r() * 0.07, 0.24 + r() * 0.2));
    });
    stoneMesh.castShadow = stoneMesh.receiveShadow = true;
    group.add(stoneMesh);

    // A hexagonal slab filling the centre cell, turned to match its walls.
    const rad = lab.cellRadius * 0.82;
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.04, 0.06, 6), slabMat);
    slab.position.y = 0.03;
    slab.rotation.y = lab.centreTurn;
    slab.receiveShadow = true;
    group.add(slab);

    if (layout) {
      scene.remove(layout);
      layout.traverse((o) => {
        if (o.geometry && o.geometry !== rock) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
    }
    layout = group;
    scene.add(layout);

    if (walker) walker.reset(lab.length);
    else walker = createWalker(lab.length);
    lab.pointAt(0, pt);
    yaw = Math.atan2(pt.tx, pt.tz);
    arrived = false;
    readyToMoveOn = false;
    lastS = -1;
  }

  // Camera rig.
  const view = { distance: 2.4 };
  const target = new THREE.Vector3();
  const pt = {};
  let yaw = 0;
  let bob = 0;
  let glow = 0;
  let arrived = false;
  let readyToMoveOn = false;
  let lastS = -1;
  let status = '';

  buildLayout(level);
  lab.pointAt(0, pt);
  target.set(pt.x, LOOK_HEIGHT, pt.z);

  pane.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    view.distance = THREE.MathUtils.clamp(view.distance * Math.exp(ev.deltaY * 0.0012), 1.2, 10);
  }, { passive: false });

  function statusText(s, ring) {
    const name = `Labyrinth ${level + 1}`;
    if (s <= 0.01) return `${name} · At the entrance`;
    if (s >= lab.length - 0.05) {
      const next = level + 1 < RADII.length ? 'walk on for a larger one' : 'walk on for another';
      return `${name} · The centre · ${next}`;
    }
    const pct = Math.round((s / lab.length) * 100);
    if (ring > lab.R) return `${name} · Entering · ${pct}%`;
    if (ring === 0) return `${name} · Approaching the centre · ${pct}%`;
    return `${name} · Ring ${ring} of ${lab.R} · ${pct}%`;
  }

  function setLevel(index) {
    level = Math.max(0, index);
    buildLayout(level);
  }

  function update(dt) {
    lab.pointAt(walker.state.s, pt);
    const w = walker.update(dt, pt.tx, pt.tz);
    lab.pointAt(w.s, pt);

    // Face the direction of travel; ease the turn so U-bends feel unhurried.
    if (Math.abs(w.v) > 0.02) {
      const want = Math.atan2(pt.tx * Math.sign(w.v), pt.tz * Math.sign(w.v));
      let d = want - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * (1 - Math.exp(-dt * 6));
    }
    bob += Math.abs(w.v) * dt * 9;
    figure.group.position.set(pt.x, Math.abs(Math.sin(bob)) * 0.018, pt.z);
    figure.group.rotation.y = yaw;

    // Light the trail behind the walker.
    const segS = trailGeo.userData.segmentS;
    let k = 0;
    while (k < segS.length - 1 && segS[k + 1] <= w.s) k++;
    trailGeo.setDrawRange(0, k * 6);

    // Arrival.
    const atCentre = w.s >= lab.length - 0.05;
    glow += ((atCentre ? 1 : 0) - glow) * (1 - Math.exp(-dt * 0.8));
    slabMat.emissiveIntensity = glow * 0.35;
    figure.light.intensity = 1.4 + glow * 1.6;
    if (atCentre && !arrived) bus.emit('labyrinth:arrived', { level, radius: lab.R });
    arrived = atCentre;

    // Rest at the centre, then a fresh step forward starts the next labyrinth.
    const forward = walker.input.active;
    if (!atCentre) readyToMoveOn = false;
    else if (!forward && glow > 0.6) readyToMoveOn = true;
    else if (forward && readyToMoveOn) {
      setLevel(level + 1);
      return;
    }

    if (w.s !== lastS) {
      lastS = w.s;
      bus.emit('labyrinth:progress', { s: w.s, length: lab.length, circuit: pt.circuit, level });
    }
    status = statusText(w.s, pt.circuit);

    // Follow camera: fixed north bearing, low and just behind (south of) the walker, soft lag.
    target.lerp(scratch.set(pt.x, LOOK_HEIGHT, pt.z), 1 - Math.exp(-dt * 3));
    camera.position.set(
      target.x,
      target.y + view.distance * Math.sin(CAMERA_PITCH),
      target.z + view.distance * Math.cos(CAMERA_PITCH),
    );
    camera.lookAt(target);
  }
  const scratch = new THREE.Vector3();

  function resize(wd, ht) {
    camera.aspect = wd / ht;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    update,
    resize,
    setLevel,
    view,
    get lab() {
      return lab;
    },
    get walker() {
      return walker;
    },
    get level() {
      return level;
    },
    get status() {
      return status;
    },
  };
}
