# The Moroccan Phone — evidence

## Design
- **Promise:** chuck an old clamshell phone at a cartoon guy's big nose and give him a nosebleed.
- **Loop:** drag to aim (wobbly reticle) → release → phone arcs in 0.55 s → nose = nosebleed + 100 × combo; any other face hit = scratch / bruise / black eye / fat lip / red ear, small points, combo reset; miss = whoosh.
- **Pressure:** head sway amplitude/speed grows with each nose hit; wind appears after 2 nose hits; after 4 he sometimes flinches mid-flight; reticle tremor grows. 10 phones per round, best score saved locally.

## Checks run
- `tsc` clean; `npm run build` OK.
- Playwright real-input playtest (`tests/visual.spec.ts`): full 10-throw round + retry.
  - desktop-chrome (mouse drag): score 1145, 5 nose hits, 3 injuries — PASS
  - mobile-safari / iPhone 13 (touchscreen taps): score 960, 5 nose hits, 4 injuries — PASS
  - No console/page errors.
- Captures: `artifacts/captures/pass-3/` (title, active-play, nosebleed, battered, game-over × desktop/mobile).
- Renderer: ~50 draw calls, ~54k triangles.

## Known limits
- All art is procedural (no generated models); SFX are synthesized with Web Audio.
- Fonts load from Google Fonts; offline it falls back to system fonts.
