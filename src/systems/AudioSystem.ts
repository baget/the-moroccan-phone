/** Synthesized cartoon SFX via Web Audio — no asset files needed. */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state !== 'running') await this.context.resume();
      return;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.context.destination);
    const length = this.context.sampleRate;
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    await this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  /** Swoosh as the phone leaves the hand. */
  throw(power: number): void {
    this.noise(0.28, (f, now) => {
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, now);
      f.frequency.exponentialRampToValueAtTime(1800 + power * 1500, now + 0.22);
    }, 0.35);
  }

  /** Blunt plastic thunk on the face. */
  thud(): void {
    this.tone('sine', 170, 55, 0.18, 0.55);
    this.noise(0.08, (f, now) => {
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2200, now);
    }, 0.4);
  }

  /** Crunchy splat for the nose. */
  crunch(): void {
    this.tone('square', 240, 60, 0.12, 0.25);
    this.noise(0.22, (f, now) => {
      f.type = 'bandpass';
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(1400, now);
      f.frequency.exponentialRampToValueAtTime(300, now + 0.2);
    }, 0.6);
    this.tone('sine', 110, 40, 0.3, 0.6);
  }

  /** Comic "OW!" — a vowel-ish formant sweep. */
  ouch(pitch = 1): void {
    const ctx = this.context;
    if (!this.ready() || !ctx || !this.master) return;
    const now = ctx.currentTime + 0.04;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340 * pitch, now);
    osc.frequency.linearRampToValueAtTime(420 * pitch, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(170 * pitch, now + 0.45);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 6;
    f1.frequency.setValueAtTime(750, now);
    f1.frequency.linearRampToValueAtTime(450, now + 0.4);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 8;
    f2.frequency.setValueAtTime(1150, now);
    f2.frequency.linearRampToValueAtTime(800, now + 0.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(f1).connect(gain);
    osc.connect(f2).connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.55);
  }

  /** Descending whistle for a miss. */
  miss(): void {
    this.tone('sine', 900, 280, 0.5, 0.18);
  }

  /** Old-school ringtone blip (original motif). */
  ring(): void {
    const notes = [1318, 1175, 988, 1175, 1318, 1568];
    notes.forEach((freq, i) => this.tone('square', freq, freq, 0.09, 0.07, i * 0.11));
  }

  combo(level: number): void {
    const base = 520 * Math.pow(1.12, Math.min(level, 8));
    this.tone('triangle', base, base * 1.5, 0.16, 0.2);
    this.tone('triangle', base * 1.25, base * 2, 0.16, 0.16, 0.08);
  }

  fanfare(good: boolean): void {
    const notes = good ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((freq, i) => this.tone('triangle', freq, freq, 0.2, 0.2, i * 0.14));
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  private ready(): boolean {
    return !!this.context && this.context.state === 'running' && !this.muted;
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    volume: number,
    delay = 0,
  ): void {
    const ctx = this.context;
    if (!this.ready() || !ctx || !this.master) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(
    duration: number,
    shape: (filter: BiquadFilterNode, now: number) => void,
    volume: number,
  ): void {
    const ctx = this.context;
    if (!this.ready() || !ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    shape(filter, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random() * 0.5);
    src.stop(now + duration + 0.02);
  }
}
