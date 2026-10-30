// src/engine/utils/prng.ts

export interface PrngResult {
  /** Valore float in [0, 1) */
  value: number;
  /** Nuovo stato intero a 32-bit da salvare in FullGameState.rngState */
  nextState: number;
}

/**
 * Algoritmo Mulberry32: PRNG deterministico veloce a 32-bit.
 * Dato lo stesso stato iniziale, produce sempre la stessa sequenza su ogni browser/OS.
 */
export function nextRandom(state: number): PrngResult {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: (state + 0x6d2b79f5) | 0 };
}

/**
 * Classe helper che avvolge lo stato corrente del PRNG durante l'esecuzione
 * sincrona di un comando all'interno del RiskEngine.
 */
export class SeededRng {
  constructor(private currentState: number) {}

  get state(): number {
    return this.currentState;
  }

  /** Restituisce un float in [0, 1) */
  nextFloat(): number {
    const res = nextRandom(this.currentState);
    this.currentState = res.nextState;
    return res.value;
  }

  /** Restituisce un intero casuale tra min e max (inclusi) */
  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  /** Lancia un dado a N facce (default d6: 1..6) */
  rollDie(sides = 6): number {
    return this.nextInt(1, sides);
  }

  /** Mescola un array in modo deterministico (Fisher-Yates) */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
