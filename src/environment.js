// Shared late-afternoon sky, sun, fog and image-based lighting.
// The sky's horizon colour is also the fog colour, so distant ground melts
// into the sky without a seam.
import * as THREE from 'three';

const SKY = {
  top: new THREE.Color(0x6f98c2),
  horizon: new THREE.Color(0xd8d2bf),
  sun: new THREE.Color(0xfff0d4),
};

// Sun direction: low in the west-southwest, behind and to the side of the default views.
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 24),
  THREE.MathUtils.degToRad(-35),
);

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY.top },
      horizonColor: { value: SKY.horizon },
      sunColor: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.5));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(sd, 5.0) * 0.22 + pow(sd, 60.0) * 0.45);
        col += sunColor * smoothstep(0.9993, 0.9997, sd) * 4.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

let envTexture = null;

function environmentTexture(renderer) {
  if (envTexture) return envTexture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  // A dim ground hemisphere, so metal reflects earth below the horizon, not sky.
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4a4834, side: THREE.BackSide }),
  );
  envScene.add(ground);
  envTexture = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
  pmrem.dispose();
  return envTexture;
}

/**
 * Adds sky, fog, IBL and a shadow-casting sun to `scene`.
 * `shadowExtent` is the half-size of the sun's orthographic shadow box around `focus`.
 */
export function createEnvironment(renderer, scene, { fogDensity = 0.02, shadowExtent = 2, shadowDistance = 20 } = {}) {
  scene.add(makeSky());
  scene.fog = new THREE.FogExp2(SKY.horizon.clone(), fogDensity);
  scene.environment = environmentTexture(renderer);
  scene.environmentIntensity = 0.75;

  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -shadowExtent;
  cam.right = cam.top = shadowExtent;
  cam.near = 0.5;
  cam.far = shadowDistance * 2;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const fill = new THREE.HemisphereLight(0xc4d6ea, 0x5b5636, 0.35);
  scene.add(fill);

  // Keep the sun's shadow box centred on a point of interest.
  function focus(point) {
    sun.target.position.copy(point);
    sun.position.copy(point).addScaledVector(SUN_DIR, shadowDistance);
  }
  focus(new THREE.Vector3());

  return { sun, focus };
}
