// Control panel bindings and the wind compass.
import * as THREE from 'three';
import { PRESETS, MAX_DIST } from './chimes/wind.js';

const $ = (id) => document.getElementById(id);

export function bindUI({ chimes, audio }) {
  const { wind } = chimes;

  // Arrangement.
  const layoutBtns = [...$('layout').querySelectorAll('button')];
  layoutBtns.forEach((b) => b.addEventListener('click', () => {
    layoutBtns.forEach((o) => o.classList.toggle('on', o === b));
    chimes.setLayout(b.dataset.value);
  }));

  const tubes = $('tubes');
  tubes.addEventListener('input', () => {
    $('tubes-out').textContent = tubes.value;
    chimes.setCount(Number(tubes.value));
  });

  $('finish').addEventListener('change', (e) => {
    chimes.setFinish(e.target.value);
    audio.setFinish(e.target.value);
  });
  $('tuning').addEventListener('change', (e) => chimes.setTuning(e.target.value));
  $('volume').addEventListener('input', (e) => audio.setVolume(Number(e.target.value)));

  // Wind strength and gusts.
  const strength = $('strength');
  const gust = $('gust');
  function showWind() {
    strength.value = wind.state.strength;
    gust.value = wind.state.gustiness;
    $('strength-out').textContent = `${wind.state.strength.toFixed(1)} m/s`;
    $('gust-out').textContent = `${Math.round(wind.state.gustiness * 100)}%`;
  }
  strength.addEventListener('input', () => {
    wind.state.strength = Number(strength.value);
    showWind();
  });
  gust.addEventListener('input', () => {
    wind.state.gustiness = Number(gust.value);
    showWind();
  });
  $('presets').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    Object.assign(wind.state, PRESETS[b.dataset.preset]);
    showWind();
  }));
  showWind();

  // Compass: a top-down pad oriented to the current view, so "down" on the pad
  // is always between you and the chimes.
  const pad = $('compass');
  const dot = $('compass-dot');
  const fwd = new THREE.Vector3();
  const curve = 0.7; // finer control close to the chimes

  function basis() {
    fwd.subVectors(chimes.controls.target, chimes.camera.position).setY(0).normalize();
    return { fx: fwd.x, fz: fwd.z, rx: -fwd.z, rz: fwd.x };
  }
  function padRadius() {
    return pad.clientWidth / 2 - 9;
  }

  function fromPointer(e) {
    const rect = pad.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;
    const rho = Math.min(1, Math.hypot(px, py) / padRadius());
    const dist = MAX_DIST * Math.pow(rho, 1 / curve);
    const ang = Math.atan2(py, px);
    const ux = Math.cos(ang) * dist, uy = Math.sin(ang) * dist;
    const { fx, fz, rx, rz } = basis();
    wind.setOffset(ux * rx - uy * fx, ux * rz - uy * fz);
  }

  let dragging = false;
  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    pad.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  pad.addEventListener('pointermove', (e) => dragging && fromPointer(e));
  pad.addEventListener('pointerup', () => (dragging = false));
  pad.addEventListener('pointercancel', () => (dragging = false));

  function updateCompass() {
    const { x: ox, y: oz } = wind.state.offset;
    const { fx, fz, rx, rz } = basis();
    const ux = ox * rx + oz * rz;
    const uy = -(ox * fx + oz * fz);
    const dist = Math.hypot(ux, uy);
    const rho = Math.pow(Math.min(1, dist / MAX_DIST), curve) * padRadius();
    const k = dist > 0 ? rho / dist : 0;
    const c = pad.clientWidth / 2;
    dot.style.left = `${c + ux * k}px`;
    dot.style.top = `${c + uy * k}px`;
  }

  if (window.innerWidth < 600) $('panel').open = false;

  return { updateCompass };
}
