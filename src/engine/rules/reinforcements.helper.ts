// src/engine/rules/reinforcements.helper.ts
import { getLargestConnectedEmpireSize } from '@engine/map/map-graph.helper';
import { ContinentId, MapGraph, TerritoryId } from '@engine/map/map.models';
import { ReinforcementBreakdown, TerritoryState } from '@engine/models/game.models';

export interface TerritoryDeployQuotaInfo {
  friendlyNeighborsCount: number;
  maxPerTurn: number;
  alreadyDeployed: number;
  remainingAllowed: number;
  isCapBypassed: boolean;
}

/**
 * Formula ufficiale Risk II per il totale rinforzi a inizio turno:
 * Base = max(3, floor((Territori Posseduti + Impero Connesso Più Grande) / 3))
 * + Bonus Continenti controllati al 100%.
 */
export function calculateRisk2Reinforcements(
  graph: MapGraph,
  territoriesState: Record<TerritoryId, TerritoryState>,
  playerId: string,
): ReinforcementBreakdown {
  const ownedSet = new Set<TerritoryId>();

  for (const node of graph.territoryList) {
    if (territoriesState[node.id]?.ownerId === playerId) {
      ownedSet.add(node.id);
    }
  }

  const ownedTerritoriesCount = ownedSet.size;
  const largestConnectedEmpire = getLargestConnectedEmpireSize(graph, ownedSet);
  const baseArmies = Math.max(3, Math.floor((ownedTerritoriesCount + largestConnectedEmpire) / 3));

  const continentBonuses: { continentId: ContinentId; name: string; bonus: number }[] = [];
  const continentIds = Object.keys(graph.continents) as ContinentId[];

  for (const cId of continentIds) {
    const continentTerritories = graph.territoryList.filter((t) => t.continentId === cId);
    const controlsAll =
      continentTerritories.length > 0 && continentTerritories.every((t) => ownedSet.has(t.id));

    if (controlsAll) {
      const cDef = graph.continents[cId];
      continentBonuses.push({
        continentId: cId,
        name: cDef.name,
        bonus: cDef.bonusArmies,
      });
    }
  }

  const bonusSum = continentBonuses.reduce((acc, item) => acc + item.bonus, 0);

  return {
    ownedTerritoriesCount,
    largestConnectedEmpire,
    baseArmies,
    continentBonuses,
    totalArmies: baseArmies + bonusSum,
  };
}

/**
 * Calcola il limite massimo di rinforzi schierabili in un singolo territorio
 * durante il turno: [1 + numero di territori confinanti controllati dal giocatore].
 */
export function getTerritoryDeployQuota(
  graph: MapGraph,
  territoriesState: Record<TerritoryId, TerritoryState>,
  deployedThisTurn: Partial<Record<TerritoryId, number>>,
  territoryId: TerritoryId,
  playerId: string,
  reinforcementsAvailable: number,
): TerritoryDeployQuotaInfo {
  const node = graph.territories[territoryId];
  if (!node || territoriesState[territoryId]?.ownerId !== playerId) {
    return {
      friendlyNeighborsCount: 0,
      maxPerTurn: 0,
      alreadyDeployed: 0,
      remainingAllowed: 0,
      isCapBypassed: false,
    };
  }

  const friendlyNeighborsCount = node.neighbors.filter(
    (nId) => territoriesState[nId]?.ownerId === playerId,
  ).length;

  const maxPerTurn = 1 + friendlyNeighborsCount;
  const alreadyDeployed = deployedThisTurn[territoryId] ?? 0;
  const rawRemaining = Math.max(0, maxPerTurn - alreadyDeployed);

  // Salvaguardia anti-blocco: verifica se TUTTI i territori del giocatore hanno
  // esaurito la propria quota mentre restano ancora rinforzi da piazzare (es. dopo un grosso Tris).
  const ownedNodes = graph.territoryList.filter(
    (t) => territoriesState[t.id]?.ownerId === playerId,
  );
  const allTerritoriesCapped = ownedNodes.every((t) => {
    const fn = t.neighbors.filter((nId) => territoriesState[nId]?.ownerId === playerId).length;
    const cap = 1 + fn;
    const used = deployedThisTurn[t.id] ?? 0;
    return used >= cap;
  });

  if (allTerritoriesCapped && reinforcementsAvailable > 0) {
    return {
      friendlyNeighborsCount,
      maxPerTurn,
      alreadyDeployed,
      remainingAllowed: reinforcementsAvailable,
      isCapBypassed: true,
    };
  }

  return {
    friendlyNeighborsCount,
    maxPerTurn,
    alreadyDeployed,
    remainingAllowed: Math.min(rawRemaining, reinforcementsAvailable),
    isCapBypassed: false,
  };
}
