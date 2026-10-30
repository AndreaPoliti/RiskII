// src/engine/models/game.models.ts
import { ContinentId, MapVariant, TerritoryId } from '@engine/map/map.models';

export type TurnPhase = 'DEPLOY' | 'ATTACK' | 'OCCUPY' | 'FORTIFY' | 'GAME_OVER';

export type CardSymbol = 'INFANTRY' | 'CAVALRY' | 'ARTILLERY' | 'WILD';

export interface TerritoryCard {
  id: string;
  territoryId: TerritoryId | null; // null per le carte Jolly (WILD)
  symbol: CardSymbol;
}

export type AiGeneralId = 'CAMPBELL' | 'VAUBAN' | 'MARLBOROUGH' | 'NAPOLEON';

export interface PlayerConfig {
  id: string;
  name: string;
  color: string;
  isAi: boolean;
  aiGeneralId?: AiGeneralId;
}

export interface PlayerState extends PlayerConfig {
  isEliminated: boolean;
  reinforcementsAvailable: number;
  conqueredTerritoryThisTurn: boolean;
  cards: TerritoryCard[];
}

export interface TerritoryState {
  id: TerritoryId;
  ownerId: string;
  armies: number;
}

export interface PendingOccupation {
  fromId: TerritoryId;
  toId: TerritoryId;
  minArmies: number;
  maxArmies: number;
}

export interface CombatReport {
  fromId: TerritoryId;
  toId: TerritoryId;
  attackerRolls: number[];
  defenderRolls: number[];
  attackerLosses: number;
  defenderLosses: number;
  conquered: boolean;
  roundsFought: number;
}

export interface ReinforcementBreakdown {
  ownedTerritoriesCount: number;
  largestConnectedEmpire: number;
  baseArmies: number;
  continentBonuses: { continentId: ContinentId; name: string; bonus: number }[];
  totalArmies: number;
}

export interface FullGameState {
  gameId: string;
  mapVariant: MapVariant;
  rngState: number;
  turnNumber: number;
  activePlayerIndex: number;
  phase: TurnPhase;
  players: PlayerState[];
  territories: Record<TerritoryId, TerritoryState>;
  deck: TerritoryCard[];
  discardPile: TerritoryCard[];
  cardTradesCount: number;
  pendingOccupation: PendingOccupation | null;
  lastCombat: CombatReport | null;
  lastReinforcementBreakdown: ReinforcementBreakdown | null;
  winnerId: string | null;
}

export type PlayerViewState = Omit<FullGameState, 'rngState' | 'deck' | 'discardPile'> & {
  deckCount: number;
};

// ================= COMANDI (Command Pattern) =================

export type GameCommand =
  | {
      type: 'TRADE_CARDS';
      playerId: string;
      cardIds: [string, string, string];
    }
  | {
      type: 'DEPLOY_ARMIES';
      playerId: string;
      territoryId: TerritoryId;
      armies: number;
    }
  | {
      type: 'ATTACK';
      playerId: string;
      fromId: TerritoryId;
      toId: TerritoryId;
      mode: 'SINGLE' | 'BLITZ';
      attackerDice?: 1 | 2 | 3;
    }
  | {
      type: 'OCCUPY_TERRITORY';
      playerId: string;
      armiesToMove: number;
    }
  | {
      type: 'END_ATTACK_PHASE';
      playerId: string;
    }
  | {
      type: 'FORTIFY';
      playerId: string;
      fromId: TerritoryId;
      toId: TerritoryId;
      armies: number;
    }
  | {
      type: 'END_TURN';
      playerId: string;
    };

export interface ActionResult {
  success: boolean;
  error?: string;
  state: PlayerViewState;
}
