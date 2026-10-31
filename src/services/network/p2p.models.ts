// src/services/network/p2p.models.ts
import { MapVariant } from '@engine/map/map.models';
import { AiGeneralId, GameCommand, PlayerViewState } from '@engine/models/game.models';

export type NetworkMode = 'OFFLINE' | 'HOST' | 'GUEST';

export interface LobbySlotInfo {
  id: string; // 'p1', 'p2', ...
  name: string;
  color: string;
  isAi: boolean;
  aiGeneralId?: AiGeneralId;
  /** Valorizzato se lo slot è occupato da un giocatore umano (Host o Guest) */
  assignedClientSecretId?: string;
  isOnlineConnected?: boolean;
}

// Messaggi inviati dai Guest -> Host
export type ClientToHostMessage =
  | {
      type: 'JOIN_LOBBY';
      clientSecretId: string;
      playerName: string;
    }
  | {
      type: 'CLAIM_SLOT';
      clientSecretId: string;
      slotId: string;
      playerName: string;
    }
  | {
      type: 'GAME_COMMAND';
      clientSecretId: string;
      command: GameCommand;
    };

// Messaggi inviati dall'Host -> Guest
export type HostToClientMessage =
  | {
      type: 'LOBBY_SYNC';
      roomCode: string;
      mapVariant: MapVariant;
      slots: LobbySlotInfo[];
      yourPlayerId: string | null;
      isGameInProgress: boolean;
    }
  | {
      type: 'STATE_SYNC';
      yourPlayerId: string | null;
      state: PlayerViewState;
      isAiThinking: boolean;
      isLobbyOpen: boolean;
    }
  | {
      type: 'COMMAND_ERROR';
      error: string;
    };
