// src/engine/ai/ai-bot.ts
import { MapGraph, TerritoryId } from '@engine/map/map.models';
import { AiGeneralId, GameCommand, PlayerViewState } from '@engine/models/game.models';
import { findValidCardSetInHand } from '@engine/rules/cards.helper';
import { getTerritoryDeployQuota } from '@engine/rules/reinforcements.helper';

export interface AiPersonalityProfile {
  id: AiGeneralId;
  title: string;
  minAttackRatio: number;
  minArmyAdvantage: number;
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

export function computeNextAiCommand(state: PlayerViewState, graph: MapGraph): GameCommand {
  const aiPlayer = state.players[state.activePlayerIndex];
  const profile = AI_GENERALS[aiPlayer.aiGeneralId ?? 'MARLBOROUGH'];

  const myTerritories = graph.territoryList.filter(
    (t) => state.territories[t.id].ownerId === aiPlayer.id,
  );

  // ================= 1. FASE DEPLOY (Con limite 1 + confinanti controllati) =================
  if (state.phase === 'DEPLOY') {
    const validSet = findValidCardSetInHand(aiPlayer.cards);
    if (validSet) {
      return {
        type: 'TRADE_CARDS',
        playerId: aiPlayer.id,
        cardIds: [validSet[0].id, validSet[1].id, validSet[2].id],
      };
    }

    // Filtra solo i territori che hanno ancora quota disponibile in questo turno
    const eligibleTerritories = myTerritories
      .map((node) => ({
        node,
        quota: getTerritoryDeployQuota(
          graph,
          state.territories,
          state.deployedThisTurn,
          node.id,
          aiPlayer.id,
          aiPlayer.reinforcementsAvailable,
        ),
      }))
      .filter((item) => item.quota.remainingAllowed > 0);

    let bestTargetId: TerritoryId = eligibleTerritories[0]?.node.id ?? myTerritories[0].id;
    let maxAllowedOnBest = eligibleTerritories[0]?.quota.remainingAllowed ?? 1;
    let bestScore = -Infinity;

    for (const { node, quota } of eligibleTerritories) {
      const enemyNeighbors = node.neighbors.filter(
        (nId) => state.territories[nId].ownerId !== aiPlayer.id,
      );

      const continentNodes = graph.territoryList.filter((t) => t.continentId === node.continentId);
      const ownedInContinent = continentNodes.filter(
        (t) => state.territories[t.id].ownerId === aiPlayer.id,
      ).length;
      const continentCompletionRatio = ownedInContinent / continentNodes.length;

      const weakestEnemyArmies =
        enemyNeighbors.length > 0
          ? Math.min(...enemyNeighbors.map((nId) => state.territories[nId].armies))
          : 50;
      const myArmies = state.territories[node.id].armies;

      const frontlineBonus = enemyNeighbors.length > 0 ? 25 : 0;
      const score =
        frontlineBonus +
        continentCompletionRatio * profile.continentFocusBonus +
        (myArmies - weakestEnemyArmies) * 2 +
        enemyNeighbors.length;

      if (score > bestScore) {
        bestScore = score;
        bestTargetId = node.id;
        maxAllowedOnBest = quota.remainingAllowed;
      }
    }

    const deployAmount = Math.max(1, Math.min(maxAllowedOnBest, aiPlayer.reinforcementsAvailable));

    return {
      type: 'DEPLOY_ARMIES',
      playerId: aiPlayer.id,
      territoryId: bestTargetId,
      armies: deployAmount,
    };
  }

  // ================= 2. FASE OCCUPY =================
  if (state.phase === 'OCCUPY' && state.pendingOccupation) {
    const { fromId, maxArmies } = state.pendingOccupation;
    const fromNode = graph.territories[fromId];
    const fromStillOnFrontline = fromNode.neighbors.some(
      (nId) => state.territories[nId].ownerId !== aiPlayer.id,
    );

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
    // Se l'IA ha già effettuato uno spostamento in questo turno, passa il turno
    if (state.fortifySourceId) {
      return {
        type: 'END_TURN',
        playerId: aiPlayer.id,
      };
    }

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
