// The chimes half: scene, camera, rig + physics, wind and pointer handling.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment } from '../environment.js';
import { createScenery } from './scenery.js';
import { buildRig } from './rig.js';
import { createPhysics } from './physics.js';
import { createWind } from './wind.js';

const STEP = 1 / 120;
const CENTER = new THREE.Vector3(0, 1.72, 0);
const LEAVES = new THREE.Vector3(1.2, 2.6, 0.2); // where leaf flutter samples the wind

export function createChimes(renderer, pane, bus) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
  camera.position.set(0.35, 1.58, 1.95);

  const controls = new OrbitControls(camera, pane);
  controls.target.copy(CENTER);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.7;
  controls.maxDistance = 4.5;
  controls.minPolarAngle = 0.45;
  controls.maxPolarAngle = 1.9;
  controls.update();

  const env = createEnvironment(renderer, scene, { fogDensity: 0.03, shadowExtent: 1.3, shadowDistance: 8 });
  env.focus(new THREE.Vector3(0, 1.9, 0));
  const scenery = createScenery(scene);
  const wind = createWind(scene, CENTER);

  const opts = { layout: 'round', count: 6, finish: 'aluminium', tuning: 'major' };
  let rig = null;
  let physics = null;
  let simTime = 0;
  let accumulator = 0;
  const _ndc = new THREE.Vector3();

  function onStrike(index, velocity) {
    _ndc.copy(rig.tubeMeshes[index].position).project(camera);
    bus.emit('chime:strike', {
      index,
      freq: rig.freqs[index],
      velocity,
      pan: THREE.MathUtils.clamp(_ndc.x, -1, 1) * 0.8,
    });
  }

  function rebuild() {
    if (rig) {
      scene.remove(rig.group);
      rig.dispose();
    }
    rig = buildRig(opts);
    scene.add(rig.group);
    physics = createPhysics(rig.spec, { onStrike, time: simTime });
    rig.sync(physics);
  }
  rebuild();

  // Dragging the wind handle. Capture phase, so it runs before OrbitControls
  // and can stop the orbit from starting.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CENTER.y);
  const hit = new THREE.Vector3();
  let dragging = false;

  function setPointer(e) {
    const rect = pane.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  const overHandle = () => raycaster.intersectObject(wind.pick, false).length > 0;

  pane.addEventListener('pointerdown', (e) => {
    setPointer(e);
    if (!overHandle()) return;
    dragging = true;
    pane.setPointerCapture(e.pointerId);
    pane.style.cursor = 'grabbing';
    e.stopImmediatePropagation();
  }, { capture: true });

  pane.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (dragging) {
      if (raycaster.ray.intersectPlane(dragPlane, hit)) wind.setOffset(hit.x - CENTER.x, hit.z - CENTER.z);
      e.stopImmediatePropagation();
    } else if (!e.buttons) {
      pane.style.cursor = overHandle() ? 'grab' : '';
    }
  }, { capture: true });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    pane.style.cursor = 'grab';
    e.stopImmediatePropagation();
  };
  pane.addEventListener('pointerup', endDrag, { capture: true });
  pane.addEventListener('pointercancel', endDrag, { capture: true });

  const _wind = new THREE.Vector3();

  function update(dt) {
    accumulator += Math.min(dt, 0.1);
    while (accumulator >= STEP) {
      physics.step(STEP, wind.windAt);
      simTime += STEP;
      accumulator -= STEP;
    }
    rig.sync(physics);
    wind.update(dt, simTime);
    scenery.update(simTime, wind.windAt(LEAVES, simTime, 999, _wind).length());
    controls.update();
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    controls,
    wind,
    update,
    resize,
    setLayout(v) {
      opts.layout = v;
      rebuild();
    },
    setCount(v) {
      opts.count = v;
      rebuild();
    },
    setTuning(v) {
      opts.tuning = v;
      rebuild();
    },
    setFinish(v) {
      opts.finish = v;
      rig.setFinish(v);
    },
  };
}
