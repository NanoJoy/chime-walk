// Labyrinth layouts, each built as one walkable centreline: the classical
// (Cretan) 7-circuit below, and generated hex layouts further down (buildHex).
//
// Circuits are numbered 1 (outermost) to 7 (innermost). The walk visits them in
// the order 3 → 2 → 1 → 4 → 7 → 6 → 5 → centre, reversing direction each time.
// The entrance and the way into the centre both lie on the axis θ = 0 (+z).
// Every turn is a 180° semicircle beside the axis. Turns on the same side are
// concentric: right side 2↔3 inside 1↔4, plus 6↔7; left side 1↔2, plus 5↔6
// inside 4↔7.
//
// Angles are measured from +z toward +x: point = (r·sinθ, r·cosθ) as (x, z).

import { backbiteLabyrinth, outline, walls } from './hexgen.js';

const TAU = Math.PI * 2;

export function buildClassical7({ w = 1, centre = 1.6, step = 0.04, smoothing = 0.18 } = {}) {
  const r = (k) => centre + (7 - k + 0.5) * w;
  const outer = centre + 7 * w;
  const margin = 0.1 * w;

  // A turn group's centre radius and how far from the axis it must sit so its
  // outermost semicircle clears the axis corridor.
  const turnAngle = (rc, rhoOuter) => Math.asin((rhoOuter + w + margin) / rc);
  const phiA = -turnAngle((r(1) + r(4)) / 2, 1.5 * w); // right: 2↔3 inside 1↔4
  const phiB = -turnAngle((r(6) + r(7)) / 2, 0.5 * w); // right: 6↔7
  const phiC = turnAngle((r(1) + r(2)) / 2, 0.5 * w); // left: 1↔2
  const phiD = turnAngle((r(4) + r(7)) / 2, 1.5 * w); // left: 5↔6 inside 4↔7

  const raw = [];
  const push = (x, z, c) => {
    const last = raw[raw.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < 1e-9) return;
    raw.push({ x, z, c });
  };
  const fine = step / 2;

  function radial(r0, r1, th, c) {
    const n = Math.max(1, Math.ceil(Math.abs(r1 - r0) / fine));
    for (let i = 0; i <= n; i++) {
      const rad = r0 + ((r1 - r0) * i) / n;
      push(rad * Math.sin(th), rad * Math.cos(th), c);
    }
  }

  function arc(rad, th0, th1, c) {
    const n = Math.max(1, Math.ceil((Math.abs(th1 - th0) * rad) / fine));
    for (let i = 0; i <= n; i++) {
      const th = th0 + ((th1 - th0) * i) / n;
      push(rad * Math.sin(th), rad * Math.cos(th), c);
    }
  }

  // Semicircle from radius ra to rb at angle phi, bulging in travel direction s (±1).
  function uturn(phi, ra, rb, s, c) {
    const rc = (ra + rb) / 2;
    const rho = Math.abs(ra - rb) / 2;
    const ux = Math.sin(phi), uz = Math.cos(phi);
    const sign = Math.sign(ra - rc);
    const ax = ux * sign, az = uz * sign;
    const tx = Math.cos(phi) * s, tz = -Math.sin(phi) * s;
    const n = Math.max(2, Math.ceil((Math.PI * rho) / fine));
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI * i) / n;
      push(
        rc * ux + rho * (Math.cos(a) * ax + Math.sin(a) * tx),
        rc * uz + rho * (Math.cos(a) * az + Math.sin(a) * tz),
        c,
      );
    }
  }

  radial(outer + 1.6 * w, r(3), 0, 0);
  arc(r(3), 0, TAU + phiA, 3);
  uturn(phiA, r(3), r(2), +1, 3);
  arc(r(2), TAU + phiA, phiC, 2);
  uturn(phiC, r(2), r(1), -1, 2);
  arc(r(1), phiC, TAU + phiA, 1);
  uturn(phiA, r(1), r(4), +1, 1);
  arc(r(4), TAU + phiA, phiD, 4);
  uturn(phiD, r(4), r(7), -1, 4);
  arc(r(7), phiD, TAU + phiB, 7);
  uturn(phiB, r(7), r(6), +1, 7);
  arc(r(6), TAU + phiB, phiD, 6);
  uturn(phiD, r(6), r(5), -1, 6);
  arc(r(5), phiD, TAU, 5);
  radial(r(5), 0, 0, 8);

  // Resample at uniform spacing, then smooth so the two square corners
  // (entering circuit 3 and leaving circuit 5) become gentle bends.
  return fromCentreline(raw, { step, smoothing, extra: { w, centre, outer } });
}

/**
 * Walkable path from a raw polyline of { x, z, c } points (c = circuit tag):
 * resampled evenly, smoothed, with arc-length lookups.
 */
function fromCentreline(raw, { step, smoothing, extra }) {
  const even = resample(raw, step);
  const pts = smooth(even, smoothing / step);
  const n = pts.length;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const circuit = new Uint8Array(n);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].x;
    zs[i] = pts[i].z;
    circuit[i] = pts[i].c;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  const length = cum[n - 1];

  function tangentAt(i) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = xs[b] - xs[a], dz = zs[b] - zs[a];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  function indexAt(s) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position, unit tangent and circuit at arc length s. */
  function pointAt(s, out = {}) {
    s = Math.min(Math.max(s, 0), length);
    const i = Math.min(indexAt(s), n - 2);
    const f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    out.x = xs[i] + (xs[i + 1] - xs[i]) * f;
    out.z = zs[i] + (zs[i + 1] - zs[i]) * f;
    const [tx, tz] = tangentAt(f < 0.5 ? i : i + 1);
    out.tx = tx;
    out.tz = tz;
    out.circuit = circuit[f < 0.5 ? i : i + 1];
    return out;
  }

  return { ...extra, xs, zs, circuit, cum, length, count: n, pointAt, tangentAt };
}

/**
 * Backbite labyrinth on a hexagon of hex cells (see hexgen.js), one path
 * width per cell, entering at the rim and ending in the centre cell. The
 * layout is turned so the entrance faces +z, like the classical one.
 *
 * Circuit tags: the cell's ring (0 = centre cell), or R + 1 on the way in.
 */
export function buildHex({ R = 5, mix = 2, seed = 1, w = 1, step = 0.04, smoothing = 0.2 } = {}) {
  const gen = backbiteLabyrinth({ R, mix, seed });
  const scale = w / Math.sqrt(3); // hexgen cells are √3 apart; make them w apart

  // The way in meets the straight outer wall head-on; turn the layout so it faces +z.
  const { gate } = outline(gen);
  const [ux, uy] = gate.normal;
  const [gx, gy] = gate.q;
  const phi = Math.atan2(ux, uy);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const place = ([x, y]) => [(x * cos - y * sin) * scale, (x * sin + y * cos) * scale];

  const approach = 1.6 * w;
  const raw = [];
  const [ex, ez] = place([gx + (ux * approach) / scale, gy + (uy * approach) / scale]);
  raw.push({ x: ex, z: ez, c: R + 1 });
  const [gx2, gz2] = place([gx, gy]);
  raw.push({ x: gx2, z: gz2, c: R + 1 });
  for (const id of gen.path) {
    const c = gen.cells[id];
    const [x, z] = place([c.x, c.y]);
    raw.push({ x, z, c: c.ring });
  }

  // Dense points so resampling and smoothing see the corners where they are.
  const dense = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (step / 2)));
    for (let j = 1; j <= k; j++) {
      dense.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k, c: j < k / 2 ? a.c : b.c });
    }
  }

  const wallSegs = walls(gen).map(([a, b]) => [...place(a), ...place(b)]);
  const outer = (R + 0.5) * w;
  return fromCentreline(dense, {
    step,
    smoothing,
    extra: { kind: 'hex', R, seed, w, outer, cellRadius: scale, centreTurn: -phi, walls: wallSegs },
  });
}

function resample(raw, step) {
  const out = [{ ...raw[0] }];
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t <= seg) {
      const f = t / seg;
      out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, c: f < 0.5 ? a.c : b.c });
      t += step;
    }
    carry = seg - (t - step);
  }
  const last = raw[raw.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > step * 0.25) out.push({ ...last });
  return out;
}

// Gaussian smoothing with odd reflection at the ends, which keeps straight
// end segments straight and the endpoints in place.
function smooth(pts, sigma) {
  const n = pts.length;
  const rad = Math.ceil(sigma * 3);
  const weights = [];
  let sum = 0;
  for (let k = -rad; k <= rad; k++) {
    const wk = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(wk);
    sum += wk;
  }
  const at = (i) => {
    if (i < 0) return { x: 2 * pts[0].x - pts[-i].x, z: 2 * pts[0].z - pts[-i].z };
    if (i >= n) {
      const j = 2 * (n - 1) - i;
      return { x: 2 * pts[n - 1].x - pts[j].x, z: 2 * pts[n - 1].z - pts[j].z };
    }
    return pts[i];
  };
  return pts.map((p, i) => {
    let x = 0, z = 0;
    for (let k = -rad; k <= rad; k++) {
      const q = at(i + k);
      x += q.x * weights[k + rad];
      z += q.z * weights[k + rad];
    }
    return { x: x / sum, z: z / sum, c: p.c };
  });
}

// Distance from (x, z) to the nearest centreline point, via a spatial hash.
// Exact within half a path width, which is all the callers need.
function pathDistance(lab) {
  const { w, xs, zs, count } = lab;
  const cell = 0.5 * w;
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  for (let i = 0; i < count; i++) {
    const k = key(xs[i], zs[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${cx + dx},${cz + dz}`);
      if (list) for (const i of list) best = Math.min(best, Math.hypot(xs[i] - x, zs[i] - z));
    }
    return best;
  };
}

/**
 * Keeps a round body of the given radius out of a hex layout's walls, each
 * treated as a capsule round its segment. Returns (x, z) => [x, z].
 */
export function wallCollider(lab, radius) {
  const cell = lab.w;
  const grid = new Map();
  for (const seg of lab.walls) {
    const [ax, az, bx, bz] = seg;
    const x0 = Math.floor((Math.min(ax, bx) - radius) / cell), x1 = Math.floor((Math.max(ax, bx) + radius) / cell);
    const z0 = Math.floor((Math.min(az, bz) - radius) / cell), z1 = Math.floor((Math.max(az, bz) + radius) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = `${cx},${cz}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(seg);
    }
  }
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!list) return [x, z];
    // Two passes settle corners, where pushing off one wall lands in the next.
    for (let pass = 0; pass < 2; pass++) {
      for (const [ax, az, bx, bz] of list) {
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
        const px = x - (ax + dx * t), pz = z - (az + dz * t);
        const d = Math.hypot(px, pz);
        if (d >= radius) continue;
        if (d < 1e-9) {
          // Dead on the wall's line: step out to one side of it.
          const l = Math.sqrt(len2);
          x += (-dz / l) * radius;
          z += (dx / l) * radius;
        } else {
          x += (px / d) * (radius - d);
          z += (pz / d) * (radius - d);
        }
      }
    }
    return [x, z];
  };
}

/**
 * Follows a free-walking point along the centreline: (x, z, sPrev) gives the
 * arc length of the nearest centreline sample within `reach` of sPrev. Looking
 * only near the last answer keeps it from jumping through a wall to the
 * corridor beside, which is always much further along the path. Off the path
 * (out in the meadow, beyond the outer wall) it holds sPrev, so walking round
 * the outside does not creep along the outermost corridor.
 */
export function pathTracker(lab, reach = 0.6) {
  // Inside a corridor the body stays within about 0.48 w of the centreline;
  // outside the outer wall it is at least 0.5 w plus its radius away.
  const maxOff2 = (0.58 * lab.w) ** 2;
  const { xs, zs, cum, count } = lab;
  const indexAt = (s) => {
    let lo = 0, hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  return (x, z, sPrev) => {
    const i0 = indexAt(sPrev - reach), i1 = Math.min(count - 1, indexAt(sPrev + reach) + 1);
    let best = i0, bestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= maxOff2 ? cum[best] : sPrev;
  };
}

/**
 * Stone positions for the walls, with stones pulled out of the walkway and
 * near-duplicates removed. Hex layouts line their wall segments; the classical
 * one lines both edges of the path plus the outer and centre rings.
 */
export function wallStones(lab, { spacing = 0.19, jitter = 0.035, minGap = 0.13, seed = 3 } = {}) {
  const { w, centre, outer, count, xs, zs } = lab;
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  const distToPath = pathDistance(lab);

  const stones = [];
  const sCell = 0.1 * w;
  const sKey = (x, z) => `${Math.floor(x / sCell)},${Math.floor(z / sCell)}`;
  const sGrid = new Map();
  function tryAdd(x, z) {
    x += (rand() - 0.5) * jitter * 2;
    z += (rand() - 0.5) * jitter * 2;
    if (!lab.walls) {
      const rr = Math.hypot(x, z);
      if (rr < centre - 0.08 * w || rr > outer + 0.12 * w) return;
    }
    // Hex hairpins wrap tightly round wall ends, so allow stones a little closer.
    if (distToPath(x, z) < (lab.walls ? 0.34 : 0.4) * w) return;
    const cx = Math.floor(x / sCell), cz = Math.floor(z / sCell);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const list = sGrid.get(`${cx + dx},${cz + dz}`);
      if (list) for (const p of list) if (Math.hypot(p.x - x, p.z - z) < minGap) return;
    }
    const p = { x, z };
    stones.push(p);
    const k = sKey(x, z);
    if (!sGrid.has(k)) sGrid.set(k, []);
    sGrid.get(k).push(p);
  }

  if (lab.walls) {
    for (const [ax, az, bx, bz] of lab.walls) {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / spacing));
      for (let i = 0; i <= n; i++) tryAdd(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
    }
    return stones;
  }

  // Path edges.
  for (const side of [1, -1]) {
    let acc = spacing;
    let px = null, pz = null;
    for (let i = 0; i < count; i++) {
      const [tx, tz] = lab.tangentAt(i);
      const x = xs[i] - tz * side * 0.5 * w;
      const z = zs[i] + tx * side * 0.5 * w;
      if (px !== null) acc += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      if (acc >= spacing) {
        tryAdd(x, z);
        acc = 0;
      }
    }
  }

  // Outer and centre rings, open where the axis corridor passes (|x| < w/2, z > 0).
  for (const rad of [outer, centre]) {
    const n = Math.ceil((TAU * rad) / spacing);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      const x = rad * Math.sin(th), z = rad * Math.cos(th);
      if (z > 0 && Math.abs(x) < 0.5 * w) continue;
      tryAdd(x, z);
    }
  }

  return stones;
}

/**
 * Coursed dry-stone walls for hex layouts, after Miyata's stone wall patterns
 * (SIGGRAPH 1990): each face of each wall segment is laid in courses, and each
 * course is split into stones whose joints keep clear of the joints below
 * ("one over two, two over one"), so no joint runs up the wall. Courses are
 * shared by every segment so they line up where walls meet. The wall leans in
 * (batter) from `baseHalf` to `topHalf` half-thickness, has the odd through
 * stone crossing it, and is finished with a row of cope stones set on edge.
 *
 * Each stone is a box: centre (x, y, z), size (sx along the wall, sy up, sz
 * across), yaw turning +x onto the wall, then lean (about the wall's
 * direction) and roll (about its normal).
 */
export function courseStones(lab, {
  height = 0.75, baseHalf = 0.12, topHalf = 0.075, firstCourse = 0.17, joint = 0.012, clearance = 0.24, seed = 7,
} = {}) {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const jit = (a) => (rand() - 0.5) * 2 * a;

  // Courses, shrinking toward the top, scaled to fill up to the cope.
  const body = height - 0.11;
  const courses = [];
  for (let v = 0, h = firstCourse; v < body; v += h, h = Math.max(0.07, h * 0.9)) {
    courses.push(h * (0.85 + rand() * 0.3));
  }
  const fill = body / courses.reduce((a, b) => a + b, 0);
  let v0 = 0;
  const layers = courses.map((h) => {
    const c = { v: v0, h: h * fill };
    v0 += c.h;
    return c;
  });
  const halfAt = (v) => baseHalf + (topHalf - baseHalf) * (v / body);
  const batter = Math.atan((baseHalf - topHalf) / body);

  const distToPath = pathDistance(lab);
  const stones = [];
  let dropped = 0;

  for (const [ax, az, bx, bz] of lab.walls) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx; // the box's +z, across the wall
    const yaw = Math.atan2(-dz, dx);
    const ext = baseHalf; // run past the ends so walls overlap at junctions
    const u0 = -ext, u1 = len + ext;
    const at = (u, b) => [ax + dx * u + nx * b, az + dz * u + nz * b];

    // Keep the walkway clear, judged at the stone's outer face. Where the path
    // cuts close past a wall end, face stones are pushed back into the wall a
    // little before giving up on them.
    const add = (st, faceU, faceB) => {
      const out = Math.sign(faceB) || 1;
      for (let back = 0; ; back += 0.01) {
        const [fx, fz] = at(faceU, faceB - out * back);
        if (distToPath(fx, fz) >= clearance) {
          st.b -= out * back;
          break;
        }
        if (st.kind !== 'face' || back >= 0.06) {
          dropped++;
          return;
        }
      }
      const [x, z] = at(st.u, st.b);
      stones.push({ x, y: st.y, z, yaw, lean: st.lean, roll: st.roll, sx: st.sx, sy: st.sy, sz: st.sz, kind: st.kind });
    };

    for (const side of [1, -1]) {
      let below = [];
      layers.forEach(({ v, h }, k) => {
        const roll = jit(0.03); // courses run slightly off level
        const half = halfAt(v + h / 2);
        const joints = [];
        let u = u0 + (k === 0 ? 0 : jit(0.3 * h) - 0.3 * h);
        while (u < u1 - 1e-6) {
          let e = u + h * (1.5 + rand() * 1.6);
          // Stagger: step a joint that lands near one below clear of it.
          for (const j of below) {
            if (Math.abs(e - j) < 0.4 * h) e = j + (e < j ? -0.45 : 0.45) * h;
          }
          if (e - u < 0.7 * h) e = u + 0.9 * h;
          if (u1 - e < 0.8 * h) e = u1; // no slivers at the end
          joints.push(e);
          const sx = e - u - joint;
          const sy = h * (0.82 + rand() * 0.14);
          const mid = (u + e) / 2;
          const through = k > 0 && k < layers.length - 1 && side === 1 && rand() < (sx / 1.1) * 0.5;
          const y = v + sy / 2 + jit(0.006);
          if (through) {
            const sz = 2 * half + 0.03 + rand() * 0.02;
            add({ u: mid, b: 0, y, sx, sy, sz, lean: jit(0.04), roll: roll + jit(0.04), kind: 'through' }, mid, sz / 2);
          } else {
            const sz = half * (0.9 + rand() * 0.5);
            const b = side * (half + jit(0.012) - sz / 2);
            add({ u: mid, b, y, sx, sy, sz, lean: -side * batter + jit(0.06), roll: roll + jit(0.05), kind: 'face' }, mid, b + side * sz / 2);
          }
          u = e;
        }
        below = joints;
      });
    }

    // Cope: thin slabs on edge across the top, leaning together a little.
    const lean = 0.12 * (rand() < 0.5 ? -1 : 1);
    for (let u = u0; u < u1 - 0.02;) {
      const sx = 0.045 + rand() * 0.04;
      const sy = 0.08 + rand() * 0.06;
      const sz = 2 * topHalf * (1.05 + rand() * 0.3);
      add({ u: u + sx / 2, b: jit(0.01), y: body + sy / 2 - 0.015, sx, sy, sz, lean: jit(0.05), roll: lean + jit(0.1), kind: 'cope' }, u + sx / 2, sz / 2);
      u += sx + 0.006;
    }
  }

  return { stones, top: body, dropped };
}
