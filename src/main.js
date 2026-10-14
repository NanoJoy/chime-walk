// One renderer and one canvas, split into two viewports: chimes above,
// labyrinth below. Sharing a GL context keeps later interplay between them cheap.
import * as THREE from 'three';
import { bus } from './events.js';
import { createChimes } from './chimes/scene.js';
import { createAudio } from './chimes/audio.js';
import { createLabyrinth } from './labyrinth/scene.js';
import { bindUI } from './ui.js';

const SPLIT = 0.62; // share of the height given to the chimes; matches --split in style.css

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);

const chimes = createChimes(renderer, document.getElementById('chimes-pane'), bus);
const labyrinth = createLabyrinth(renderer, document.getElementById('labyrinth-pane'), bus);
const audio = createAudio();
bus.on('chime:strike', audio.strike);
const ui = bindUI({ chimes, audio });

// Handy for poking at things from the browser console.
window.app = { chimes, labyrinth, audio, bus };

const begin = document.getElementById('begin');
document.getElementById('begin-btn').addEventListener('click', () => {
  audio.start();
  begin.classList.add('gone');
});

let width = 0, height = 0, topH = 0;
function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  topH = Math.round(height * SPLIT);
  renderer.setSize(width, height, false);
  chimes.resize(width, topH);
  labyrinth.resize(width, height - topH);
}
window.addEventListener('resize', resize);
resize();

const status = document.getElementById('lab-status');
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  chimes.update(dt);
  labyrinth.update(dt);
  ui.updateCompass();
  if (status.textContent !== labyrinth.status) status.textContent = labyrinth.status;

  const botH = height - topH;
  renderer.setViewport(0, botH, width, topH);
  renderer.setScissor(0, botH, width, topH);
  renderer.render(chimes.scene, chimes.camera);

  renderer.setViewport(0, 0, width, botH);
  renderer.setScissor(0, 0, width, botH);
  renderer.render(labyrinth.scene, labyrinth.camera);
});
