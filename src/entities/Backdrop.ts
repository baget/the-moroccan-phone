import * as THREE from 'three';

/** Zellige-tiled wall with a plaster band and a keyhole arch behind the head. */
export function createBackdrop(): THREE.Group {
  const group = new THREE.Group();

  const tileTex = new THREE.CanvasTexture(drawZellige());
  tileTex.colorSpace = THREE.SRGBColorSpace;
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(12, 4);
  tileTex.anisotropy = 4;
  const tiles = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 10),
    new THREE.MeshStandardMaterial({ map: tileTex, color: '#a39a8c', roughness: 0.35, metalness: 0.05 }),
  );
  tiles.position.set(0, -2.2, -4);
  tiles.receiveShadow = true;
  group.add(tiles);

  const plaster = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 14),
    new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 0.95 }),
  );
  plaster.position.set(0, 9.8, -4.01);
  group.add(plaster);

  // Carved border band between tile and plaster.
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(30, 0.35, 0.12),
    new THREE.MeshStandardMaterial({ color: '#b5673a', roughness: 0.6 }),
  );
  band.position.set(0, 2.85, -3.95);
  group.add(band);

  // Keyhole arch window (dusk sky) framing the head.
  const archShape = new THREE.Shape();
  const w = 2.3;
  archShape.moveTo(-w, -1);
  archShape.lineTo(-w, 2.6);
  archShape.absarc(0, 2.6, w, Math.PI, 0, true);
  archShape.lineTo(w, -1);
  archShape.lineTo(-w, -1);
  const skyGeo = new THREE.ShapeGeometry(archShape, 32);
  // ShapeGeometry UVs are raw shape coords; normalize them to the arch bounds.
  const pos = skyGeo.attributes.position;
  const uv = skyGeo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, (pos.getX(i) + w) / (2 * w), (pos.getY(i) + 1) / (3.6 + w));
  }
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ map: skyTexture() }),
  );
  sky.position.set(0, 2.2, -3.97);
  group.add(sky);
  const frameShape = new THREE.Shape();
  const fw = w + 0.3;
  frameShape.moveTo(-fw, -1);
  frameShape.lineTo(-fw, 2.6);
  frameShape.absarc(0, 2.6, fw, Math.PI, 0, true);
  frameShape.lineTo(fw, -1);
  frameShape.lineTo(-fw, -1);
  frameShape.holes.push(archShape);
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(frameShape, { depth: 0.15, bevelEnabled: false, curveSegments: 32 }),
    new THREE.MeshStandardMaterial({ color: '#e7c98f', roughness: 0.7 }),
  );
  frame.position.set(0, 2.2, -3.98);
  frame.castShadow = true;
  group.add(frame);

  return group;
}

function drawZellige(): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = '#f1e7d2';
  ctx.fillRect(0, 0, size, size);

  const star = (cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    for (const rot of [0, Math.PI / 4]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  };
  const half = size / 2;
  // Big 8-point stars at cell corners and centre.
  for (const [x, y] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
    star(x, y, 46, '#1d4f91');
    star(x, y, 30, '#f1e7d2');
    star(x, y, 20, '#e0a83c');
  }
  star(half, half, 46, '#1f7a5a');
  star(half, half, 30, '#f1e7d2');
  star(half, half, 20, '#c8553d');
  // Small diamonds between.
  ctx.fillStyle = '#1d4f91';
  for (const [x, y] of [
    [half, 0],
    [0, half],
    [size, half],
    [half, size],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-14, -14, 28, 28);
    ctx.restore();
  }
  // Grout lines.
  ctx.strokeStyle = 'rgba(80,60,40,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  return c;
}

function plasterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.fillStyle = '#d9a86c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i += 1) {
    ctx.fillStyle = i % 2 ? 'rgba(255,235,200,0.07)' : 'rgba(150,90,40,0.07)';
    ctx.beginPath();
    ctx.arc((i * 97) % 256, (i * 57) % 256, 4 + (i % 9), 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 3);
  return t;
}

function skyTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 320;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#24406e');
  g.addColorStop(0.45, '#7a5a8c');
  g.addColorStop(0.75, '#f0935a');
  g.addColorStop(1, '#f9d48a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Sun and a few stars.
  ctx.fillStyle = 'rgba(255,236,170,0.95)';
  ctx.beginPath();
  ctx.arc(W * 0.7, H * 0.78, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 14; i += 1) ctx.fillRect((i * 67) % W, (i * 23) % (H * 0.35), 2, 2);
  // Medina skyline silhouette with a minaret.
  ctx.fillStyle = '#5b3140';
  const base = H * 0.86;
  ctx.fillRect(0, base, W, H - base);
  const blocks = [
    [0, 30, 40],
    [36, 22, 34],
    [66, 38, 28],
    [150, 26, 44],
    [190, 34, 30],
    [218, 20, 40],
  ];
  for (const [x, h, w] of blocks) ctx.fillRect(x, base - h, w, h);
  // Dome.
  ctx.beginPath();
  ctx.arc(125, base - 12, 26, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(99, base - 12, 52, 12);
  // Minaret (square tower with a small top).
  ctx.fillRect(88, base - 120, 22, 120);
  ctx.fillRect(85, base - 124, 28, 8);
  ctx.fillRect(93, base - 144, 12, 20);
  ctx.beginPath();
  ctx.arc(99, base - 146, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,210,120,0.8)';
  ctx.fillRect(96, base - 100, 6, 10);
  ctx.fillRect(160, base - 18, 5, 7);
  ctx.fillRect(200, base - 24, 5, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
