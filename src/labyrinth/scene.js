// The labyrinth half: stone-walled generated labyrinths in a meadow, a small
// lantern-carrying walker between head-high walls, and a low camera that
// follows just behind it.
import * as THREE from 'three';
import { createEnvironment } from '../environment.js';
import { earthTexture, grassTexture, gritTexture } from '../textures.js';
import { rng } from '../noise.js';
import { buildHex, courseStones } from './geometry.js';
import { createWalker } from './walker.js';

const CAMERA_PITCH = THREE.MathUtils.degToRad(30); // above the horizontal
const LOOK_HEIGHT = 0.35; // aim at the walker's torso, not its feet
const PATH_WIDTH = 1.5; // corridor width; the walker is about 0.6 tall
const WALL_HEIGHT = 0.75; // dry-stone walls a little over head height

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

// The gritty wall filler: one box per wall segment, narrowing from `thick` at
// the foot to `thickTop`, merged, with UVs in world units (`tile` per repeat)
// so the grain is the same size on every face.
function wallCores(walls, height, thick, thickTop, tile = 0.6) {
  const pos = [], nrm = [], uv = [], index = [];
  const quad = (corners, n, uvs) => {
    const base = pos.length / 3;
    corners.forEach((c, k) => {
      pos.push(...c);
      nrm.push(...n);
      uv.push(uvs[k][0] / tile, uvs[k][1] / tile);
    });
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (const [ax, az, bx, bz] of walls) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len; // along the wall
    const nx = dz, nz = -dx; // across it
    const t = 1;
    // Corner at distance a along the wall, b across (in half-thicknesses), height y.
    const half = (y) => (thick + (thickTop - thick) * (y / height)) / 2;
    const at = (a, b, y) => [ax + dx * a + nx * b * half(y), y, az + dz * a + nz * b * half(y)];
    quad([at(0, t, 0), at(len, t, 0), at(len, t, height), at(0, t, height)], [nx, 0, nz],
      [[0, 0], [len, 0], [len, height], [0, height]]);
    quad([at(len, -t, 0), at(0, -t, 0), at(0, -t, height), at(len, -t, height)], [-nx, 0, -nz],
      [[len, 0], [0, 0], [0, height], [len, height]]);
    quad([at(0, t, height), at(len, t, height), at(len, -t, height), at(0, -t, height)], [0, 1, 0],
      [[0, 0], [len, 0], [len, thickTop], [0, thickTop]]);
    quad([at(0, -t, 0), at(0, t, 0), at(0, t, height), at(0, -t, height)], [-dx, 0, -dz],
      [[0, 0], [thick, 0], [thickTop, height], [0, height]]);
    quad([at(len, t, 0), at(len, -t, 0), at(len, -t, height), at(len, t, height)], [dx, 0, dz],
      [[0, 0], [thick, 0], [thickTop, height], [0, height]]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

// A rough-split building stone: a unit box with its corners and edges knocked
// back by random amounts and its faces bulged a little. Vertices are keyed by
// position so the faces sharing a vertex move together and the stone stays closed.
function blockGeometry(seed, segments = 2) {
  const r = rng(seed);
  const geo = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const moved = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!moved.has(key)) {
      const onFaces = [v.x, v.y, v.z].filter((c) => Math.abs(c) > 0.499).length;
      const out = v.clone();
      if (onFaces === 3) out.multiplyScalar(segments > 1 ? 0.7 + r() * 0.2 : 0.88 + r() * 0.12); // knocked-off corner
      else if (onFaces === 2) out.multiplyScalar(0.85 + r() * 0.15); // worn edge
      else out.multiplyScalar(1.04 + r() * 0.08); // bulging face
      out.x += (r() - 0.5) * 0.06;
      out.y += (r() - 0.5) * 0.06;
      out.z += (r() - 0.5) * 0.06;
      moved.set(key, out);
    }
    v.copy(moved.get(key));
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

  const env = createEnvironment(renderer, scene, { fogDensity: 0.011, shadowExtent: 7, shadowDistance: 30 });

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

  // Materials and the stone shapes are shared by every layout; geometry is per layout.
  const earth = earthTexture();
  const vergeMat = new THREE.MeshStandardMaterial({ map: earth, color: 0x9a9a72, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  const pathMat = new THREE.MeshStandardMaterial({ map: earth, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xffe3b0, transparent: true, opacity: 0.45, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3,
  });
  const blocks = [11, 12, 13, 14, 15].map((seed) => blockGeometry(seed));
  const slabs = [21, 22, 23].map((seed) => blockGeometry(seed, 1)); // cope stones: thin, so simpler
  const shared = new Set([...blocks, ...slabs]);
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const grit = gritTexture();
  // Dark, so the gaps between stones read as shadow rather than filler.
  const coreMat = new THREE.MeshStandardMaterial({ map: grit, color: 0x5c5850, bumpMap: grit, bumpScale: 1.5, roughness: 1 });
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
    lab = buildHex({ R, mix: MIX, seed: index + 1, w: PATH_WIDTH });

    const group = new THREE.Group();
    // Worn verge, then packed earth down the middle of the path.
    const verge = new THREE.Mesh(ribbon(lab, 0.47 * lab.w, 0.004), vergeMat);
    const path = new THREE.Mesh(ribbon(lab, 0.3 * lab.w, 0.008), pathMat);
    verge.receiveShadow = path.receiveShadow = true;
    group.add(verge, path);

    // The walked trail, drawn up to the walker.
    trailGeo = ribbon(lab, 0.07, 0.014, 4);
    trailGeo.setDrawRange(0, 0);
    group.add(new THREE.Mesh(trailGeo, trailMat));

    // Walls: coursed dry stone round a dark core that fills the gaps between them.
    // About 33k stones at the largest size.
    const { stones, top } = courseStones(lab, { height: WALL_HEIGHT, seed: 7 + index });
    const core = new THREE.Mesh(wallCores(lab.walls, top, 0.2, 0.12), coreMat);
    core.castShadow = core.receiveShadow = true;
    group.add(core);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ'); // yaw onto the wall, then lean, then roll
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const tint = new THREE.Color();

    // Deal the stones out among the shapes, then fill one instanced mesh per shape.
    const r = rng(19 + index);
    const byShape = new Map([...blocks, ...slabs].map((g) => [g, []]));
    for (const st of stones) {
      const pool = st.kind === 'cope' ? slabs : blocks;
      byShape.get(pool[Math.floor(r() * pool.length)]).push(st);
    }
    for (const [geo, list] of byShape) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, stoneMat, list.length);
      list.forEach((st, i) => {
        q.setFromEuler(e.set(st.lean, st.yaw, st.roll));
        m.compose(p.set(st.x, st.y, st.z), q, sc.set(st.sx, st.sy, st.sz));
        mesh.setMatrixAt(i, m);
        const ochre = r() < 0.2;
        const light = (st.kind === 'cope' ? 0.2 : 0.25) + r() * 0.2;
        mesh.setColorAt(i, tint.setHSL(ochre ? 0.08 + r() * 0.03 : 0.1 + r() * 0.05, ochre ? 0.22 : 0.03 + r() * 0.07, light));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }

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
        if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
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
  const view = { distance: 2.3 };
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
    env.focus(target);
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
