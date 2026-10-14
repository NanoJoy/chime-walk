// Procedural unicursal labyrinths that fill a hexagon of hex cells and always
// end at the centre.
//
// Two generators, both returning the same shape:
//   backbiteLabyrinth: one path through every hex cell. Starts from concentric
//     serpentine rings and loosens them with backbite moves (mix = moves/cell).
//   doubledLabyrinth: each hex is split into 6 kites; the contour around a
//     spanning tree of the hexes is one loop through every kite. The loop is
//     cut at the centre and its free end is backbitten out to the rim.
//
// Result: { cells, path, points, centre, R } where cells[i] = { x, y, sides },
// sides = [{ n, a, b }] (n = neighbour cell or -1 for the rim, a/b = segment
// endpoints), and path lists cell ids from the entrance to the centre.
// Coordinates: pointy-top hexes of circumradius 1, centred on the origin.
import { rng } from '../noise.js';

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const SQ3 = Math.sqrt(3);
const mod6 = (k) => ((k % 6) + 6) % 6;
const hexDist = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

function hexGrid(R) {
  const cells = [];
  const id = new Map();
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      if (hexDist(q, r) > R) continue;
      id.set(`${q},${r}`, cells.length);
      cells.push({ q, r, ring: hexDist(q, r), x: SQ3 * (q + r / 2), y: 1.5 * r });
    }
  }
  for (const c of cells) {
    c.nb = DIRS.map(([dq, dr]) => id.get(`${c.q + dq},${c.r + dr}`) ?? -1);
  }
  const ring = (k) => {
    if (k === 0) return [id.get('0,0')];
    const out = [];
    let q = DIRS[4][0] * k, r = DIRS[4][1] * k;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < k; j++) {
        out.push(id.get(`${q},${r}`));
        q += DIRS[i][0];
        r += DIRS[i][1];
      }
    }
    return out;
  };
  return { cells, centre: id.get('0,0'), ring };
}

// Unit vector toward neighbour direction k, and the hex corner between k and k+1.
const dirAngle = (k) => (-Math.PI / 3) * k;
const toward = (c, ang, len) => [c.x + Math.cos(ang) * len, c.y + Math.sin(ang) * len];
const edgeMid = (c, k) => toward(c, dirAngle(k), SQ3 / 2);
const corner = (c, k) => toward(c, dirAngle(k) - Math.PI / 6, 1);

/**
 * Backbite moves on the free end (path's last element); the first element
 * stays fixed. Each move joins the end to a neighbour u and reverses the
 * stretch after u, so the path stays a single path through every cell.
 */
function backbiteMove(path, pos, neighbours, pick) {
  const end = path[path.length - 1];
  const options = neighbours(end).filter((u) => pos[u] !== path.length - 2);
  if (!options.length) return;
  const u = pick(options);
  let a = pos[u] + 1, b = path.length - 1;
  while (a < b) {
    const t = path[a];
    path[a] = path[b];
    path[b] = t;
    pos[path[a]] = a;
    pos[path[b]] = b;
    a++;
    b--;
  }
}

function indexPositions(path, n) {
  const pos = new Int32Array(n);
  path.forEach((c, i) => (pos[c] = i));
  return pos;
}

// Moves the free end out to a rim cell: mostly greedy outward, sometimes random,
// so it cannot oscillate. Returns false if it never got there.
function walkEndToRim(path, pos, neighbours, onRim, radius, r, maxMoves) {
  for (let m = 0; m < maxMoves; m++) {
    if (onRim(path[path.length - 1])) return true;
    const greedy = r() < 0.75;
    backbiteMove(path, pos, neighbours, (opts) => {
      if (!greedy) return opts[Math.floor(r() * opts.length)];
      let best = opts[0], score = -Infinity;
      for (const u of opts) {
        const s = radius(path[pos[u] + 1]) + r() * 0.5;
        if (s > score) {
          score = s;
          best = u;
        }
      }
      return best;
    });
  }
  return onRim(path[path.length - 1]);
}

function finish(cells, centrePath, centreSet, R, extra = {}) {
  // Stored centre-first while generating; hand it back entrance-first.
  const path = centrePath.slice().reverse();
  const points = path.map((i) => [cells[i].x, cells[i].y]);
  return { cells, path, points, centre: centreSet, R, ...extra };
}

export function backbiteLabyrinth({ R = 5, mix = 2, seed = 1 } = {}) {
  const g = hexGrid(R);
  const r = rng(seed * 7919 + R);

  // Concentric serpentine: centre, then each ring in alternating directions.
  // Built centre-first so the centre is the fixed end.
  const path = [g.centre];
  let dir = 1;
  for (let k = 1; k <= R; k++) {
    const rc = g.ring(k);
    const n = rc.length;
    const last = path[path.length - 1];
    const starts = rc.map((c, i) => i).filter((i) => g.cells[last].nb.includes(rc[i]));
    const s = starts[Math.floor(r() * starts.length)];
    for (let i = 0; i < n; i++) path.push(rc[(((s + dir * i) % n) + n) % n]);
    dir = -dir;
  }

  const neighbours = (c) => g.cells[c].nb.filter((x) => x >= 0);
  const pos = indexPositions(path, g.cells.length);
  const moves = Math.round(mix * g.cells.length);
  const randomPick = (opts) => opts[Math.floor(r() * opts.length)];
  for (let m = 0; m < moves; m++) backbiteMove(path, pos, neighbours, randomPick);
  const onRim = (c) => g.cells[c].ring === R;
  walkEndToRim(path, pos, neighbours, onRim, (c) => g.cells[c].ring, r, 100000);

  const cells = g.cells.map((c) => ({
    x: c.x,
    y: c.y,
    ring: c.ring,
    sides: c.nb.map((n, k) => ({ n, a: corner(c, k - 1), b: corner(c, k) })),
  }));
  return finish(cells, path, new Set([g.centre]), R, { method: 'backbite', mix });
}

// Spanning trees of the hex grid, as tree[c][k] = true when c joins nb[k].
function spanningTree(g, kind, r) {
  const n = g.cells.length;
  const tree = g.cells.map(() => new Array(6).fill(false));
  const join = (c, k) => {
    tree[c][k] = true;
    tree[g.cells[c].nb[k]][mod6(k + 3)] = true;
  };
  const dirsOf = (c) => [0, 1, 2, 3, 4, 5].filter((k) => g.cells[c].nb[k] >= 0);

  if (kind === 'wilson') {
    // Loop-erased random walks: every spanning tree equally likely.
    const inTree = new Uint8Array(n);
    const next = new Int8Array(n);
    inTree[g.centre] = 1;
    for (let s = 0; s < n; s++) {
      let u = s;
      while (!inTree[u]) {
        const ds = dirsOf(u);
        next[u] = ds[Math.floor(r() * ds.length)];
        u = g.cells[u].nb[next[u]];
      }
      for (u = s; !inTree[u]; u = g.cells[u].nb[next[u]]) {
        inTree[u] = 1;
        join(u, next[u]);
      }
    }
  } else if (kind === 'dfs') {
    // Recursive backtracker: long winding corridors, few branches.
    const seen = new Uint8Array(n);
    const stack = [g.centre];
    seen[g.centre] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1];
      const ds = dirsOf(c).filter((k) => !seen[g.cells[c].nb[k]]);
      if (!ds.length) {
        stack.pop();
        continue;
      }
      const k = ds[Math.floor(r() * ds.length)];
      join(c, k);
      seen[g.cells[c].nb[k]] = 1;
      stack.push(g.cells[c].nb[k]);
    }
  } else {
    // 'rings': Kruskal with edges along a ring much cheaper than edges between
    // rings, so each ring becomes one long arc and few spokes join them.
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    const edges = [];
    g.cells.forEach((c, i) => {
      for (const k of [0, 1, 2]) {
        const j = c.nb[k];
        if (j < 0) continue;
        const along = g.cells[j].ring === c.ring;
        edges.push({ i, k, w: r() + (along ? 0 : 0.85) });
      }
    });
    edges.sort((a, b) => a.w - b.w);
    for (const { i, k } of edges) {
      const a = find(i), b = find(g.cells[i].nb[k]);
      if (a === b) continue;
      parent[a] = b;
      join(i, k);
    }
  }
  return tree;
}

export function doubledLabyrinth({ R = 4, tree: kind = 'wilson', seed = 1 } = {}) {
  const g = hexGrid(R);
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = rng(seed * 104729 + R * 31 + attempt);
    const tree = spanningTree(g, kind, r);
    const C = g.centre;
    const open = [0, 1, 2, 3, 4, 5].filter((k) => !tree[C][k]);
    if (!open.length) continue;

    // Kite (c, k) is the corner of hex c between directions k and k+1.
    const K = (c, k) => c * 6 + mod6(k);
    const n = g.cells.length * 6;
    const kites = [];
    const loop = [];
    g.cells.forEach((c, ci) => {
      for (let k = 0; k < 6; k++) {
        const v = corner(c, k);
        const m0 = edgeMid(c, k), m1 = edgeMid(c, k + 1);
        const sides = [];
        const ends = [];
        // Each of the kite's two spines pairs with the half hex edge beside it:
        // exactly one of the pair is open, so every kite has two open sides.
        for (const [d, inner, outerOf, mid, half] of [
          [k, K(ci, k - 1), (Y) => K(Y, k + 2), m0, [m0, v]],
          [mod6(k + 1), K(ci, k + 1), (Y) => K(Y, k + 4), m1, [v, m1]],
        ]) {
          const Y = c.nb[d];
          const outer = Y < 0 ? -1 : outerOf(Y);
          sides.push({ n: inner, a: [c.x, c.y], b: mid });
          sides.push({ n: outer, a: half[0], b: half[1] });
          ends.push(tree[ci][d] ? outer : inner);
        }
        kites.push({ x: (c.x + m0[0] + v[0] + m1[0]) / 4, y: (c.y + m0[1] + v[1] + m1[1]) / 4, sides, hex: ci });
        loop.push(ends);
      }
    });

    // Walk the loop, starting on one side of an open spine at the centre and
    // ending on the other, so the path starts and ends inside the centre hex.
    const k0 = open[Math.floor(r() * open.length)];
    const a = K(C, k0), b = K(C, k0 - 1);
    const path = [a];
    let prev = b, cur = a;
    while (true) {
      const nx = loop[cur][0] === prev ? loop[cur][1] : loop[cur][0];
      if (nx === a) break;
      path.push(nx);
      prev = cur;
      cur = nx;
      if (path.length > n) break;
    }
    if (path.length !== n) continue;

    const neighbours = (i) => kites[i].sides.map((s) => s.n).filter((x) => x >= 0);
    const onRim = (i) => kites[i].sides.some((s) => s.n < 0);
    const radius = (i) => Math.hypot(kites[i].x, kites[i].y);
    const pos = indexPositions(path, n);
    if (!walkEndToRim(path, pos, neighbours, onRim, radius, r, 40 * R + 400)) continue;

    const centreSet = new Set([0, 1, 2, 3, 4, 5].map((k) => K(C, k)));
    return finish(kites, path, centreSet, R, { method: 'doubled', tree: kind, hexes: g.cells });
  }
  throw new Error(`doubledLabyrinth: no valid layout for R=${R} seed=${seed}`);
}

/** Checks the labyrinth is one path through every cell, rim to centre. */
export function validate(lab) {
  const { cells, path, centre } = lab;
  const problems = [];
  if (new Set(path).size !== path.length || path.length !== cells.length) {
    problems.push(`covers ${new Set(path).size} of ${cells.length} cells`);
  }
  for (let i = 1; i < path.length; i++) {
    if (!cells[path[i - 1]].sides.some((s) => s.n === path[i])) {
      problems.push(`step ${i} is not between neighbours`);
      break;
    }
  }
  if (!centre.has(path[path.length - 1])) problems.push('does not end at the centre');
  if (!cells[path[0]].sides.some((s) => s.n < 0)) problems.push('does not start on the rim');
  return problems;
}

// Convex hull, counter-clockwise, without collinear points (monotone chain).
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.slice().reverse())];
}

// Closest point on the hull's outline, with the outward normal of that edge.
function nearestOnHull(hull, [x, y]) {
  let best = null;
  hull.forEach((a, k) => {
    const b = hull[(k + 1) % hull.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
    const q = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (!best || d < best.d) {
      const l = Math.sqrt(len2);
      best = { q, d, k, normal: [dy / l, -dx / l] }; // CCW hull: right of the edge is outside
    }
  });
  return best;
}

/**
 * The straight outer wall: the convex hull of the rim, which every rim cell
 * sits inside. The entrance is where the first cell's centre meets the hull
 * head-on; the gate stays within that cell's own stretch of rim so it opens
 * into that cell alone.
 */
export function outline(lab) {
  const { cells, path } = lab;
  const rimPoints = [];
  for (const c of cells) for (const s of c.sides) if (s.n < 0) rimPoints.push(s.a, s.b);
  const hull = convexHull(rimPoints);
  const first = cells[path[0]];
  const hit = nearestOnHull(hull, [first.x, first.y]);
  let spacing = Infinity;
  for (const s of first.sides) {
    if (s.n >= 0) spacing = Math.min(spacing, Math.hypot(cells[s.n].x - first.x, cells[s.n].y - first.y));
  }
  // Keep the gate within the first cell's own stretch of rim.
  const a = hull[hit.k], b = hull[(hit.k + 1) % hull.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along = (p) => ((p[0] - hit.q[0]) * (b[0] - a[0]) + (p[1] - hit.q[1]) * (b[1] - a[1])) / len;
  const ends = first.sides.filter((s) => s.n < 0).flatMap((s) => [along(s.a), along(s.b)]);
  const half = 0.45 * spacing;
  return { hull, gate: { ...hit, from: Math.max(-half, Math.min(...ends)), to: Math.min(half, Math.max(...ends)) } };
}

/**
 * Wall segments: every side the path does not cross. The rim is the straight
 * outline with a gate at the entrance; walls that met the old zigzag rim are
 * carried out to the outline with a short stub so no gap opens along it.
 */
export function walls(lab) {
  const { cells, path } = lab;
  const pos = new Int32Array(cells.length);
  path.forEach((c, i) => (pos[c] = i));
  const { hull, gate } = outline(lab);
  const key = ([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const rimVertex = new Set();
  for (const c of cells) for (const s of c.sides) if (s.n < 0) rimVertex.add(key(s.a)).add(key(s.b));

  const out = [];
  const stubbed = new Set();
  cells.forEach((c, i) => {
    for (const s of c.sides) {
      if (s.n < 0 || s.n < i || Math.abs(pos[s.n] - pos[i]) === 1) continue;
      out.push([s.a, s.b]);
      for (const v of [s.a, s.b]) {
        const k = key(v);
        if (!rimVertex.has(k) || stubbed.has(k)) continue;
        stubbed.add(k);
        const h = nearestOnHull(hull, v);
        if (h.d > 1e-6) out.push([v, h.q]);
      }
    }
  });

  // Outline edges, split around the gate.
  hull.forEach((a, k) => {
    const b = hull[(k + 1) % hull.length];
    if (k !== gate.k) {
      out.push([a, b]);
      return;
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const t = (gate.q[0] - a[0]) * ux + (gate.q[1] - a[1]) * uy;
    if (t + gate.from > 1e-6) out.push([a, [a[0] + ux * (t + gate.from), a[1] + uy * (t + gate.from)]]);
    if (t + gate.to < len - 1e-6) out.push([[a[0] + ux * (t + gate.to), a[1] + uy * (t + gate.to)], b]);
  });
  return out;
}

/** Laps around the centre: total turning, and the longest one-way sweep. */
export function sweep(lab) {
  const ang = lab.points.map(([x, y]) => Math.atan2(y, x));
  let total = 0, run = 0, best = 0, sign = 0;
  for (let i = 1; i < ang.length; i++) {
    if (Math.hypot(...lab.points[i]) < 0.6) continue;
    let d = ang[i] - ang[i - 1];
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += Math.abs(d);
    const sg = Math.sign(d);
    if (sg === sign || sg === 0) run += Math.abs(d);
    else {
      run = Math.abs(d);
      sign = sg;
    }
    best = Math.max(best, run);
  }
  const TAU = 2 * Math.PI;
  let length = 0;
  for (let i = 1; i < lab.points.length; i++) {
    length += Math.hypot(lab.points[i][0] - lab.points[i - 1][0], lab.points[i][1] - lab.points[i - 1][1]);
  }
  return { laps: total / TAU, longestLap: best / TAU, length };
}
