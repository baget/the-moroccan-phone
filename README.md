# The Moroccan Phone

A casual browser game: throw an old flip-phone at a cartoon guy's face. Hit the nose for a nosebleed and combo points — anywhere else leaves scratches, bruises and black eyes.

**Play:** https://baget.github.io/the-moroccan-phone/

- Drag to aim, let go to throw. Works with mouse and touch.
- 10 phones per round. Each nose hit makes him sway faster; wind shows up after 2, dodges after 4.

## Develop

```bash
npm install
npm run dev      # http://127.0.0.1:5188
npm test         # Playwright playtest (desktop + mobile)
npm run build
```

Built with Three.js + Vite + TypeScript. All art is procedural and all sound is synthesized with Web Audio.
