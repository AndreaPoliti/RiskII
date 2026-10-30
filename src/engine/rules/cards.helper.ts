// src/engine/rules/cards.helper.ts
import { MapGraph } from '@engine/map/map.models';
import { CardSymbol, TerritoryCard } from '@engine/models/game.models';
import { SeededRng } from '@engine/utils/prng';

const SYMBOLS: CardSymbol[] = ['INFANTRY', 'CAVALRY', 'ARTILLERY'];

/**
 * Crea e mescola il mazzo di carte (1 per ogni territorio della mappa + 2 Jolly).
 */
export function createShuffledDeck(graph: MapGraph, rng: SeededRng): TerritoryCard[] {
  const cards: TerritoryCard[] = graph.territoryList.map((node, index) => ({
    id: `card_${node.id}`,
    territoryId: node.id,
    symbol: SYMBOLS[index % SYMBOLS.length],
  }));

  cards.push(
    { id: 'card_wild_1', territoryId: null, symbol: 'WILD' },
    { id: 'card_wild_2', territoryId: null, symbol: 'WILD' },
  );

  return rng.shuffle(cards);
}

/**
 * Verifica se 3 carte formano un Tris valido in Risk II:
 * - 3 simboli identici
 * - 3 simboli tutti diversi
 * - Qualsiasi combinazione contenente almeno 1 carta WILD (Jolly)
 */
export function isValidCardSet(cards: [TerritoryCard, TerritoryCard, TerritoryCard]): boolean {
  const wildCount = cards.filter((c) => c.symbol === 'WILD').length;
  if (wildCount >= 1) return true;

  const uniqueSymbols = new Set(cards.map((c) => c.symbol));
  return uniqueSymbols.size === 1 || uniqueSymbols.size === 3;
}

/**
 * Cerca automaticamente nella mano di un giocatore il primo Tris valido disponibile.
 */
export function findValidCardSetInHand(
  hand: TerritoryCard[],
): [TerritoryCard, TerritoryCard, TerritoryCard] | null {
  if (hand.length < 3) return null;

  for (let i = 0; i < hand.length - 2; i++) {
    for (let j = i + 1; j < hand.length - 1; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const candidate: [TerritoryCard, TerritoryCard, TerritoryCard] = [
          hand[i],
          hand[j],
          hand[k],
        ];
        if (isValidCardSet(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Calcola quante armate vale lo scambio numero N (0-indexed: 0 = primo scambio).
 * Scala Risk II: 4, 6, 8, 10, 12, 15, e poi +5 per ogni scambio successivo.
 */
export function getCardTradeBonus(tradesCount: number): number {
  const fixedScale = [4, 6, 8, 10, 12, 15];
  if (tradesCount < fixedScale.length) {
    return fixedScale[tradesCount];
  }
  return 15 + (tradesCount - fixedScale.length + 1) * 5;
}
