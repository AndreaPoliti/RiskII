// src/engine/map/map-graph.helper.ts
import { CONTINENTS_DATA, TERRITORIES_DATA } from './risk2-map.data';
import { MapGraph, MapVariant, TerritoryId, TerritoryNode } from './map.models';

/**
 * Costruisce il grafo della mappa filtrando dinamicamente i 6 territori esclusivi
 * se la modalità scelta è CLASSIC_42.
 */
export function buildMapGraph(variant: MapVariant = 'RISK_II_48'): MapGraph {
  const filteredEntries = Object.entries(TERRITORIES_DATA).filter(([_, node]) =>
    variant === 'RISK_II_48' ? true : !node.isRisk2Exclusive,
  );

  const activeIds = new Set<TerritoryId>(filteredEntries.map(([id]) => id as TerritoryId));
  const territories = {} as Record<TerritoryId, TerritoryNode>;

  for (const [id, node] of filteredEntries) {
    territories[id as TerritoryId] = {
      ...node,
      neighbors: node.neighbors.filter((nId) => activeIds.has(nId)),
    };
  }

  return {
    variant,
    continents: CONTINENTS_DATA,
    territories,
    territoryList: Object.values(territories),
  };
}

/** Verifica se due territori sono confinanti nella variante di mappa attiva */
export function areTerritoriesAdjacent(
  graph: MapGraph,
  fromId: TerritoryId,
  toId: TerritoryId,
): boolean {
  const fromNode = graph.territories[fromId];
  return Boolean(fromNode && fromNode.neighbors.includes(toId));
}

/**
 * Calcola la dimensione dell'"Impero Connesso più grande" (Largest Connected Empire)
 * di un giocatore usando Breadth-First Search (BFS), necessario per la formula
 * dei rinforzi di Risk II: floor((totTerritori + maxImperoConnesso) / 3).
 */
export function getLargestConnectedEmpireSize(
  graph: MapGraph,
  ownedTerritories: ReadonlySet<TerritoryId>,
): number {
  const visited = new Set<TerritoryId>();
  let maxClusterSize = 0;

  for (const startId of ownedTerritories) {
    if (visited.has(startId) || !graph.territories[startId]) continue;

    let currentClusterSize = 0;
    const queue: TerritoryId[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      currentClusterSize++;

      const neighbors = graph.territories[currentId]?.neighbors ?? [];
      for (const neighborId of neighbors) {
        if (ownedTerritories.has(neighborId) && !visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    if (currentClusterSize > maxClusterSize) {
      maxClusterSize = currentClusterSize;
    }
  }

  return maxClusterSize;
}

/**
 * Self-check di integrità del grafo: garantisce che se A confina con B,
 * anche B confina con A (nessun arco unidirezionale rotto).
 */
export function validateGraphSymmetry(graph: MapGraph): string[] {
  const errors: string[] = [];
  for (const node of graph.territoryList) {
    for (const neighborId of node.neighbors) {
      const neighbor = graph.territories[neighborId];
      if (!neighbor) {
        errors.push(`Territorio mancante: ${node.id} punta a ${neighborId}`);
        continue;
      }
      if (!neighbor.neighbors.includes(node.id)) {
        errors.push(
          `Asimmetria: ${node.id} -> ${neighborId}, ma ${neighborId} non punta a ${node.id}`,
        );
      }
    }
  }
  return errors;
}
