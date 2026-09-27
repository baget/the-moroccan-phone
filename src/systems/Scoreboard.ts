const SCORES_KEY = 'moroccan-phone-scores';
const NAME_KEY = 'moroccan-phone-name';
const MAX_ENTRIES = 10;
const MAX_NAME_LENGTH = 12;
const DEFAULT_NAME = 'Player';

export type ScoreEntry = {
  id: string;
  name: string;
  score: number;
  noseHits: number;
  bestCombo: number;
  date: number;
};

/** Local top-10 table, kept in this browser's localStorage. */
export class Scoreboard {
  private entries: ScoreEntry[] = [];
  private lastName = DEFAULT_NAME;

  constructor() {
    this.entries = sanitize(readJson(SCORES_KEY));
    const name = readString(NAME_KEY);
    if (name) this.lastName = cleanName(name);
  }

  get top(): readonly ScoreEntry[] {
    return this.entries;
  }

  get name(): string {
    return this.lastName;
  }

  get bestScore(): number {
    return this.entries[0]?.score ?? 0;
  }

  /** Adds a finished round. Returns the new entry, or null if it did not make the table. */
  add(result: Omit<ScoreEntry, 'id' | 'name' | 'date'>): ScoreEntry | null {
    if (result.score <= 0) return null;
    const entry: ScoreEntry = {
      ...result,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: this.lastName,
      date: Date.now(),
    };
    const next = [...this.entries, entry].sort(compare).slice(0, MAX_ENTRIES);
    if (!next.includes(entry)) return null;
    this.entries = next;
    this.save();
    return entry;
  }

  /** Renames one entry and remembers the name for the next round. */
  rename(id: string, name: string): string {
    const clean = cleanName(name);
    this.lastName = clean;
    writeString(NAME_KEY, clean);
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.name = clean;
      this.save();
    }
    return clean;
  }

  private save(): void {
    writeString(SCORES_KEY, JSON.stringify(this.entries));
  }
}

function compare(a: ScoreEntry, b: ScoreEntry): number {
  // Higher score first; on a tie, the older score keeps its place.
  return b.score - a.score || a.date - b.date;
}

export function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || DEFAULT_NAME;
}

function sanitize(raw: unknown): ScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : Math.random().toString(36).slice(2),
      name: cleanName(typeof e.name === 'string' ? e.name : ''),
      score: num(e.score),
      noseHits: num(e.noseHits),
      bestCombo: num(e.bestCombo),
      date: num(e.date),
    }))
    .filter((e) => e.score > 0)
    .sort(compare)
    .slice(0, MAX_ENTRIES);
}

// Storage can throw (private mode, blocked cookies); the table then lives only in memory.
function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(readString(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore; see above.
  }
}
