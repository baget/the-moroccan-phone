/**
 * Press-drag-release aiming for mouse, touch and pen. While held, `aim` reports
 * the aim point (lifted above the finger on touch so it isn't hidden); release
 * fires `onRelease`.
 */
export class AimInput {
  enabled = false;
  onRelease: ((x: number, y: number) => void) | null = null;
  onPress: (() => void) | null = null;

  readonly aim = { x: 0, y: 0 };
  private pointerId: number | null = null;
  private lift = 0;

  constructor(private readonly target: HTMLElement) {
    target.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move, { passive: true });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
  }

  get aiming(): boolean {
    return this.pointerId !== null;
  }

  dispose(): void {
    this.target.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancel);
  }

  private readonly down = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null || e.button > 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.lift = e.pointerType === 'mouse' ? 0 : Math.min(110, window.innerHeight * 0.12);
    this.set(e);
    this.onPress?.();
  };

  private readonly move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.set(e);
  };

  private readonly up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.set(e);
    this.pointerId = null;
    if (this.enabled) this.onRelease?.(this.aim.x, this.aim.y);
  };

  private readonly cancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private set(e: PointerEvent): void {
    this.aim.x = e.clientX;
    this.aim.y = Math.max(0, e.clientY - this.lift);
  }
}
