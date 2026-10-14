// Procedural canvas textures, so the scene needs no image assets.
import * as THREE from 'three';
import { rng } from './noise.js';

function canvasTexture(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function hsl(h, s, l, a = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// Strokes wrap at the edges so the texture tiles without seams.
function wrapped(ctx, w, h, x, y, fn) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    if (x + dx < -40 || x + dx > w + 40 || y + dy < -40 || y + dy > h + 40) continue;
    fn(x + dx, y + dy);
  }
}

export function grassTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(7);
    ctx.fillStyle = hsl(78, 30, 30);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 70;
      wrapped(ctx, w, h, x, y, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, hsl(70 + r() * 25, 30 + r() * 15, 24 + r() * 14, 0.35));
        g.addColorStop(1, hsl(80, 30, 30, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h;
      const len = 4 + r() * 9, ang = -Math.PI / 2 + (r() - 0.5) * 1.2;
      ctx.strokeStyle = hsl(65 + r() * 35, 28 + r() * 25, 22 + r() * 30, 0.55);
      ctx.lineWidth = 0.8 + r() * 1.2;
      wrapped(ctx, w, h, x, y, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      });
    }
  });
}

export function earthTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = hsl(34, 26, 52);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, rad = 15 + r() * 60;
      wrapped(ctx, w, h, x, y, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, hsl(30 + r() * 12, 20 + r() * 15, 40 + r() * 20, 0.3));
        g.addColorStop(1, hsl(30, 20, 50, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 2600; i++) {
      const x = r() * w, y = r() * h, rad = 0.6 + r() * 2.4;
      ctx.fillStyle = hsl(28 + r() * 20, 10 + r() * 20, 30 + r() * 45, 0.6);
      wrapped(ctx, w, h, x, y, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

// Grey stone grit for the wall filler: soft blotches, fine grain and small
// flecks, all low in contrast and nearly colourless.
export function gritTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(29);
    ctx.fillStyle = hsl(40, 4, 40);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 70;
      wrapped(ctx, w, h, x, y, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, hsl(35 + r() * 15, 3 + r() * 4, 30 + r() * 22, 0.25));
        g.addColorStop(1, hsl(40, 4, 40, 0));
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    // Per-pixel grain.
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      const n = (r() + r() - 1) * 34;
      d[k] += n;
      d[k + 1] += n;
      d[k + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // Flecks: mostly dark pits, some pale grains.
    for (let i = 0; i < 7000; i++) {
      const x = r() * w, y = r() * h, rad = 0.5 + r() * r() * 3;
      ctx.fillStyle = r() < 0.6 ? hsl(35, 4, 16 + r() * 14, 0.6) : hsl(40, 3, 58 + r() * 20, 0.5);
      wrapped(ctx, w, h, x, y, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

// Grain runs along the texture's U axis.
export function woodTexture(hue = 30) {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    const r = rng(23 + hue);
    ctx.fillStyle = hsl(hue, 38, 42);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const y0 = r() * h;
      const amp = 2 + r() * 6, freq = (1 + Math.floor(r() * 3)) * (Math.PI * 2) / w, ph = r() * 6;
      ctx.strokeStyle = hsl(hue - 4 + r() * 8, 35 + r() * 15, 22 + r() * 30, 0.25 + r() * 0.3);
      ctx.lineWidth = 0.6 + r() * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x * freq + ph) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

// Bark with cracks running along U, which is the length of a TubeGeometry.
export function barkTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const r = rng(5);
    ctx.fillStyle = hsl(28, 14, 30);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const y0 = r() * h;
      ctx.strokeStyle = r() < 0.6 ? hsl(25, 15, 12 + r() * 8, 0.7) : hsl(30, 10, 45 + r() * 15, 0.35);
      ctx.lineWidth = 1 + r() * 3;
      ctx.beginPath();
      let x = r() * w, y = y0;
      ctx.moveTo(x, y);
      const len = 30 + r() * 120;
      for (let t = 0; t < len; t += 6) {
        x += 6;
        y += (r() - 0.5) * 4;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function leafTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.translate(w / 2, h);
    ctx.fillStyle = hsl(85, 22, 80); // pale: instance colours tint it
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-46, -40, -30, -100, 0, -126);
    ctx.bezierCurveTo(30, -100, 46, -40, 0, 0);
    ctx.fill();
    ctx.strokeStyle = hsl(80, 20, 94, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(0, -120);
    ctx.stroke();
  }, { repeat: false });
}

export function softSprite() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}
