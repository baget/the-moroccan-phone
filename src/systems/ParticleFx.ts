import * as THREE from 'three';

type Particle = {
  alive: boolean;
  life: number;
  maxLife: number;
  size: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
};

/** Pooled instanced droplets: cartoon blood drips and impact debris. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;

  constructor(count: number, material: THREE.Material, geometry: THREE.BufferGeometry) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        alive: false,
        life: 0,
        maxLife: 1,
        size: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        gravity: 9,
      });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, gravity: number): void {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    p.alive = true;
    p.life = 0;
    p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.pos.copy(pos);
    p.vel.copy(vel);
  }

  clear(): void {
    for (const p of this.particles) p.alive = false;
  }

  update(dt: number): void {
    this.particles.forEach((p, i) => {
      if (!p.alive) {
        this.dummy.scale.setScalar(0);
      } else {
        p.life += dt;
        if (p.life >= p.maxLife) p.alive = false;
        p.vel.y -= p.gravity * dt;
        p.pos.addScaledVector(p.vel, dt);
        const t = p.life / p.maxLife;
        const s = p.alive ? p.size * (1 - t * t) : 0;
        this.dummy.position.copy(p.pos);
        // Stretch droplets along their fall direction.
        const speed = p.vel.length();
        this.dummy.scale.set(s, s * (1 + Math.min(speed * 0.25, 1.4)), s);
        this.dummy.rotation.set(0, 0, Math.atan2(-p.vel.x, -p.vel.y) + Math.PI);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export class ParticleFx {
  readonly group = new THREE.Group();
  private readonly blood: Pool;
  private readonly sparks: Pool;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();

  constructor(private rand: () => number) {
    this.blood = new Pool(
      260,
      new THREE.MeshStandardMaterial({ color: '#c0121c', roughness: 0.18, metalness: 0.05 }),
      new THREE.SphereGeometry(1, 10, 8),
    );
    this.sparks = new Pool(
      80,
      new THREE.MeshBasicMaterial({ color: '#fff4c2' }),
      new THREE.TetrahedronGeometry(1, 0),
    );
    this.group.add(this.blood.mesh, this.sparks.mesh);
  }

  setRandom(rand: () => number): void {
    this.rand = rand;
  }

  /** Big burst when the nose is struck. */
  noseBurst(origin: THREE.Vector3): void {
    for (let i = 0; i < 38; i += 1) {
      this.tmpVel.set((this.rand() - 0.5) * 3.2, this.rand() * 2.2 - 0.4, 0.6 + this.rand() * 2.4);
      this.blood.spawn(origin, this.tmpVel, 0.025 + this.rand() * 0.04, 0.8 + this.rand() * 0.7, 9);
    }
  }

  /** Continuous drip from a nostril. */
  drip(origin: THREE.Vector3, intensity: number): void {
    this.tmp.copy(origin);
    this.tmp.x += (this.rand() - 0.5) * 0.03;
    this.tmpVel.set((this.rand() - 0.5) * 0.2, -0.3 - this.rand() * 0.4, 0.15 + this.rand() * 0.2);
    this.blood.spawn(this.tmp, this.tmpVel, 0.018 + intensity * 0.02, 1.1, 7);
  }

  /** Small comic "impact stars" for non-nose hits. */
  impact(origin: THREE.Vector3, bloody: boolean): void {
    for (let i = 0; i < 14; i += 1) {
      this.tmpVel.set((this.rand() - 0.5) * 4, (this.rand() - 0.2) * 3, 1 + this.rand() * 2);
      this.sparks.spawn(origin, this.tmpVel, 0.03 + this.rand() * 0.03, 0.35 + this.rand() * 0.25, 4);
    }
    if (bloody) {
      for (let i = 0; i < 8; i += 1) {
        this.tmpVel.set((this.rand() - 0.5) * 1.5, this.rand() * 1.2, 0.5 + this.rand());
        this.blood.spawn(origin, this.tmpVel, 0.015 + this.rand() * 0.02, 0.7, 9);
      }
    }
  }

  clear(): void {
    this.blood.clear();
    this.sparks.clear();
  }

  update(dt: number): void {
    this.blood.update(dt);
    this.sparks.update(dt);
  }

  dispose(): void {
    this.blood.dispose();
    this.sparks.dispose();
  }
}
