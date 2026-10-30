// src/engine/map/map.models.ts

export type MapVariant = 'RISK_II_48' | 'CLASSIC_42';

export type ContinentId =
  'north_america' | 'south_america' | 'europe' | 'africa' | 'asia' | 'oceania';

export type TerritoryId =
  // North America (11 in Risk II, 9 in Classic)
  | 'alaska'
  | 'northwest_territory'
  | 'greenland'
  | 'alberta'
  | 'ontario'
  | 'quebec'
  | 'western_united_states'
  | 'eastern_united_states'
  | 'central_america'
  | 'qikiqtaaluk' // Risk II Extra
  | 'hawaii' // Risk II Extra
  // South America (5 in Risk II, 4 in Classic)
  | 'venezuela'
  | 'peru'
  | 'brazil'
  | 'argentina'
  | 'falkland_islands' // Risk II Extra
  // Europe (8 in Risk II, 7 in Classic)
  | 'iceland'
  | 'great_britain'
  | 'scandinavia'
  | 'northern_europe'
  | 'western_europe'
  | 'southern_europe'
  | 'ukraine'
  | 'svalbard' // Risk II Extra
  // Africa (6)
  | 'north_africa'
  | 'egypt'
  | 'east_africa'
  | 'congo'
  | 'south_africa'
  | 'madagascar'
  // Asia (12)
  | 'ural'
  | 'siberia'
  | 'yakutsk'
  | 'kamchatka'
  | 'irkutsk'
  | 'mongolia'
  | 'japan'
  | 'afghanistan'
  | 'china'
  | 'middle_east'
  | 'india'
  | 'siam'
  // Oceania (6 in Risk II, 4 in Classic)
  | 'indonesia'
  | 'new_guinea'
  | 'western_australia'
  | 'eastern_australia'
  | 'philippines' // Risk II Extra
  | 'new_zealand'; // Risk II Extra

export interface ContinentDefinition {
  id: ContinentId;
  name: string;
  bonusArmies: number;
  color: string;
}

export interface TerritoryNode {
  id: TerritoryId;
  name: string;
  continentId: ContinentId;
  isRisk2Exclusive: boolean;
  /** Coordinate (x, y) su canvas/SVG 1200x650 per nodi, badge truppe e frecce */
  centroid: { x: number; y: number };
  /** Poligono SVG opzionale per il rendering della regione */
  svgPath?: string;
  neighbors: TerritoryId[];
}

export interface MapGraph {
  variant: MapVariant;
  continents: Record<ContinentId, ContinentDefinition>;
  territories: Record<TerritoryId, TerritoryNode>;
  territoryList: TerritoryNode[];
}
