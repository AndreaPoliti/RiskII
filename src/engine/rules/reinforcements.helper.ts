// src/engine/rules/reinforcements.helper.ts
import { getLargestConnectedEmpireSize } from '@engine/map/map-graph.helper';
import { ContinentId, MapGraph, TerritoryId } from '@engine/map/map.models';
import { ReinforcementBreakdown, TerritoryState } from '@engine/models/game.models';

/**
 * Formula ufficiale Risk II:
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

  // Verifica controllo continenti
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
