// src/engine/ai/ai-bot.ts
import { MapGraph, TerritoryId } from '@engine/map/map.models';
import { AiGeneralId, GameCommand, PlayerViewState } from '@engine/models/game.models';
import { findValidCardSetInHand } from '@engine/rules/cards.helper';

export interface AiPersonalityProfile {
  id: AiGeneralId;
  title: string;
  /** Rapporto minimo (mieArmate / armateNemiche) per lanciare un attacco */
  minAttackRatio: number;
  /** Differenza minima di armate per attaccare anche su piccoli presidi */
  minArmyAdvantage: number;
  /** Peso extra assegnato ai territori dello stesso continente per chiudere i bonus */
  continentFocusBonus: number;
}

export const AI_GENERALS: Record<AiGeneralId, AiPersonalityProfile> = {
  CAMPBELL: {
    id: 'CAMPBELL',
    title: 'Brigadier Campbell (Prudente)',
    minAttackRatio: 1.7,
    minArmyAdvantage: 3,
    continentFocusBonus: 20,
  },
  VAUBAN: {
    id: 'VAUBAN',
    title: 'Maresciallo Vauban (Fortificatore)',
    minAttackRatio: 1.5,
    minArmyAdvantage: 2,
    continentFocusBonus: 35,
  },
  MARLBOROUGH: {
    id: 'MARLBOROUGH',
    title: 'Duca di Marlborough (Bilanciato)',
    minAttackRatio: 1.3,
    minArmyAdvantage: 2,
    continentFocusBonus: 30,
  },
  NAPOLEON: {
    id: 'NAPOLEON',
    title: 'Generale Bonaparte (Aggressivo)',
    minAttackRatio: 1.1,
    minArmyAdvantage: 1,
    continentFocusBonus: 40,
  },
};

/**
 * Funzione pura che analizza lo stato corrente e restituisce il prossimo GameCommand
 * per il giocatore IA attivo.
 */
export function computeNextAiCommand(state: PlayerViewState, graph: MapGraph): GameCommand {
  const aiPlayer = state.players[state.activePlayerIndex];
  const profile = AI_GENERALS[aiPlayer.aiGeneralId ?? 'MARLBOROUGH'];

  const myTerritories = graph.territoryList.filter(
    (t) => state.territories[t.id].ownerId === aiPlayer.id,
  );

  // ================= 1. FASE DEPLOY (Carte + Rinforzi) =================
  if (state.phase === 'DEPLOY') {
    const validSet = findValidCardSetInHand(aiPlayer.cards);
    if (validSet) {
      return {
        type: 'TRADE_CARDS',
        playerId: aiPlayer.id,
        cardIds: [validSet[0].id, validSet[1].id, validSet[2].id],
      };
    }

    // Trova il territorio di confine più strategico su cui piazzare rinforzi
    let bestTargetId: TerritoryId = myTerritories[0].id;
    let bestScore = -Infinity;

    for (const node of myTerritories) {
      const enemyNeighbors = node.neighbors.filter(
        (nId) => state.territories[nId].ownerId !== aiPlayer.id,
      );
      if (enemyNeighbors.length === 0) continue; // Ignora territori interni sicuri

      // Calcola quanto siamo vicini a conquistare l'intero continente
      const continentNodes = graph.territoryList.filter((t) => t.continentId === node.continentId);
      const ownedInContinent = continentNodes.filter(
        (t) => state.territories[t.id].ownerId === aiPlayer.id,
      ).length;
      const continentCompletionRatio = ownedInContinent / continentNodes.length;

      // Preferisci confini dove c'è un nemico vulnerabile o un continente quasi completo
      const weakestEnemyArmies = Math.min(
        ...enemyNeighbors.map((nId) => state.territories[nId].armies),
      );
      const myArmies = state.territories[node.id].armies;

      const score =
        continentCompletionRatio * profile.continentFocusBonus +
        (myArmies - weakestEnemyArmies) * 2 +
        enemyNeighbors.length;

      if (score > bestScore) {
        bestScore = score;
        bestTargetId = node.id;
      }
    }

    const deployAmount = Math.min(3, aiPlayer.reinforcementsAvailable);
    return {
      type: 'DEPLOY_ARMIES',
      playerId: aiPlayer.id,
      territoryId: bestTargetId,
      armies: deployAmount,
    };
  }

  // ================= 2. FASE OCCUPY (Dopo una conquista) =================
  if (state.phase === 'OCCUPY' && state.pendingOccupation) {
    const { fromId, toId, maxArmies } = state.pendingOccupation;
    const fromNode = graph.territories[fromId];
    const fromStillOnFrontline = fromNode.neighbors.some(
      (nId) => state.territories[nId].ownerId !== aiPlayer.id,
    );

    // Se il territorio di partenza non confina più con nemici, sposta tutte le armate al fronte!
    const armiesToMove = fromStillOnFrontline ? Math.floor(maxArmies * 0.7) : maxArmies;

    return {
      type: 'OCCUPY_TERRITORY',
      playerId: aiPlayer.id,
      armiesToMove,
    };
  }

  // ================= 3. FASE ATTACK =================
  if (state.phase === 'ATTACK') {
    let bestAttack: { fromId: TerritoryId; toId: TerritoryId; score: number } | null = null;

    for (const fromNode of myTerritories) {
      const myArmies = state.territories[fromNode.id].armies;
      if (myArmies < 2) continue;

      for (const toId of fromNode.neighbors) {
        const targetState = state.territories[toId];
        if (targetState.ownerId === aiPlayer.id) continue;

        const enemyArmies = targetState.armies;
        const ratio = myArmies / enemyArmies;
        const advantage = myArmies - enemyArmies;

        if (ratio >= profile.minAttackRatio && advantage >= profile.minArmyAdvantage) {
          const sameContinentBonus =
            graph.territories[toId].continentId === fromNode.continentId ? 5 : 0;
          const score = ratio * 10 + advantage + sameContinentBonus;

          if (!bestAttack || score > bestAttack.score) {
            bestAttack = { fromId: fromNode.id, toId, score };
          }
        }
      }
    }

    if (bestAttack) {
      return {
        type: 'ATTACK',
        playerId: aiPlayer.id,
        fromId: bestAttack.fromId,
        toId: bestAttack.toId,
        mode: 'BLITZ',
      };
    }

    return {
      type: 'END_ATTACK_PHASE',
      playerId: aiPlayer.id,
    };
  }

  // ================= 4. FASE FORTIFY =================
  if (state.phase === 'FORTIFY') {
    // Cerca un territorio interno (zero nemici adiacenti) con >1 armate
    // per spostarle verso un territorio confinante che si trova sul fronte
    for (const fromNode of myTerritories) {
      const available = state.territories[fromNode.id].armies - 1;
      if (available < 1) continue;

      const fromHasEnemies = fromNode.neighbors.some(
        (nId) => state.territories[nId].ownerId !== aiPlayer.id,
      );
      if (fromHasEnemies) continue;

      const frontlineNeighborId = fromNode.neighbors.find((nId) => {
        if (state.territories[nId].ownerId !== aiPlayer.id) return false;
        return graph.territories[nId].neighbors.some(
          (nnId) => state.territories[nnId].ownerId !== aiPlayer.id,
        );
      });

      if (frontlineNeighborId) {
        return {
          type: 'FORTIFY',
          playerId: aiPlayer.id,
          fromId: fromNode.id,
          toId: frontlineNeighborId,
          armies: available,
        };
      }
    }

    return {
      type: 'END_TURN',
      playerId: aiPlayer.id,
    };
  }

  return {
    type: 'END_TURN',
    playerId: aiPlayer.id,
  };
}
