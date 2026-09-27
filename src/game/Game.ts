import * as THREE from 'three';
import { AimInput } from '../core/AimInput';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { createBackdrop } from '../entities/Backdrop';
import { FlipPhone } from '../entities/FlipPhone';
import { Head, type HitZone } from '../entities/Head';
import { AudioSystem } from '../systems/AudioSystem';
import { Hud } from '../systems/Hud';
import { ParticleFx } from '../systems/ParticleFx';
import { createSeededRandom } from '../utils/random';

type GameState = 'title' | 'aiming' | 'flying' | 'gameover';

const PHONES_PER_ROUND = 10;
const GRAVITY = 14;
const FLIGHT_TIME = 0.55;
const CAMERA_POS = new THREE.Vector3(0, 1.55, 8.5);
const CAMERA_TARGET = new THREE.Vector3(0, 1.55, 0);
const AIM_PLANE_Z = 1.05;
const BEST_KEY = 'moroccan-phone-best';

const HIT_LABELS: Record<Exclude<HitZone, 'nose'>, string[]> = {
  face: ['Scratch!', 'Ouch!', 'Gash!', 'Bonk!'],
  eye: ['Black eye!'],
  mouth: ['Fat lip!'],
  ear: ['Ear flick!'],
  hair: ['Bonk!'],
  body: ['Body shot'],
};

const HIT_POINTS: Record<HitZone, number> = {
  nose: 100,
  face: 15,
  eye: 20,
  mouth: 15,
  ear: 10,
  hair: 5,
  body: 0,
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  private readonly head = new Head();
  private readonly phone = new FlipPhone();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly input: AimInput;
  private readonly fx: ParticleFx;
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private rng = createSeededRandom(Date.now() >>> 0);
  private state: GameState = 'title';
  private frame = 0;
  private elapsed = 0;
  private score = 0;
  private phonesUsed = 0;
  private noseHits = 0;
  private injuries = 0;
  private combo = 0;
  private bestCombo = 0;
  private wind = 0;
  private best = 0;
  private hasThrown = false;
  private resolved = false;
  private lastZone: HitZone | 'miss' | null = null;
  private nextPhoneTimer = 0;
  private dodgeAt = -1;
  private hitstop = 0;
  private shake = 0;
  private dripTimer = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private muted = false;
  private maxSway = 0.85;

  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -AIM_PLANE_Z);
  private readonly ndc = new THREE.Vector2();
  private readonly aimWorld = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly segDir = new THREE.Vector3();
  private readonly segAB = new THREE.Vector3();
  private readonly segAP = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly phoneRest = new THREE.Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = 1.1;
    this.input = new AimInput(canvas);
    this.fx = new ParticleFx(this.rng);
    try {
      this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.best = 0;
    }
    this.hud.setBest(this.best);

    this.createScene();
    this.onResize();
    this.bindUi();
    this.phone.resetToHand();
    this.hud.showTitle();
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.head.dispose();
    this.phone.dispose();
    this.fx.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ---------- setup ----------

  private createScene(): void {
    this.scene.background = new THREE.Color('#123c4a');
    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_TARGET);

    this.scene.add(new THREE.HemisphereLight('#fff1dc', '#5a3a2a', 1.4));
    const key = new THREE.DirectionalLight('#fff4e0', 2.6);
    key.position.set(-3.5, 6, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 25;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8fd0ff', 1.6);
    rim.position.set(4, 3, -5);
    this.scene.add(rim);
    const fill = new THREE.PointLight('#ffb38a', 6, 12, 1.5);
    fill.position.set(3, 1, 5);
    this.scene.add(fill);

    this.scene.add(createBackdrop());
    this.scene.add(this.head.group);
    this.scene.add(this.phone.group);
    this.scene.add(this.fx.group);
  }

  private bindUi(): void {
    const begin = () => {
      void this.audio.unlock().then(() => this.audio.ring());
      this.startRound();
    };
    this.hud.playButton.addEventListener('click', begin);
    this.hud.againButton.addEventListener('click', begin);
    this.hud.muteButton.addEventListener('click', () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      this.hud.setMuted(this.muted);
    });
    this.input.onPress = () => {
      void this.audio.unlock();
    };
    this.input.onRelease = (x, y) => this.throwAtScreen(x, y);
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && this.state !== 'aiming' && this.state !== 'flying') {
        e.preventDefault();
        begin();
      }
    });
  }

  private onResize(): void {
    resizeRenderer(this.renderer, this.camera, 2);
    const aspect = this.camera.aspect;
    const dist = CAMERA_POS.z;
    // Keep the whole head + sway room visible in portrait and landscape.
    const fovForHeight = 2 * Math.atan(2.25 / dist);
    const fovForWidth = 2 * Math.atan(1.8 / aspect / dist);
    const fov = THREE.MathUtils.radToDeg(Math.max(fovForHeight, fovForWidth));
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // Keep the swaying head on screen on narrow portrait phones.
    const visibleHalfWidth = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * dist * aspect;
    this.maxSway = Math.max(0.3, visibleHalfWidth - 1.1);
    // Phone rests at the bottom edge of the view, 3.4 units in front of the camera.
    const d = 3.4;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * d;
    const halfW = halfH * aspect;
    this.phoneRest.set(Math.min(halfW * 0.45, 0.9), CAMERA_POS.y - halfH * 0.78, CAMERA_POS.z - d);
    this.phone.setRest(this.phoneRest);
    if (this.phone.state === 'ready') this.phone.group.position.copy(this.phoneRest);
  }

  // ---------- round flow ----------

  private startRound(): void {
    this.score = 0;
    this.phonesUsed = 0;
    this.noseHits = 0;
    this.injuries = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lastZone = null;
    this.head.reset();
    this.fx.clear();
    this.applyDifficulty();
    this.rollWind();
    this.phone.resetToHand();
    this.hud.showPlaying(PHONES_PER_ROUND);
    this.hud.setHint(!this.hasThrown);
    this.setState('aiming');
  }

  private setState(state: GameState): void {
    this.state = state;
    this.input.enabled = state === 'aiming';
  }

  private applyDifficulty(): void {
    const level = this.noseHits;
    this.head.swayAmplitude = Math.min(0.12 + level * 0.1, 0.85, this.maxSway);
    this.head.swaySpeed = 0.8 + level * 0.17;
  }

  private rollWind(): void {
    if (this.noseHits < 2) {
      this.wind = 0;
      return;
    }
    const max = Math.min(0.8 + this.noseHits * 0.3, 3);
    this.wind = (this.rng() * 2 - 1) * max;
  }

  private throwAtScreen(x: number, y: number): void {
    if (this.state !== 'aiming') return;
    const rect = this.canvas.getBoundingClientRect();
    const wobble = this.reticleWobble();
    this.ndc.set(
      ((x + wobble.x - rect.left) / rect.width) * 2 - 1,
      -((y + wobble.y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.aimWorld)) return;
    this.throwAtWorld(this.aimWorld);
  }

  private throwAtWorld(target: THREE.Vector3): void {
    const start = this.phone.group.position;
    const t = FLIGHT_TIME;
    const velocity = new THREE.Vector3(
      (target.x - start.x) / t,
      (target.y - start.y) / t + 0.5 * GRAVITY * t,
      (target.z - start.z) / t,
    );
    this.phone.launch(velocity, this.wind, 9 + this.rng() * 5);
    this.audio.throw(0.6);
    this.phonesUsed += 1;
    this.resolved = false;
    this.nextPhoneTimer = 0;
    this.hasThrown = true;
    this.hud.setHint(false);
    this.hud.setReticle(0, 0, false);
    // Later on, he sometimes flinches away mid-flight.
    this.dodgeAt = -1;
    if (this.noseHits >= 4 && this.rng() < Math.min(0.2 + (this.noseHits - 4) * 0.06, 0.5)) {
      this.dodgeAt = 0.18 + this.rng() * 0.12;
    }
    this.setState('flying');
  }

  private finishThrow(): void {
    if (this.phonesUsed >= PHONES_PER_ROUND) {
      this.endRound();
      return;
    }
    this.applyDifficulty();
    this.rollWind();
    this.phone.resetToHand();
    this.setState('aiming');
  }

  private endRound(): void {
    this.setState('gameover');
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        // Storage unavailable (private mode); best score just won't persist.
      }
      this.hud.setBest(this.best);
    }
    this.audio.fanfare(this.noseHits >= 3);
    this.hud.showEnd({
      score: this.score,
      noseHits: this.noseHits,
      scratches: this.injuries,
      bestCombo: this.bestCombo,
      best: this.best,
      newBest,
    });
  }

  // ---------- hits ----------

  private checkCollision(): void {
    const from = this.phone.previous;
    const to = this.phone.group.position;
    const len = this.segDir.subVectors(to, from).length();
    if (len < 1e-5) return;
    this.segDir.divideScalar(len);

    // Generous nose check: segment distance to the nose centre.
    const nose = this.head.noseWorldPosition(this.tmp);
    const closest = this.closestPointOnSegment(from, to, nose, this.tmp2);
    if (closest.distanceTo(nose) < this.head.noseRadius * 1.15 + 0.08) {
      this.onHit('nose', closest, null, null);
      return;
    }

    this.raycaster.set(from, this.segDir);
    this.raycaster.far = len + 0.05;
    const hit = this.raycaster.intersectObjects(this.head.hittables, false)[0];
    this.raycaster.far = Infinity;
    if (!hit) return;
    const zone = this.head.zoneOf(hit.object);
    this.onHit(zone, hit.point, hit.uv ?? null, hit.object, hit.face?.normal);
  }

  private onHit(
    zone: HitZone,
    point: THREE.Vector3,
    uv: THREE.Vector2 | null,
    object: THREE.Object3D | null,
    faceNormal?: THREE.Vector3,
  ): void {
    this.resolved = true;
    this.lastZone = zone;
    const hitPoint = point.clone();
    const dir = this.phone.velocity.clone().normalize();

    // Bounce the phone off the surface.
    const normal = new THREE.Vector3(0, 0, 1);
    if (faceNormal && object) {
      this.normalMatrix.getNormalMatrix(object.matrixWorld);
      normal.copy(faceNormal).applyMatrix3(this.normalMatrix).normalize();
    } else if (zone === 'nose') {
      normal.subVectors(hitPoint, this.head.noseWorldPosition(this.tmp)).normalize();
      normal.z = Math.max(normal.z, 0.5);
      normal.normalize();
    }
    this.phone.bounce(normal, 0.35);

    const screen = this.toScreen(hitPoint);
    if (zone === 'nose') {
      this.noseHits += 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const points = HIT_POINTS.nose * this.combo;
      this.score += points;
      this.head.impact(hitPoint, dir, 1.3);
      this.head.startNosebleed();
      this.fx.noseBurst(hitPoint);
      this.audio.crunch();
      this.audio.ouch(1.25);
      if (this.combo > 1) this.audio.combo(this.combo);
      this.hitstop = 0.12;
      this.shake = 0.28;
      const labels = ['NOSEBLEED!', 'SCHNOZZ!', 'BULLSEYE!', 'SPLAT!'];
      this.hud.floatText(this.noseHits === 1 ? 'NOSEBLEED!' : labels[Math.floor(this.rng() * labels.length)], screen.x, screen.y - 30, 'nose');
      this.hud.floatText(`+${points}${this.combo > 1 ? ` (x${this.combo})` : ''}`, screen.x, screen.y + 26, 'points');
    } else {
      this.combo = 0;
      const points = HIT_POINTS[zone];
      this.score += points;
      const hurts = zone !== 'body' && zone !== 'hair';
      if (hurts) this.injuries += 1;
      const kind = zone === 'eye' ? 'blackEye' : this.rng() < 0.55 ? 'scratch' : 'wound';
      this.head.damage(zone, uv, kind, this.rng, object ?? undefined);
      this.head.impact(hitPoint, dir, zone === 'body' ? 0.3 : 0.8);
      this.fx.impact(hitPoint, hurts);
      this.audio.thud();
      if (hurts) this.audio.ouch(zone === 'eye' ? 1.1 : 0.95);
      this.shake = 0.14;
      const options = HIT_LABELS[zone];
      let label = options[Math.floor(this.rng() * options.length)];
      if (zone === 'face') label = kind === 'scratch' ? 'Scratch!' : 'Ouch!';
      this.hud.floatText(label, screen.x, screen.y - 20, 'hit');
      if (points > 0) this.hud.floatText(`+${points}`, screen.x, screen.y + 24, 'points');
    }
    this.nextPhoneTimer = 1.0;
  }

  private onMiss(): void {
    this.resolved = true;
    this.lastZone = 'miss';
    this.combo = 0;
    this.audio.miss();
    const nose = this.toScreen(this.head.noseWorldPosition(this.tmp));
    this.hud.floatText(this.rng() < 0.5 ? 'Missed!' : 'Whoosh!', nose.x, nose.y - 120, 'miss');
    this.nextPhoneTimer = 0.6;
  }

  // ---------- frame ----------

  private update(rawDelta: number, _elapsed: number): void {
    this.frame += 1;
    this.onResize();
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    let delta = rawDelta;
    if (this.hitstop > 0) {
      this.hitstop -= rawDelta;
      delta = rawDelta * 0.08;
    }
    this.elapsed += delta;
    const animate = !this.reducedMotion;

    this.head.update(delta, animate);
    this.phone.update(delta, GRAVITY, this.elapsed);

    if (this.state === 'flying') {
      if (!this.resolved && this.phone.state === 'flying') {
        if (this.dodgeAt > 0 && this.phone.age >= this.dodgeAt) {
          this.head.dodge(this.head.group.position.x > 0 ? -1 : 1);
          this.dodgeAt = -1;
        }
        this.checkCollision();
        if (!this.resolved && this.phone.group.position.z < this.head.faceZ - 1.4) this.onMiss();
      }
      if (!this.resolved && this.phone.state === 'gone') this.onMiss();
      if (this.resolved) {
        this.nextPhoneTimer -= delta;
        if (this.nextPhoneTimer <= 0) this.finishThrow();
      }
    }

    // Nose keeps dripping for a while after a hit.
    if (this.head.bleeding > 0.05 && animate) {
      this.dripTimer -= delta;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.06 + (1 - this.head.bleeding) * 0.25;
        this.fx.drip(this.head.nostrilWorldPosition(this.frame, this.tmp), this.head.bleeding);
      }
    }
    this.fx.update(delta);

    // Eyes follow the reticle while aiming, the phone while it flies.
    if (this.state === 'aiming' && this.input.aiming) {
      this.head.lookAt(this.screenToAimWorld(this.input.aim.x, this.input.aim.y, this.tmp2));
    } else if (this.state === 'flying' || this.state === 'aiming') {
      this.head.lookAt(this.phone.group.position);
    } else {
      this.head.lookAt(null);
    }

    if (this.state === 'aiming' && this.input.aiming) {
      const w = this.reticleWobble();
      this.hud.setReticle(this.input.aim.x + w.x, this.input.aim.y + w.y, true);
    } else {
      this.hud.setReticle(0, 0, false);
    }

    // Camera shake.
    this.shake = Math.max(0, this.shake - rawDelta);
    const s = this.shake * this.shake * 0.6;
    this.camera.position.set(
      CAMERA_POS.x + (this.rng() - 0.5) * s,
      CAMERA_POS.y + (this.rng() - 0.5) * s,
      CAMERA_POS.z,
    );
    this.camera.lookAt(CAMERA_TARGET);

    if (this.state !== 'title' && this.state !== 'gameover') {
      this.hud.update(this.score, this.phonesUsed, this.combo, this.wind, this.noseHits >= 2);
    }
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- helpers ----------

  private readonly wobbleOut = { x: 0, y: 0 };

  /** Hand tremor in CSS pixels; grows as the game gets harder. */
  private reticleWobble(): { x: number; y: number } {
    const amp = this.reducedMotion ? 0 : 4 + this.noseHits * 2.5;
    const t = this.elapsed;
    this.wobbleOut.x = (Math.sin(t * 2.3) + Math.sin(t * 3.7 + 1.3) * 0.5) * amp;
    this.wobbleOut.y = (Math.cos(t * 1.9) + Math.sin(t * 4.1 + 0.4) * 0.5) * amp;
    return this.wobbleOut;
  }

  private screenToAimWorld(x: number, y: number, target: THREE.Vector3): THREE.Vector3 {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.aimPlane, target);
    return target;
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } {
    const p = world.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  private closestPointOnSegment(
    a: THREE.Vector3,
    b: THREE.Vector3,
    p: THREE.Vector3,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const ab = this.segAB.subVectors(b, a);
    const lenSq = ab.lengthSq();
    const t = lenSq > 0 ? THREE.MathUtils.clamp(this.segAP.subVectors(p, a).dot(ab) / lenSq, 0, 1) : 0;
    return out.copy(a).addScaledVector(ab, t);
  }

  // ---------- diagnostics & test hooks ----------

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const nose = this.toScreen(this.head.noseWorldPosition(this.tmp));
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      state: this.state,
      score: this.score,
      phonesUsed: this.phonesUsed,
      phonesPerRound: PHONES_PER_ROUND,
      noseHits: this.noseHits,
      injuries: this.injuries,
      combo: this.combo,
      wind: this.wind,
      lastZone: this.lastZone,
      noseScreen: nose,
      phone: {
        state: this.phone.state,
        position: {
          x: this.phone.group.position.x,
          y: this.phone.group.position.y,
          z: this.phone.group.position.z,
        },
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: this.renderer.getPixelRatio(),
      },
    };
  }

  /** Run the simulation synchronously (for deterministic test setup). */
  private simulate(seconds: number): void {
    const steps = Math.ceil(seconds * 60);
    for (let i = 0; i < steps; i += 1) this.update(1 / 60, 0);
  }

  private throwAtNoseNow(offset = new THREE.Vector3()): void {
    const saved = this.head.swayAmplitude;
    this.head.swayAmplitude = 0;
    this.head.update(0, false);
    this.throwAtWorld(this.head.noseWorldPosition(new THREE.Vector3()).add(offset));
    this.simulate(1.2);
    this.head.swayAmplitude = saved;
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
        this.fx.setRandom(this.rng);
      },
      setState: (name: string) => {
        switch (name) {
          case 'title':
            this.setState('title');
            this.hud.showTitle();
            break;
          case 'active-play':
          case 'aiming':
            this.startRound();
            this.hud.setHint(true);
            break;
          case 'nosebleed':
            this.startRound();
            this.throwAtNoseNow();
            this.simulate(0.4);
            this.throwAtNoseNow();
            this.simulate(1.5);
            break;
          case 'battered':
            this.startRound();
            for (const off of [
              [-0.45, 0.55],
              [0.4, -0.35],
              [0.3, 0.25],
              [-0.35, -0.45],
            ]) {
              this.throwAtNoseNow(new THREE.Vector3(off[0], off[1], 0));
            }
            this.throwAtNoseNow();
            this.simulate(1.2);
            break;
          case 'game-over':
            this.startRound();
            this.throwAtNoseNow();
            this.throwAtNoseNow(new THREE.Vector3(0.4, 0.4, 0));
            this.phonesUsed = PHONES_PER_ROUND - 1;
            this.throwAtNoseNow();
            this.simulate(0.5);
            break;
          default:
            throw new Error(`Unknown state: ${name}`);
        }
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {
        // No debug UI in this build.
      },
      throwAtScreen: (x: number, y: number) => this.throwAtScreen(x, y),
    };
  }
}
