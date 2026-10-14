// Wind chime dynamics.
//
// The top piece (disc or bar) is a heavy pendulum hanging from a hook.
// Each tube and the striker is a rigid pendulum hanging from an anchor on the
// top piece, reduced to one particle at distance L from its anchor. It is
// integrated with position projection: integrate, project back onto the sphere
// |x - anchor| = L, then derive velocity from the change in position.
// Collisions are capsule-vs-capsule, with lever arms so a hit far down a tube
// moves it the right amount.
import * as THREE from 'three';
import { noise1 } from '../noise.js';

const GRAVITY = new THREE.Vector3(0, -9.81, 0);
const RHO_AIR = 1.2;
const DRAG_COEFF = 1.1;
const RESTITUTION = 0.55;
const STRIKE_THRESHOLD = 0.03; // m/s of approach speed at the contact point; below this, contacts are resting
const STRIKE_COOLDOWN = 0.07; // s per pair
const ALUMINIUM = { density: 2700, wall: 0.0012 };
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function closestSegSeg(p1, q1, p2, q2, c1, c2) {
  const d1 = _a.subVectors(q1, p1);
  const d2 = _b.subVectors(q2, p2);
  const r = _u.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) {
    s = t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
}

function makeBody(anchorLocal, L, mEq, gScale, sails, damping) {
  return {
    anchorLocal,
    L,
    m: mEq,
    gScale,
    sails, // [{ area, lever }] wind-catching surfaces, at lever = distance / L
    damping,
    x: new THREE.Vector3(),
    v: new THREE.Vector3(),
    xprev: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    dir: new THREE.Vector3(0, -1, 0),
    seg0: new THREE.Vector3(),
    seg1: new THREE.Vector3(),
    radius: 0,
  };
}

/**
 * spec: {
 *   hook: Vector3,
 *   top: { L, mass, area },
 *   tubes: [{ anchor, Ls, Lt, r }],
 *   striker: { kind: 'disc'|'rod', anchor, L, mass, area, radius, thick?, halfLen?,
 *              sail: { stringLen, h, mass, area } },
 * }
 */
export function createPhysics(spec, { onStrike, time: startTime = 0 } = {}) {
  const top = {
    L: spec.top.L,
    m: spec.top.mass,
    area: spec.top.area,
    x: spec.hook.clone().addScaledVector(DOWN, spec.top.L),
    v: new THREE.Vector3(),
    xprev: new THREE.Vector3(),
    yaw: 0,
    yawV: 0,
    q: new THREE.Quaternion(),
  };

  const tubes = spec.tubes.map((t) => {
    const m = 2 * Math.PI * t.r * ALUMINIUM.wall * t.Lt * ALUMINIUM.density;
    const L = t.Ls + t.Lt / 2;
    const I = m * (L * L + (t.Lt * t.Lt) / 12);
    const mEq = I / (L * L);
    const body = makeBody(t.anchor, L, mEq, m / mEq, [{ area: 2 * t.r * t.Lt, lever: 1 }], 0.12);
    body.kind = 'tube';
    body.Ls = t.Ls;
    body.Lt = t.Lt;
    body.radius = t.r;
    return body;
  });

  const s = spec.striker;
  const sailDist = s.L + s.sail.stringLen + s.sail.h / 2;
  const lever = sailDist / s.L;
  const I = s.mass * s.L * s.L + s.sail.mass * sailDist * sailDist;
  const mEq = I / (s.L * s.L);
  const gScale = (s.mass * s.L + s.sail.mass * sailDist) / (mEq * s.L);
  const striker = makeBody(
    s.anchor,
    s.L,
    mEq,
    gScale,
    [{ area: s.area, lever: 1 }, { area: s.sail.area, lever }],
    0.25,
  );
  striker.kind = s.kind;
  striker.radius = s.radius;
  striker.thick = s.thick ?? 0;
  striker.halfLen = s.halfLen ?? 0;
  striker.yaw = 0;
  striker.yawV = 0;

  const bodies = [...tubes, striker];
  const pairs = [];
  for (let i = 0; i < tubes.length; i++) pairs.push({ a: striker, b: tubes[i], ib: i, ia: -1, last: -1 });
  for (let i = 0; i < tubes.length; i++)
    for (let j = i + 1; j < tubes.length; j++) pairs.push({ a: tubes[i], b: tubes[j], ia: i, ib: j, last: -1 });

  let time = startTime;
  const wind = new THREE.Vector3();
  const contacts = [];
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const n = new THREE.Vector3();

  function updateTopFrame() {
    _d.subVectors(top.x, spec.hook).normalize();
    top.q.setFromUnitVectors(DOWN, _d);
    _q.setFromAxisAngle(UP, top.yaw);
    top.q.multiply(_q);
  }

  function updateAnchor(b) {
    b.anchor.copy(b.anchorLocal).applyQuaternion(top.q).add(top.x);
  }

  function project(b) {
    _d.subVectors(b.x, b.anchor);
    const len = _d.length() || 1;
    b.dir.copy(_d).divideScalar(len);
    b.x.copy(b.anchor).addScaledVector(b.dir, b.L);
  }

  function updateSegment(b) {
    if (b.kind === 'tube') {
      b.seg0.copy(b.anchor).addScaledVector(b.dir, b.Ls);
      b.seg1.copy(b.anchor).addScaledVector(b.dir, b.Ls + b.Lt);
    } else if (b.kind === 'disc') {
      b.seg0.copy(b.x).addScaledVector(b.dir, -b.thick / 2);
      b.seg1.copy(b.x).addScaledVector(b.dir, b.thick / 2);
    } else {
      // A rod on two parallel strings stays parallel to the top piece's x axis.
      _d.set(1, 0, 0).applyQuaternion(top.q);
      b.seg0.copy(b.x).addScaledVector(_d, -b.halfLen);
      b.seg1.copy(b.x).addScaledVector(_d, b.halfLen);
    }
  }

  // Ratio of the contact point's distance from the anchor to the particle's.
  function leverAt(b, c) {
    if (b.kind !== 'tube') return 1;
    return Math.max(0.2, _d.subVectors(c, b.anchor).dot(b.dir) / b.L);
  }

  function dragForce(windVel, pointVel, area, out) {
    _u.subVectors(windVel, pointVel);
    return out.copy(_u).multiplyScalar(0.5 * RHO_AIR * DRAG_COEFF * area * _u.length());
  }

  function step(h, windAt) {
    time += h;

    // Top piece.
    windAt(top.x, time, -1, wind);
    dragForce(wind, top.v, top.area, _f);
    top.v.addScaledVector(_f, h / top.m).addScaledVector(GRAVITY, h);
    top.v.multiplyScalar(1 - 0.6 * h);
    top.xprev.copy(top.x);
    top.x.addScaledVector(top.v, h);
    _d.subVectors(top.x, spec.hook).normalize();
    top.x.copy(spec.hook).addScaledVector(_d, top.L);
    top.v.subVectors(top.x, top.xprev).divideScalar(h);
    const ws = wind.length();
    const yawTorque = ws * ws * 0.004 * (noise1(time * 0.4 + 11) - 0.5);
    top.yawV += (-1.2 * top.yaw - 0.4 * top.yawV + yawTorque) * h;
    top.yaw += top.yawV * h;
    updateTopFrame();

    // Hanging bodies.
    bodies.forEach((b, i) => {
      updateAnchor(b);
      windAt(b.x, time, i, wind);
      const force = _f.set(0, 0, 0);
      for (const sail of b.sails) {
        const pointVel = c1.copy(b.v).multiplyScalar(sail.lever);
        dragForce(wind, pointVel, sail.area, c2);
        force.addScaledVector(c2, sail.lever);
      }
      b.v.addScaledVector(force, h / b.m).addScaledVector(GRAVITY, h * b.gScale);
      b.v.multiplyScalar(1 - b.damping * h);
      b.xprev.copy(b.x);
      b.x.addScaledVector(b.v, h);
      project(b);
    });

    // The sail turns slowly in the wind (visual only).
    const sw = wind.length();
    const sailTorque = sw * sw * 0.02 * (noise1(time * 0.6 + 3) - 0.5);
    striker.yawV += (-3 * striker.yaw - 0.5 * striker.yawV + sailTorque) * h;
    striker.yaw += striker.yawV * h;

    // Collisions: two position passes, recording approach speed on first contact.
    contacts.length = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of bodies) updateSegment(b);
      for (const p of pairs) {
        const A = p.a, B = p.b;
        closestSegSeg(A.seg0, A.seg1, B.seg0, B.seg1, c1, c2);
        n.subVectors(c1, c2);
        const dist = n.length();
        const minDist = A.radius + B.radius;
        if (dist >= minDist || dist < 1e-9) continue;
        n.divideScalar(dist);
        const kA = leverAt(A, c1);
        const kB = leverAt(B, c2);
        const wA = (kA * kA) / A.m;
        const wB = (kB * kB) / B.m;
        let contact = contacts.find((c) => c.pair === p);
        if (!contact) {
          const vn = _a.copy(A.v).multiplyScalar(kA).addScaledVector(B.v, -kB).dot(n);
          contact = { pair: p, n: n.clone(), kA, kB, wA, wB, vnPre: vn };
          contacts.push(contact);
        }
        const pen = minDist - dist;
        const share = pen / (wA + wB);
        A.x.addScaledVector(n, (share * wA) / kA);
        B.x.addScaledVector(n, (-share * wB) / kB);
        project(A);
        project(B);
      }
    }

    for (const b of bodies) b.v.subVectors(b.x, b.xprev).divideScalar(h);

    // Restitution: set the separating speed from the approach speed.
    for (const c of contacts) {
      const A = c.pair.a, B = c.pair.b;
      if (c.vnPre >= 0) continue;
      const vnNow = _a.copy(A.v).multiplyScalar(c.kA).addScaledVector(B.v, -c.kB).dot(c.n);
      const target = -RESTITUTION * c.vnPre;
      const J = (target - vnNow) / (c.wA + c.wB);
      A.v.addScaledVector(c.n, (J * c.kA) / A.m);
      B.v.addScaledVector(c.n, (-J * c.kB) / B.m);

      const speed = -c.vnPre;
      const p = c.pair;
      if (speed > STRIKE_THRESHOLD && time - p.last > STRIKE_COOLDOWN && onStrike) {
        p.last = time;
        if (p.ia >= 0) onStrike(p.ia, speed);
        onStrike(p.ib, speed);
      }
    }
  }

  // Settle into the rest pose.
  updateTopFrame();
  for (const b of bodies) {
    updateAnchor(b);
    b.x.copy(b.anchor).addScaledVector(DOWN, b.L);
    b.xprev.copy(b.x);
    project(b);
    updateSegment(b);
  }

  return { step, top, tubes, striker, bodies };
}
