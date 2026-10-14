// Surroundings for the chimes: a tapering branch with twigs and leaves,
// a meadow, and a hazy ring of distant trees.
import * as THREE from 'three';
import { barkTexture, grassTexture, leafTexture } from '../textures.js';
import { rng, noise1 } from '../noise.js';

function taperedBranch(points, r0, r1, mat, segments = 64) {
  const curve = new THREE.CatmullRomCurve3(points);
  const radial = 10;
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, c);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(u, 0.8));
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, curve };
}

export function createScenery(scene) {
  const r = rng(42);
  const group = new THREE.Group();
  scene.add(group);

  // Meadow.
  const grass = grassTexture();
  grass.repeat.set(140, 140);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xd8dcc0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  // No shadows here: the sun's small shadow box would clip the branch's shadow into a stray streak.
  group.add(ground);

  // The branch the chimes hang from. It passes just above the hook at (0, 2.36, 0).
  const bark = barkTexture();
  bark.repeat.set(6, 1);
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 2, roughness: 0.95, color: 0xb8ab98 });
  const main = taperedBranch(
    [
      new THREE.Vector3(-3.2, 2.05, -1.3),
      new THREE.Vector3(-1.4, 2.33, -0.42),
      new THREE.Vector3(0, 2.425, 0),
      new THREE.Vector3(1.0, 2.5, 0.22),
      new THREE.Vector3(2.1, 2.66, 0.28),
    ],
    0.09, 0.022, barkMat,
  );
  group.add(main.mesh);

  const twigs = [
    [0.18, new THREE.Vector3(0.0, 0.32, -0.25), 0.02],
    [0.62, new THREE.Vector3(0.35, 0.28, 0.32), 0.016],
    [0.82, new THREE.Vector3(0.45, 0.18, -0.2), 0.012],
    [0.35, new THREE.Vector3(-0.15, 0.25, 0.45), 0.016],
  ].map(([u, reach, rad]) => {
    const start = main.curve.getPointAt(u);
    const mid = start.clone().addScaledVector(reach, 0.5).add(new THREE.Vector3(0, 0.05, 0));
    const end = start.clone().add(reach);
    const t = taperedBranch([start, mid, end], rad, rad * 0.25, barkMat, 16);
    group.add(t.mesh);
    return t.curve;
  });

  // Leaves along the twigs and the thin end of the branch.
  const leafGeo = new THREE.PlaneGeometry(0.06, 0.085);
  leafGeo.translate(0, 0.0425, 0);
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75,
  });
  const leafCurves = [...twigs.map((c) => [c, 0.3, 1]), [main.curve, 0.72, 1]];
  const leafCount = 110;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafCount);
  leaves.castShadow = true;
  const leafBase = [];
  const tint = new THREE.Color();
  for (let i = 0; i < leafCount; i++) {
    const [curve, u0, u1] = leafCurves[i % leafCurves.length];
    const p = curve.getPointAt(THREE.MathUtils.lerp(u0, u1, r()));
    p.add(new THREE.Vector3((r() - 0.5) * 0.06, (r() - 0.5) * 0.04, (r() - 0.5) * 0.06));
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(r() * Math.PI * 0.9 - 0.2, r() * Math.PI * 2, (r() - 0.5) * 1.6),
    );
    const s = 0.75 + r() * 0.6;
    leafBase.push({ p, q, s, phase: r() * 10, freq: 1.5 + r() * 2.5 });
    leaves.setColorAt(i, tint.setHSL(0.22 + r() * 0.08, 0.35 + r() * 0.2, 0.42 + r() * 0.2));
  }
  group.add(leaves);

  // Distant trees: instanced trunks and lumpy canopy blobs, hazed by fog.
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const blobGeo = new THREE.SphereGeometry(1, 18, 12);
  const bp = blobGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const k = 1 + 0.16 * Math.sin(5.1 * x + 1.3) * Math.sin(4.7 * y + 2.1) * Math.sin(5.3 * z + 0.7)
      + 0.06 * Math.sin(11 * x + 3) * Math.sin(13 * z + 1);
    bp.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  blobGeo.computeVertexNormals();
  const trunkCount = 80;
  const blobsPer = 6;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3e352b, roughness: 1 }), trunkCount);
  const blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), trunkCount * blobsPer);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < trunkCount; i++) {
    const a = r() * Math.PI * 2;
    const dist = 26 + r() * 60;
    const h = 3.5 + r() * 4;
    const crown = 2.2 + r() * 1.8;
    const x = Math.cos(a) * dist, z = -Math.sin(a) * dist;
    m.compose(p.set(x, 0, z), q.identity(), s.set(1 + r() * 0.4, h + crown * 0.5, 1 + r() * 0.4));
    trunks.setMatrixAt(i, m);
    const hue = 0.2 + r() * 0.07;
    for (let j = 0; j < blobsPer; j++) {
      const br = crown * (0.55 + r() * 0.45);
      m.compose(
        p.set(x + (r() - 0.5) * crown * 1.3, h + crown * 0.6 + (r() - 0.3) * crown, z + (r() - 0.5) * crown * 1.3),
        q.setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)),
        s.set(br, br * (0.8 + r() * 0.3), br),
      );
      blobs.setMatrixAt(i * blobsPer + j, m);
      blobs.setColorAt(i * blobsPer + j, tint.setHSL(hue + (r() - 0.5) * 0.02, 0.3 + r() * 0.12, 0.13 + r() * 0.08));
    }
  }
  group.add(trunks, blobs);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();

  /** Flutter leaves; `windSpeed` in m/s. */
  function update(t, windSpeed) {
    const amp = Math.min(0.9, 0.04 + windSpeed * 0.06);
    leafBase.forEach((l, i) => {
      const w = Math.sin(t * l.freq + l.phase) * amp + (noise1(t * 1.7 + l.phase) - 0.5) * amp;
      _q.setFromEuler(_e.set(w, w * 0.4, w * 0.6)).premultiply(l.q);
      _m.compose(l.p, _q, _s.setScalar(l.s));
      leaves.setMatrixAt(i, _m);
    });
    leaves.instanceMatrix.needsUpdate = true;
  }

  return { update };
}
