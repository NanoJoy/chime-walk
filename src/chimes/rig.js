// Builds the chime meshes and the physical spec for a round or flat layout,
// and syncs the meshes to the physics state every frame.
import * as THREE from 'three';
import { woodTexture } from '../textures.js';

export const HOOK = new THREE.Vector3(0, 2.36, 0);
const HANGER_LENGTH = 0.24;
const TUBE_RADIUS = 0.0125;
const TUBE_STRING = 0.05;
const REF_LENGTH = 0.62; // length of the C5 tube (m); f ∝ 1/L²
const REF_FREQ = 523.25;

const TUNINGS = {
  major: { base: 523.25, steps: [0, 2, 4, 7, 9, 12, 14, 16] }, // C major pentatonic
  minor: { base: 440.0, steps: [0, 3, 5, 7, 10, 12, 15, 17] }, // A minor pentatonic
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(); // scratch for placeSegment only
const _w = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _end = new THREE.Vector3();
const _below = new THREE.Vector3();
const _q = new THREE.Quaternion();
const ROD_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const materials = {
  aluminium: new THREE.MeshPhysicalMaterial({
    color: 0xd9dcdf, metalness: 1, roughness: 0.24, side: THREE.DoubleSide,
  }),
  brass: new THREE.MeshPhysicalMaterial({
    color: 0xcfa75e, metalness: 1, roughness: 0.3, side: THREE.DoubleSide,
  }),
};

let woodMat, sailMat, cordMat, ironMat;
function sharedMaterials() {
  if (woodMat) return;
  const grain = woodTexture(28);
  woodMat = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.72, bumpMap: grain, bumpScale: 0.6 });
  const pale = woodTexture(38);
  pale.repeat.set(0.4, 0.6);
  sailMat = new THREE.MeshStandardMaterial({ map: pale, roughness: 0.8, color: 0xf2e6d0 });
  cordMat = new THREE.MeshStandardMaterial({ color: 0x3b3229, roughness: 1 });
  ironMat = new THREE.MeshStandardMaterial({ color: 0x2c2a27, metalness: 0.7, roughness: 0.55 });
}

const stringGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
function makeString(radius = 0.0011) {
  const m = new THREE.Mesh(stringGeo, cordMat);
  m.userData.radius = radius;
  m.castShadow = true;
  return m;
}

function placeSegment(mesh, a, b) {
  _v.subVectors(b, a);
  const len = _v.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, _v.divideScalar(len));
  const r = mesh.userData.radius;
  mesh.scale.set(r, len, r);
}

function tubeNotes(count, tuning) {
  const t = TUNINGS[tuning];
  return t.steps.slice(0, count).map((s) => {
    const freq = t.base * Math.pow(2, s / 12);
    return { freq, length: REF_LENGTH * Math.sqrt(REF_FREQ / freq) };
  });
}

/** opts: { layout: 'round'|'flat', count, finish, tuning } */
export function buildRig({ layout, count, finish, tuning }) {
  sharedMaterials();
  const group = new THREE.Group();
  const notes = tubeNotes(count, tuning);
  const lengths = notes.map((n) => n.length);
  const Lmin = Math.min(...lengths);
  const Lmax = Math.max(...lengths);
  const strikerL = TUBE_STRING + 0.55 * Lmin;
  const sail = { w: 0.09, h: 0.13, t: 0.006, mass: 0.03 };
  sail.area = sail.w * sail.h;
  sail.stringLen = TUBE_STRING + Lmax - strikerL + 0.05;

  const tubes = [];
  let topMesh, topThick, attach, striker, strikerMesh, strikerStringAnchors;

  if (layout === 'round') {
    const ringR = Math.max(0.08, count * 0.0145);
    const discR = ringR + 0.035;
    topThick = 0.022;
    const discGeo = new THREE.CylinderGeometry(discR, discR, topThick, 48);
    topMesh = new THREE.Mesh(discGeo, woodMat);
    attach = [0, 1, 2].map((i) => {
      const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
      return new THREE.Vector3(Math.cos(a) * discR * 0.82, topThick / 2, Math.sin(a) * discR * 0.82);
    });
    notes.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
      tubes.push({
        anchor: new THREE.Vector3(Math.cos(a) * ringR, -topThick / 2, Math.sin(a) * ringR),
        Ls: TUBE_STRING,
        Lt: n.length,
        r: TUBE_RADIUS,
        freq: n.freq,
      });
    });
    const Rc = ringR - TUBE_RADIUS - 0.02;
    const thick = 0.018;
    striker = {
      kind: 'disc',
      anchor: new THREE.Vector3(0, -topThick / 2, 0),
      L: strikerL,
      mass: Math.PI * Rc * Rc * thick * 700,
      area: 2 * Rc * thick,
      radius: Rc,
      thick,
      sail,
    };
    strikerMesh = new THREE.Mesh(new THREE.CylinderGeometry(Rc, Rc, thick, 40), woodMat);
    strikerStringAnchors = [striker.anchor];
  } else {
    const spacing = 2 * TUBE_RADIUS + 0.04;
    const span = (count - 1) * spacing;
    const barLen = span + 0.1;
    topThick = 0.035;
    topMesh = new THREE.Mesh(new THREE.BoxGeometry(barLen, topThick, 0.1), woodMat);
    attach = [-1, 1].map((s) => new THREE.Vector3(s * (barLen / 2 - 0.025), topThick / 2, 0));
    notes.forEach((n, i) => {
      tubes.push({
        anchor: new THREE.Vector3(-span / 2 + i * spacing, -topThick / 2, 0),
        Ls: TUBE_STRING,
        Lt: n.length,
        r: TUBE_RADIUS,
        freq: n.freq,
      });
    });
    const rodR = 0.008;
    const halfLen = span / 2 + 0.02;
    const z = TUBE_RADIUS + rodR + 0.022;
    striker = {
      kind: 'rod',
      anchor: new THREE.Vector3(0, -topThick / 2, z),
      L: strikerL,
      mass: Math.PI * rodR * rodR * halfLen * 2 * 700,
      area: 2 * rodR * halfLen * 2,
      radius: rodR,
      halfLen,
      sail,
    };
    strikerMesh = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, halfLen * 2, 16), woodMat);
    strikerStringAnchors = [-1, 1].map((s) => new THREE.Vector3(s * halfLen * 0.8, -topThick / 2, z));
  }

  topMesh.castShadow = topMesh.receiveShadow = true;
  strikerMesh.castShadow = true;
  group.add(topMesh, strikerMesh);

  const tubeMat = materials[finish] ?? materials.aluminium;
  const tubeMeshes = tubes.map((t) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.Lt, 28, 1, true), tubeMat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  });
  const addString = (radius) => {
    const m = makeString(radius);
    group.add(m);
    return m;
  };
  const tubeStrings = tubes.map(() => addString());
  const hangerStrings = attach.map(() => addString(0.0014));
  const strikerStrings = strikerStringAnchors.map(() => addString());
  const sailString = addString();
  const sailMesh = new THREE.Mesh(new THREE.BoxGeometry(sail.w, sail.h, sail.t), sailMat);
  sailMesh.castShadow = true;
  group.add(sailMesh);

  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 20), ironMat);
  hook.position.copy(HOOK).add(new THREE.Vector3(0, 0.012, 0));
  hook.castShadow = true;
  group.add(hook);

  const spec = {
    hook: HOOK,
    top: { L: HANGER_LENGTH, mass: layout === 'round' ? 0.45 : 0.4, area: layout === 'round' ? 0.006 : 0.014 },
    tubes,
    striker,
  };

  const toWorld = (local, top, out) => out.copy(local).applyQuaternion(top.q).add(top.x);

  function sync(state) {
    const { top } = state;
    topMesh.position.copy(top.x);
    topMesh.quaternion.copy(top.q);
    attach.forEach((a, i) => placeSegment(hangerStrings[i], HOOK, toWorld(a, top, _w)));

    state.tubes.forEach((b, i) => {
      const m = tubeMeshes[i];
      m.position.addVectors(b.seg0, b.seg1).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(UP, b.dir);
      placeSegment(tubeStrings[i], b.anchor, b.seg0);
    });

    const s = state.striker;
    strikerMesh.position.copy(s.x);
    if (s.kind === 'disc') {
      strikerMesh.quaternion.setFromUnitVectors(UP, s.dir);
      placeSegment(strikerStrings[0], s.anchor, _w.copy(s.x).addScaledVector(s.dir, -s.thick / 2));
    } else {
      strikerMesh.quaternion.copy(top.q).multiply(ROD_TURN);
      _axis.set(1, 0, 0).applyQuaternion(top.q);
      strikerStringAnchors.forEach((a, i) => {
        _end.copy(s.x).addScaledVector(_axis, a.x);
        placeSegment(strikerStrings[i], toWorld(a, top, _w), _end);
      });
    }

    // Sail hangs along the striker's string line and turns slowly about it.
    const sailTopDist = s.L + sail.stringLen;
    _w.copy(s.anchor).addScaledVector(s.dir, sailTopDist);
    _below.copy(s.x).addScaledVector(s.dir, s.kind === 'disc' ? s.thick / 2 : s.radius);
    placeSegment(sailString, _below, _w);
    sailMesh.position.copy(_w).addScaledVector(s.dir, sail.h / 2);
    sailMesh.quaternion.setFromUnitVectors(UP, s.dir);
    _q.setFromAxisAngle(UP, s.yaw);
    sailMesh.quaternion.multiply(_q);
    if (s.kind === 'disc') strikerMesh.quaternion.multiply(_q);
  }

  function setFinish(f) {
    const mat = materials[f] ?? materials.aluminium;
    for (const m of tubeMeshes) m.material = mat;
  }

  function dispose() {
    group.traverse((o) => {
      if (o.isMesh && o.geometry !== stringGeo) o.geometry.dispose();
    });
  }

  return { group, spec, tubeMeshes, freqs: tubes.map((t) => t.freq), sync, setFinish, dispose };
}
