/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  state: string;
  score: number;
  phonesUsed: number;
  phonesPerRound: number;
  noseHits: number;
  injuries: number;
  combo: number;
  wind: number;
  lastZone: string | null;
  noseScreen: { x: number; y: number };
  phone: {
    state: string;
    position: { x: number; y: number; z: number };
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throw for unknown states. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation/state transitions immediately; keep rendering. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
  /** Throw at a CSS-pixel screen point (bypasses pointer input). */
  throwAtScreen(x: number, y: number): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
