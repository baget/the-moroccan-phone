import * as THREE from 'three';

export type PhoneState = 'ready' | 'flying' | 'bounced' | 'gone';

const W = 0.26;
const H = 0.42;
const D = 0.06;

/** A chunky early-2000s clamshell phone, opened, with keypad and green LCD. */
export class FlipPhone {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly spin = new THREE.Vector3();
  readonly previous = new THREE.Vector3();
  state: PhoneState = 'ready';
  windX = 0;
  age = 0;

  private readonly body = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly restPosition = new THREE.Vector3();
  private readonly restRotation = new THREE.Euler(-0.5, 0, 0);
  private lidAngle = 0.35;
  private lidTarget = 0.35;

  constructor() {
    const shell = new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.75, roughness: 0.32 });
    const trim = new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.3, roughness: 0.5 });

    // Lower half with keypad on +Z face.
    const lowerGeo = new THREE.BoxGeometry(W, H, D);
    const keypadMat = new THREE.MeshStandardMaterial({
      map: this.createKeypadTexture(),
      metalness: 0.4,
      roughness: 0.4,
    });
    const lower = new THREE.Mesh(lowerGeo, [shell, shell, shell, shell, keypadMat, shell]);
    lower.position.y = -H / 2;
    lower.castShadow = true;
    this.body.add(lower);

    // Hinge barrel.
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.55, D * 0.55, W * 0.95, 16), trim);
    hinge.rotation.z = Math.PI / 2;
    this.body.add(hinge);

    // Upper half (the lid) rotates around the hinge.
    const screenMat = new THREE.MeshStandardMaterial({
      map: this.createScreenTexture(),
      emissive: new THREE.Color('#9fd37a'),
      emissiveIntensity: 0.35,
      emissiveMap: null,
      roughness: 0.3,
    });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(W, H, D * 0.8), [
      shell,
      shell,
      shell,
      shell,
      screenMat,
      shell,
    ]);
    upper.position.y = H / 2;
    upper.castShadow = true;
    this.lid.add(upper);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.12, 10), trim);
    antenna.position.set(W * 0.32, H + 0.05, -0.01);
    this.lid.add(antenna);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), trim);
    antennaTip.position.set(W * 0.32, H + 0.11, -0.01);
    this.lid.add(antennaTip);
    this.body.add(this.lid);

    this.group.add(this.body);
    this.group.scale.setScalar(0.85);
  }

  setRest(position: THREE.Vector3): void {
    this.restPosition.copy(position);
  }

  resetToHand(): void {
    this.state = 'ready';
    this.age = 0;
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.group.position.copy(this.restPosition);
    this.group.rotation.copy(this.restRotation);
    this.lidTarget = 0.35;
    this.group.visible = true;
  }

  launch(velocity: THREE.Vector3, windX: number, spinAmount: number): void {
    this.state = 'flying';
    this.age = 0;
    this.velocity.copy(velocity);
    this.windX = windX;
    // Tumble end-over-end, a little sideways.
    this.spin.set(-spinAmount, velocity.x * 1.5, velocity.x * 2);
    this.lidTarget = 0.2; // snaps a bit more open in flight
  }

  bounce(normal: THREE.Vector3, restitution: number): void {
    const vn = this.velocity.dot(normal);
    if (vn < 0) this.velocity.addScaledVector(normal, -(1 + restitution) * vn);
    this.velocity.multiplyScalar(0.55);
    this.velocity.y += 1.5;
    this.spin.multiplyScalar(-1.4);
    this.lidTarget = Math.PI * 0.75; // clamshell snaps shut-ish on impact
    this.state = 'bounced';
  }

  update(dt: number, gravity: number, idleTime: number): void {
    this.lidAngle += (this.lidTarget - this.lidAngle) * Math.min(1, dt * 12);
    // Lid opens from closed (PI) toward flat; lidAngle = gap from fully open.
    this.lid.rotation.x = this.lidAngle;

    if (this.state === 'ready') {
      // Gentle hover in the hand.
      this.group.position.y = this.restPosition.y + Math.sin(idleTime * 2.2) * 0.03;
      this.group.rotation.z = Math.sin(idleTime * 1.3) * 0.06;
      return;
    }
    if (this.state === 'gone') return;
    this.age += dt;
    this.previous.copy(this.group.position);
    this.velocity.y -= gravity * dt;
    this.velocity.x += this.windX * dt;
    this.group.position.addScaledVector(this.velocity, dt);
    this.group.rotation.x += this.spin.x * dt;
    this.group.rotation.y += this.spin.y * dt;
    this.group.rotation.z += this.spin.z * dt;
    if (this.group.position.y < -4 || this.group.position.z < -8 || this.age > 4) {
      this.state = 'gone';
      this.group.visible = false;
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    });
  }

  private createKeypadTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 208;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.fillStyle = '#b8c0c8';
    ctx.fillRect(0, 0, 128, 208);
    // Nav pad.
    ctx.fillStyle = '#39414a';
    ctx.beginPath();
    ctx.arc(64, 34, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6fbf4e';
    ctx.fillRect(10, 24, 22, 14);
    ctx.fillStyle = '#d64a3a';
    ctx.fillRect(96, 24, 22, 14);
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach((label, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 22 + col * 42;
      const y = 76 + row * 34;
      ctx.fillStyle = '#e9edf0';
      ctx.beginPath();
      ctx.ellipse(x, y, 17, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20252b';
      ctx.fillText(label, x, y + 1);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private createScreenTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 208;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.fillStyle = '#20252b';
    ctx.fillRect(0, 0, 128, 208);
    ctx.fillStyle = '#a9d47f';
    ctx.fillRect(14, 30, 100, 110);
    ctx.fillStyle = '#2d4a1e';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('▂▄▆ 12:07', 20, 50);
    ctx.font = 'bold 16px monospace';
    ctx.fillText('1 MISSED', 22, 90);
    ctx.fillText('  CALL', 22, 110);
    // Speaker slot.
    ctx.fillStyle = '#555c64';
    ctx.fillRect(44, 12, 40, 5);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}
