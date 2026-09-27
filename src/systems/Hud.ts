import type { ScoreEntry } from './Scoreboard';

function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

export type EndStats = {
  score: number;
  noseHits: number;
  scratches: number;
  bestCombo: number;
  best: number;
  newBest: boolean;
};

export class Hud {
  readonly playButton = el<HTMLButtonElement>('#play-button');
  readonly againButton = el<HTMLButtonElement>('#again-button');
  readonly muteButton = el<HTMLButtonElement>('#mute-button');
  readonly nameInput = el<HTMLInputElement>('#name-input');

  private readonly hud = el('#hud');
  private readonly score = el('#score-value');
  private readonly phones = el('#phones-left');
  private readonly streak = el('#streak');
  private readonly wind = el('#wind');
  private readonly windArrow = el('#wind-arrow');
  private readonly windValue = el('#wind-value');
  private readonly hint = el('#hint');
  private readonly floatLayer = el('#float-layer');
  private readonly reticle = el('#reticle');
  private readonly title = el('#title-screen');
  private readonly end = el('#end-screen');
  private readonly bestTitle = el('#best-title');
  private readonly titleScores = el('#title-scores');
  private readonly titleScoresList = el('#title-scores-list');
  private readonly endScores = el('#end-scores');
  private readonly endScoresList = el('#end-scores-list');
  private readonly nameEntry = el('#name-entry');
  private lastScore = -1;

  setBest(best: number): void {
    this.bestTitle.textContent = String(best);
  }

  /** Title screen shows the top 5; the end screen shows all 10 and marks this round's row. */
  setScores(entries: readonly ScoreEntry[], currentId: string | null): void {
    this.titleScores.hidden = entries.length === 0;
    this.titleScoresList.replaceChildren(...entries.slice(0, 5).map((e, i) => scoreRow(e, i, false)));
    this.endScores.hidden = entries.length === 0;
    this.endScoresList.replaceChildren(...entries.map((e, i) => scoreRow(e, i, e.id === currentId)));
  }

  /** Shows the name box only when this round made the table. */
  setNameEntry(name: string | null): void {
    this.nameEntry.hidden = name === null;
    if (name !== null) this.nameInput.value = name;
  }

  renameCurrentRow(name: string): void {
    const cell = this.endScoresList.querySelector('.current .score-name');
    if (cell) cell.textContent = name;
  }

  scrollCurrentRowIntoView(): void {
    this.endScoresList.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  showTitle(): void {
    this.title.hidden = false;
    this.end.hidden = true;
    this.hud.hidden = true;
  }

  showPlaying(totalPhones: number): void {
    this.title.hidden = true;
    this.end.hidden = true;
    this.hud.hidden = false;
    this.phones.replaceChildren(
      ...Array.from({ length: totalPhones }, () => {
        const icon = document.createElement('div');
        icon.className = 'phone-icon';
        return icon;
      }),
    );
    this.floatLayer.replaceChildren();
  }

  showEnd(stats: EndStats): void {
    this.hud.hidden = true;
    this.hint.hidden = true;
    this.end.hidden = false;
    el('#end-score').textContent = String(stats.score);
    el('#end-nose').textContent = String(stats.noseHits);
    el('#end-scratch').textContent = String(stats.scratches);
    el('#end-combo').textContent = String(stats.bestCombo);
    el('#end-rating').textContent = rating(stats.noseHits);
    el('#end-best').textContent = stats.newBest ? '🏆 New best score!' : `Best: ${stats.best}`;
  }

  update(score: number, phonesUsed: number, streak: number, wind: number, showWind: boolean): void {
    if (score !== this.lastScore) {
      this.score.textContent = String(score);
      if (this.lastScore >= 0 && score > this.lastScore) {
        this.score.classList.remove('bump');
        void this.score.offsetWidth;
        this.score.classList.add('bump');
      }
      this.lastScore = score;
    }
    Array.from(this.phones.children).forEach((icon, i) => {
      icon.classList.toggle('used', i < phonesUsed);
    });
    this.streak.hidden = streak < 2;
    this.streak.textContent = `x${streak} combo`;
    this.wind.hidden = !showWind;
    if (showWind) {
      const abs = Math.abs(wind);
      this.windArrow.style.transform = `scaleX(${wind < 0 ? -1 : 1})`;
      this.windArrow.textContent = abs < 0.3 ? '•' : abs < 1.5 ? '→' : '⇒';
      this.windValue.textContent = abs.toFixed(1);
    }
  }

  setHint(visible: boolean): void {
    this.hint.hidden = !visible;
  }

  setMuted(muted: boolean): void {
    this.muteButton.textContent = muted ? '🔇' : '🔊';
  }

  setReticle(x: number, y: number, visible: boolean): void {
    this.reticle.hidden = !visible;
    if (visible) this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }

  floatText(text: string, x: number, y: number, kind: 'nose' | 'hit' | 'miss' | 'points'): void {
    const node = document.createElement('div');
    node.className = `float ${kind}`;
    node.textContent = text;
    node.style.left = `${Math.max(60, Math.min(window.innerWidth - 60, x))}px`;
    node.style.top = `${Math.max(90, Math.min(window.innerHeight - 40, y))}px`;
    this.floatLayer.appendChild(node);
    window.setTimeout(() => node.remove(), 1300);
  }
}

function scoreRow(entry: ScoreEntry, index: number, current: boolean): HTMLLIElement {
  const row = document.createElement('li');
  if (current) row.className = 'current';
  const cell = (className: string, text: string) => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
  row.append(
    cell('score-rank', `${index + 1}`),
    cell('score-name', entry.name),
    cell('score-nose', `👃 ${entry.noseHits}`),
    cell('score-points', String(entry.score)),
  );
  row.title = `Best combo x${entry.bestCombo} · ${new Date(entry.date).toLocaleDateString()}`;
  return row;
}

function rating(noseHits: number): string {
  if (noseHits >= 8) return 'Nosebleed Legend';
  if (noseHits >= 6) return 'Schnozz Sniper';
  if (noseHits >= 4) return 'Nose Knocker';
  if (noseHits >= 2) return 'Face Grazer';
  if (noseHits >= 1) return 'Lucky Bonk';
  return 'Butterfingers';
}
