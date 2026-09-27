import * as THREE from 'three';

export type HitZone = 'nose' | 'eye' | 'ear' | 'mouth' | 'face' | 'hair' | 'body';

export type DamageKind = 'scratch' | 'wound' | 'blackEye';

type BloodStream = {
  u: number;
  v: number;
  length: number;
  maxLength: number;
  width: number;
  wobble: number;
};

const SKIN = '#e9b48f';
const SKIN_SHADE = '#d89c78';
const TEX_W = 2048;
const TEX_H = 1024;

/**
 * Cartoon head with a paintable skin texture. Scratches, bruises and blood are
 * painted into the skull's CanvasTexture at the ray-hit UV, so damage sticks to
 * the face as it moves.
 */
export class Head {
  readonly group = new THREE.Group();
  /** Pivot the head rotates around (the neck), child of group. */
  readonly pivot = new THREE.Group();
  readonly hittables: THREE.Object3D[] = [];
  readonly nose: THREE.Mesh;
  readonly noseRadius = 0.2;

  private readonly skull: THREE.Mesh;
  private readonly skinCanvas = document.createElement('canvas');
  private readonly skinCtx: CanvasRenderingContext2D;
  private readonly skinTexture: THREE.CanvasTexture;
  private readonly noseMaterial: THREE.MeshStandardMaterial;
  private readonly earMaterial: THREE.MeshStandardMaterial;
  private readonly eyes: THREE.Group[] = [];
  private readonly pupils: THREE.Group[] = [];
  private readonly brows: THREE.Mesh[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly nostrils: THREE.Object3D[] = [];
  private readonly streams: BloodStream[] = [];
  /** Per side (-1 left, +1 right): shoulder and elbow joints. */
  private readonly arms: { side: number; shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();

  // Spring state for recoil (x = nod, z = tilt, y = turn).
  private readonly rot = new THREE.Vector3();
  private readonly rotVel = new THREE.Vector3();
  private readonly recoil = new THREE.Vector3();
  private readonly recoilVel = new THREE.Vector3();

  private painTimer = 0;
  private blinkTimer = 2.5;
  private blink = 0;
  private noseRedness = 0;
  private earRedness = 0;
  private dirty = false;
  bleeding = 0;

  // Sway/dodge driven by Game.
  swayAmplitude = 0.15;
  swaySpeed = 0.9;
  private swayTime = 0;
  private dodgeOffset = 0;
  private dodgeTarget = 0;
  readonly basePosition = new THREE.Vector3(0, 1.75, 0);

  constructor() {
    const ctx = this.skinCanvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context for skin texture');
    this.skinCanvas.width = TEX_W;
    this.skinCanvas.height = TEX_H;
    this.skinCtx = ctx;
    this.skinTexture = new THREE.CanvasTexture(this.skinCanvas);
    this.skinTexture.colorSpace = THREE.SRGBColorSpace;
    this.skinTexture.anisotropy = 4;

    this.group.position.copy(this.basePosition);
    this.group.add(this.pivot);
    // Pivot sits at the neck so recoils look like a head snap, not a spin.
    this.pivot.position.set(0, -1.0, 0);

    const head = new THREE.Group();
    head.position.set(0, 1.0, 0);
    this.pivot.add(head);

    const skinMat = new THREE.MeshStandardMaterial({ map: this.skinTexture, roughness: 0.62 });
    this.skull = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), skinMat);
    this.skull.scale.set(0.9, 1.1, 0.95);
    this.skull.name = 'face';
    this.skull.castShadow = true;
    head.add(this.skull);

    // Hair: a cap tilted back so the forehead stays exposed.
    const hairMat = new THREE.MeshStandardMaterial({ color: '#2b1a12', roughness: 0.85 });
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(1.04, 48, 24, 0, Math.PI * 2, 0, 1.15),
      hairMat,
    );
    hair.scale.set(0.92, 1.1, 0.98);
    hair.rotation.x = -0.42;
    hair.position.y = 0.04;
    hair.name = 'hair';
    head.add(hair);
    // Messy tufts on top.
    const tuftGeo = new THREE.ConeGeometry(0.16, 0.42, 10);
    for (let i = 0; i < 5; i += 1) {
      const tuft = new THREE.Mesh(tuftGeo, hairMat);
      const a = -0.6 + i * 0.3;
      tuft.position.set(Math.sin(a) * 0.45, 1.08 - Math.abs(a) * 0.15, -0.05 + Math.cos(a) * 0.1);
      tuft.rotation.set(-0.35, 0, -a * 0.9);
      tuft.name = 'hair';
      head.add(tuft);
    }

    // Ears.
    this.earMaterial = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), this.earMaterial);
      ear.scale.set(0.45, 1, 0.7);
      ear.position.set(side * 0.87, 0.02, -0.02);
      ear.rotation.y = side * 0.35;
      ear.name = 'ear';
      head.add(ear);
      const inner = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#c9866a', roughness: 0.7 }),
      );
      inner.scale.set(0.35, 1, 0.5);
      inner.position.set(side * 0.93, 0.02, 0.04);
      inner.name = 'ear';
      head.add(inner);
    }

    // Big cartoon nose — the target.
    this.noseMaterial = new THREE.MeshStandardMaterial({ color: '#eaa585', roughness: 0.45 });
    this.nose = new THREE.Mesh(new THREE.SphereGeometry(this.noseRadius, 32, 24), this.noseMaterial);
    this.nose.scale.set(0.95, 1.05, 1.15);
    this.nose.position.set(0, -0.06, 0.95);
    this.nose.name = 'nose';
    this.nose.castShadow = true;
    head.add(this.nose);
    // Nose shine.
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#fff3e6', transparent: true, opacity: 0.75 }),
    );
    shine.position.set(-0.06, 0.07, 0.19);
    shine.scale.set(1, 1.3, 0.4);
    this.nose.add(shine);
    const nostrilMat = new THREE.MeshBasicMaterial({ color: '#5a2418' });
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), nostrilMat);
      nostril.scale.set(1.2, 0.6, 1);
      nostril.position.set(side * 0.075, -0.15, 0.11);
      this.nose.add(nostril);
      this.nostrils.push(nostril);
    }

    // Eyes with tracking pupils.
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.25 });
    const irisMat = new THREE.MeshStandardMaterial({ color: '#4a7a3a', roughness: 0.3 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: '#0d0a08' });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.32, 0.25, 0.78);
      head.add(eye);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), whiteMat);
      white.scale.set(1, 1.15, 0.8);
      white.name = 'eye';
      eye.add(white);
      const pupil = new THREE.Group();
      eye.add(pupil);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), irisMat);
      iris.position.z = 0.138;
      pupil.add(iris);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), pupilMat);
      dot.position.z = 0.14;
      pupil.add(dot);
      const glint = new THREE.Mesh(
        new THREE.CircleGeometry(0.018, 10),
        new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      );
      glint.position.set(0.025, 0.03, 0.142);
      pupil.add(glint);
      this.eyes.push(eye);
      this.pupils.push(pupil);

      const brow = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.035, 0.22, 4, 8),
        new THREE.MeshStandardMaterial({ color: '#2b1a12', roughness: 0.9 }),
      );
      brow.rotation.z = Math.PI / 2 + side * 0.12;
      brow.position.set(side * 0.33, 0.5, 0.82);
      brow.name = 'face';
      head.add(brow);
      this.brows.push(brow);
    }

    // Mouth.
    this.mouth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshStandardMaterial({ color: '#5e1d1d', roughness: 0.5 }),
    );
    this.mouth.scale.set(0.24, 0.06, 0.08);
    this.mouth.position.set(0, -0.45, 0.83);
    this.mouth.rotation.x = -0.2;
    this.mouth.name = 'mouth';
    head.add(this.mouth);

    // Neck + torso (a striped shirt).
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.45, 0.9, 24),
      new THREE.MeshStandardMaterial({ color: SKIN_SHADE, roughness: 0.65 }),
    );
    neck.position.set(0, -1.25, -0.05);
    neck.name = 'body';
    this.group.add(neck);
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.1, 1.2, 8, 24),
      new THREE.MeshStandardMaterial({ map: this.createShirtTexture(), roughness: 0.8 }),
    );
    torso.scale.set(1.25, 1, 0.7);
    torso.position.set(0, -2.75, -0.2);
    torso.name = 'body';
    torso.receiveShadow = true;
    this.group.add(torso);

    this.buildArms(torso.material.map);

    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.name) this.hittables.push(obj);
    });

    this.group.updateMatrixWorld(true);
    this.paintBaseSkin();
  }

  zoneOf(obj: THREE.Object3D): HitZone {
    const name = obj.name as HitZone;
    return name || 'face';
  }

  noseWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.nose.getWorldPosition(target);
  }

  /** Front-most Z of the face in world space; used for miss detection. */
  get faceZ(): number {
    return this.group.position.z + 1.1;
  }

  reset(): void {
    this.paintBaseSkin();
    this.streams.length = 0;
    this.bleeding = 0;
    this.noseRedness = 0;
    this.earRedness = 0;
    this.painTimer = 0;
    this.rot.set(0, 0, 0);
    this.rotVel.set(0, 0, 0);
    this.recoil.set(0, 0, 0);
    this.recoilVel.set(0, 0, 0);
    this.dodgeOffset = 0;
    this.dodgeTarget = 0;
    this.swayTime = 0;
  }

  dodge(direction: number): void {
    this.dodgeTarget = direction * 0.75;
  }

  /** Apply a hit reaction impulse. `dir` is the phone's travel direction. */
  impact(point: THREE.Vector3, dir: THREE.Vector3, strength: number): void {
    const local = this.pivot.worldToLocal(this.tmpV.copy(point));
    // Nod back when hit high/center, turn when hit off-center.
    this.rotVel.x += -strength * (2.5 + Math.max(0, local.y - 1) * 2);
    this.rotVel.y += local.x * strength * 3.2;
    this.rotVel.z += -local.x * strength * 2.2;
    this.recoilVel.addScaledVector(dir, strength * 2.4);
    this.painTimer = 1.1;
  }

  startNosebleed(): void {
    this.bleeding = 1;
    this.noseRedness = Math.min(1, this.noseRedness + 0.45);
    // A stream from each nostril down the upper lip.
    for (const side of [-1, 1]) {
      const uv = this.uvOnSkull(side * 0.075, -0.2);
      if (!uv) continue;
      this.streams.push({
        u: uv.x,
        v: uv.y,
        length: 0,
        maxLength: 90 + Math.random() * 120,
        width: 9 + Math.random() * 6,
        wobble: Math.random() * 10,
      });
    }
    this.dirty = true;
  }

  /** Paint damage at a world-space hit point on the given mesh. */
  damage(
    zone: HitZone,
    uv: THREE.Vector2 | null,
    kind: DamageKind,
    rand: () => number,
    hitObject?: THREE.Object3D,
  ): void {
    if (zone === 'ear') {
      this.earRedness = Math.min(1, this.earRedness + 0.5);
      return;
    }
    if (zone === 'eye') {
      // Bruise the socket of the eye that was hit.
      const side = hitObject?.parent?.position.x ?? 0.32;
      const socket = this.uvOnSkull(side, 0.25);
      if (socket) this.paintBlackEye(socket.x * TEX_W, (1 - socket.y) * TEX_H);
      this.dirty = true;
      return;
    }
    if (!uv || zone === 'hair' || zone === 'body') return;
    const x = uv.x * TEX_W;
    const y = (1 - uv.y) * TEX_H;
    if (kind === 'scratch') this.paintScratch(x, y, rand);
    else this.paintWound(x, y, rand);
    this.dirty = true;
  }

  /** Head-local (relative to the head centre) point projected forward onto the skull → UV. */
  uvOnSkull(localX: number, localY: number): THREE.Vector2 | null {
    this.group.updateMatrixWorld(true);
    const origin = this.skull.localToWorld(this.tmpV.set(localX / 0.9, localY / 1.1, 3));
    const target = this.skull.localToWorld(this.tmpV2.set(localX / 0.9, localY / 1.1, 0));
    const dir = target.sub(origin).normalize();
    this.raycaster.set(origin, dir);
    const hit = this.raycaster.intersectObject(this.skull, false)[0];
    return hit?.uv ? hit.uv.clone() : null;
  }

  lookAt(worldTarget: THREE.Vector3 | null): void {
    for (const pupil of this.pupils) {
      if (!worldTarget) {
        pupil.position.lerp(this.tmpV.set(0, 0, 0), 0.1);
        continue;
      }
      const eye = pupil.parent as THREE.Object3D;
      const local = eye.worldToLocal(this.tmpV.copy(worldTarget)).normalize();
      pupil.position.set(local.x * 0.06, local.y * 0.06, 0);
    }
  }

  update(dt: number, animate: boolean): void {
    if (animate) this.swayTime += dt;
    const sway = Math.sin(this.swayTime * this.swaySpeed) * this.swayAmplitude;
    const bob = Math.sin(this.swayTime * this.swaySpeed * 1.7) * this.swayAmplitude * 0.18;
    this.dodgeOffset += (this.dodgeTarget - this.dodgeOffset) * Math.min(1, dt * 14);
    if (Math.abs(this.dodgeTarget) > 0 && Math.abs(this.dodgeOffset - this.dodgeTarget) < 0.02) {
      this.dodgeTarget = 0;
    }

    // Springs.
    const k = 60;
    const c = 7;
    this.rotVel.addScaledVector(this.rot, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
    this.rot.addScaledVector(this.rotVel, dt);
    this.recoilVel.addScaledVector(this.recoil, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
    this.recoil.addScaledVector(this.recoilVel, dt);

    this.group.position.set(
      this.basePosition.x + sway + this.dodgeOffset + this.recoil.x * 0.3,
      this.basePosition.y + bob,
      this.basePosition.z + this.recoil.z * 0.15,
    );
    this.pivot.rotation.set(
      this.rot.x * 0.35 + (animate ? Math.sin(this.swayTime * 0.8) * 0.03 : 0),
      this.rot.y * 0.35 + sway * 0.25,
      this.rot.z * 0.35 - sway * 0.12,
    );

    this.updateArms(animate, sway);

    // Expressions.
    this.painTimer = Math.max(0, this.painTimer - dt);
    if (animate) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blink = 0.14;
        this.blinkTimer = 2 + Math.random() * 3;
      }
    }
    this.blink = Math.max(0, this.blink - dt);
    const pain = Math.min(1, this.painTimer / 0.5);
    const squint = Math.max(pain * 0.85, this.blink > 0 ? 0.9 : 0);
    for (const eye of this.eyes) eye.scale.y = 1 - squint;
    this.brows.forEach((brow, i) => {
      const side = i === 0 ? -1 : 1;
      brow.position.y = 0.5 + pain * 0.08 + (this.bleeding > 0 ? 0.03 : 0);
      brow.rotation.z = Math.PI / 2 + side * (0.12 - pain * 0.45);
    });
    this.mouth.scale.set(0.24 - pain * 0.07, 0.06 + pain * 0.14, 0.08);

    // Blood streams grow down the face.
    if (this.streams.length > 0) {
      for (const s of this.streams) {
        if (s.length >= s.maxLength) continue;
        const prev = s.length;
        s.length = Math.min(s.maxLength, s.length + dt * 55);
        this.paintStreamSegment(s, prev, s.length);
        this.dirty = true;
      }
    }
    this.bleeding = Math.max(0, this.bleeding - dt * 0.18);
    this.noseMaterial.color.set('#eaa585').lerp(this.tmpColor.set('#d8484a'), this.noseRedness);
    this.earMaterial.color.set(SKIN).lerp(this.tmpColor.set('#e0625a'), this.earRedness);

    if (this.dirty) {
      this.skinTexture.needsUpdate = true;
      this.dirty = false;
    }
  }

  private readonly tmpColor = new THREE.Color();

  nostrilWorldPosition(index: number, target: THREE.Vector3): THREE.Vector3 {
    return this.nostrils[index % this.nostrils.length].getWorldPosition(target);
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
  }

  // ---------- arms ----------

  /** Arms in a raised "come at me" pose: elbows out, fists up beside the face. */
  private buildArms(shirtMap: THREE.Texture | null): void {
    const sleeveMat = new THREE.MeshStandardMaterial({ map: shirtMap, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_SHADE, roughness: 0.65 });
    const fistMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 1.1, -1.75, -0.15);
      this.group.add(shoulder);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), sleeveMat);
      cap.name = 'body';
      shoulder.add(cap);

      const elbowPos = new THREE.Vector3(side * 0.5, -0.55, 0.15);
      shoulder.add(this.limb(new THREE.Vector3(), elbowPos, 0.27, sleeveMat));

      const elbow = new THREE.Group();
      elbow.position.copy(elbowPos);
      shoulder.add(elbow);
      const handPos = new THREE.Vector3(side * 0.02, 1.15, 0.35);
      elbow.add(this.limb(new THREE.Vector3(), handPos, 0.2, skinMat));

      // Fist with a thumb and knuckle bumps.
      const fist = new THREE.Group();
      fist.position.copy(handPos);
      elbow.add(fist);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), fistMat);
      palm.scale.set(0.95, 1, 0.85);
      palm.name = 'body';
      palm.castShadow = true;
      fist.add(palm);
      for (let k = 0; k < 4; k += 1) {
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), fistMat);
        knuckle.position.set(side * -0.06, 0.16 - k * 0.1, 0.19);
        fist.add(knuckle);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 4, 8), fistMat);
      thumb.position.set(side * -0.19, 0.02, 0.12);
      thumb.rotation.z = side * 0.5;
      fist.add(thumb);

      this.arms.push({ side, shoulder, elbow });
    }
  }

  /** A capsule spanning `from` → `to` in the parent's space. */
  private limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
    const dir = this.tmpV.subVectors(to, from);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 16), mat);
    mesh.position.addVectors(from, to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.name = 'body';
    mesh.castShadow = true;
    return mesh;
  }

  /** Idle bounce, sway follow-through, and a flinch toward the face on hits. */
  private updateArms(animate: boolean, sway: number): void {
    const pain = Math.min(1, this.painTimer / 0.6);
    const bounce = animate ? Math.sin(this.swayTime * this.swaySpeed * 3.4) : 0;
    for (const { side, shoulder, elbow } of this.arms) {
      // Arms lag behind the sway and get knocked by the recoil springs.
      const flail = this.rot.y * 0.25 + this.rot.z * 0.3 - sway * 0.35;
      shoulder.rotation.set(
        -pain * 0.35 + this.rot.x * 0.15,
        0,
        side * (bounce * 0.05 - pain * 0.25) + flail,
      );
      // Flinch: forearms swing in to cover the face.
      elbow.rotation.set(-pain * 0.3, 0, side * (pain * 0.55 + bounce * 0.04));
    }
  }

  // ---------- painting ----------

  private paintBaseSkin(): void {
    const ctx = this.skinCtx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = SKIN;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    // Subtle mottling so the skin isn't flat.
    for (let i = 0; i < 900; i += 1) {
      const x = (i * 7919) % TEX_W;
      const y = (i * 104729) % TEX_H;
      ctx.fillStyle = i % 2 ? 'rgba(200,120,90,0.05)' : 'rgba(255,230,210,0.05)';
      ctx.beginPath();
      ctx.arc(x, y, 6 + (i % 13), 0, Math.PI * 2);
      ctx.fill();
    }
    // Cheek blush and chin stubble.
    for (const side of [-1, 1]) {
      const uv = this.uvOnSkull(side * 0.5, -0.2);
      if (!uv) continue;
      const x = uv.x * TEX_W;
      const y = (1 - uv.y) * TEX_H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 70);
      g.addColorStop(0, 'rgba(232,120,110,0.45)');
      g.addColorStop(1, 'rgba(232,120,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 80, y - 80, 160, 160);
    }
    const chin = this.uvOnSkull(0, -0.62);
    if (chin) {
      const x = chin.x * TEX_W;
      const y = (1 - chin.y) * TEX_H;
      ctx.fillStyle = 'rgba(70,45,35,0.18)';
      for (let i = 0; i < 260; i += 1) {
        const a = (i * 2.399) % (Math.PI * 2);
        const r = Math.sqrt((i * 37) % 100) * 12;
        ctx.fillRect(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 0.9 - 20, 2, 2);
      }
    }
    this.dirty = true;
  }

  private paintScratch(x: number, y: number, rand: () => number): void {
    const ctx = this.skinCtx;
    const angle = rand() * Math.PI;
    const len = 50 + rand() * 50;
    const lines = 2 + Math.floor(rand() * 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineCap = 'round';
    for (let l = 0; l < lines; l += 1) {
      const off = (l - (lines - 1) / 2) * 13;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(-len / 2, off);
        for (let s = 1; s <= 6; s += 1) {
          ctx.lineTo(-len / 2 + (len * s) / 6, off + (rand() - 0.5) * 6);
        }
      };
      path();
      ctx.strokeStyle = 'rgba(240,140,130,0.6)';
      ctx.lineWidth = 11;
      ctx.stroke();
      path();
      ctx.strokeStyle = '#a3161c';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintWound(x: number, y: number, rand: () => number): void {
    const ctx = this.skinCtx;
    const r = 34 + rand() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(110,40,120,0.75)');
    g.addColorStop(0.55, 'rgba(90,70,150,0.45)');
    g.addColorStop(1, 'rgba(120,150,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // A small cut with a trickle.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = '#8d0f16';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#a3161c';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y + 18, x + 1, y + 26 + rand() * 20);
    ctx.stroke();
    // Band-aid style highlight for comic readability.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  private paintBlackEye(x: number, y: number): void {
    const ctx = this.skinCtx;
    const g = ctx.createRadialGradient(x, y, 20, x, y, 95);
    g.addColorStop(0, 'rgba(60,20,80,0.85)');
    g.addColorStop(0.6, 'rgba(80,50,140,0.5)');
    g.addColorStop(1, 'rgba(80,50,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, 100, 85, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private paintStreamSegment(s: BloodStream, from: number, to: number): void {
    const ctx = this.skinCtx;
    const x0 = s.u * TEX_W;
    const y0 = (1 - s.v) * TEX_H;
    const wob = (d: number) => Math.sin((d + s.wobble) * 0.08) * 4;
    ctx.strokeStyle = '#b3121b';
    ctx.lineCap = 'round';
    ctx.lineWidth = s.width * (1 - (to / s.maxLength) * 0.4);
    ctx.beginPath();
    ctx.moveTo(x0 + wob(from), y0 + from);
    ctx.lineTo(x0 + wob(to), y0 + to);
    ctx.stroke();
    if (to >= s.maxLength) {
      ctx.fillStyle = '#b3121b';
      ctx.beginPath();
      ctx.arc(x0 + wob(to), y0 + to + 3, s.width * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private createShirtTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.fillStyle = '#2f6fb0';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#f2efe6';
    for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 256, 12);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }
}
