// src/services/gateway/local-session.gateway.ts
import { computed, inject, Injectable, signal } from '@angular/core';
import { Peer, DataConnection } from 'peerjs';
import { computeNextAiCommand } from '@engine/ai/ai-bot';
import { MapVariant } from '@engine/map/map.models';
import {
  ActionResult,
  FullGameState,
  GameCommand,
  PlayerConfig,
  PlayerViewState,
} from '@engine/models/game.models';
import { RiskEngine } from '@engine/risk-engine';
import {
  ClientToHostMessage,
  HostToClientMessage,
  LobbySlotInfo,
  NetworkMode,
} from '@services/network/p2p.models';
import { GameStorageService, SavedGameRecord } from '@services/storage/game-storage.service';

const PEER_PREFIX = 'risik2-p2p-room-';
const SECRET_STORAGE_KEY = 'risik2_client_secret_id';

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

export const DEFAULT_PLAYERS: LobbySlotInfo[] = [
  { id: 'p1', name: 'Comandante (Host)', color: '#ef4444', isAi: false },
  {
    id: 'p2',
    name: 'Gen. Bonaparte',
    color: '#3b82f6',
    isAi: true,
    aiGeneralId: 'NAPOLEON',
  },
  {
    id: 'p3',
    name: 'Maresciallo Vauban',
    color: '#22c55e',
    isAi: true,
    aiGeneralId: 'VAUBAN',
  },
  {
    id: 'p4',
    name: 'Duca Marlborough',
    color: '#eab308',
    isAi: true,
    aiGeneralId: 'MARLBOROUGH',
  },
];

@Injectable({ providedIn: 'root' })
export class LocalSessionGateway {
  private readonly storage = inject(GameStorageService);
  private engine!: RiskEngine;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;

  // Istanza PeerJS e connessioni WebRTC
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null; // Usato se GUEST
  private guestConnections = new Map<string, DataConnection>(); // clientSecretId -> conn (Usato se HOST)
  private readonly clientSecretId: string;

  // Signals di Stato Partita
  readonly state = signal<PlayerViewState>(null!);
  readonly lastError = signal<string | null>(null);
  readonly isAiThinking = signal<boolean>(false);
  readonly isLobbyOpen = signal<boolean>(true);
  readonly savedGames = signal<SavedGameRecord[]>([]);

  // Signals Multiplayer P2P
  readonly networkMode = signal<NetworkMode>('OFFLINE');
  readonly roomCode = signal<string | null>(null);
  readonly connectionStatus = signal<string>('Modalità Locale (Offline)');
  readonly localPlayerId = signal<string | null>('p1');
  readonly lobbySlots = signal<LobbySlotInfo[]>(structuredClone(DEFAULT_PLAYERS));
  readonly lobbyMapVariant = signal<MapVariant>('RISK_II_48');

  readonly activePlayer = computed(() => {
    const s = this.state();
    return s.players[s.activePlayerIndex];
  });

  /**
   * Stabilisce se chi sta guardando questo schermo ha il permesso di muovere adesso.
   * - In OFFLINE: può muovere qualsiasi giocatore umano (HotSeat).
   * - In HOST / GUEST: può muovere solo se il turno attivo appartiene al suo localPlayerId.
   */
  readonly canActNow = computed(() => {
    if (this.isAiThinking()) return false;
    const active = this.activePlayer();
    if (!active || active.isAi) return false;

    if (this.networkMode() === 'OFFLINE') {
      return true;
    }
    return active.id === this.localPlayerId();
  });

  /** Restituisce il giocatore locale (per mostrare sempre le proprie carte in basso) */
  readonly myViewerPlayer = computed(() => {
    const s = this.state();
    if (this.networkMode() === 'OFFLINE') {
      return this.activePlayer();
    }
    const myId = this.localPlayerId();
    return s.players.find((p) => p.id === myId) ?? this.activePlayer();
  });

  constructor() {
    this.clientSecretId = this.getOrCreateClientSecret();
    this.engine = RiskEngine.createNewGame({
      mapVariant: 'RISK_II_48',
      players: DEFAULT_PLAYERS,
    });
    this.state.set(this.engine.getPlayerView());
    void this.refreshSavesList();
  }

  // ================= GESTIONE MULTIPLAYER P2P (HOST & GUEST) =================

  /**
   * Avvia una stanza come HOST generando un codice breve (es. RSK-4821)
   */
  hostOnlineRoom(hostName: string): void {
    this.disconnectNetwork();
    const shortCode = `RSK-${Math.floor(1000 + Math.random() * 9000)}`;
    const fullPeerId = `${PEER_PREFIX}${shortCode}`;

    this.connectionStatus.set('Creazione stanza P2P in corso...');
    const peer = new Peer(fullPeerId, PEER_CONFIG);
    this.peer = peer;

    peer.on('open', () => {
      this.networkMode.set('HOST');
      this.roomCode.set(shortCode);
      this.localPlayerId.set('p1');
      this.connectionStatus.set(`Stanza attiva (${shortCode}) — In attesa di amici`);

      // Assegna lo slot 1 all'Host
      const slots = structuredClone(this.lobbySlots());
      if (slots.length > 0) {
        slots[0].id = 'p1';
        slots[0].name = hostName.trim() || 'Host';
        slots[0].isAi = false;
        slots[0].assignedClientSecretId = this.clientSecretId;
        slots[0].isOnlineConnected = true;
      }
      this.lobbySlots.set(slots);
    });

    peer.on('connection', (conn) => {
      this.setupHostIncomingConnection(conn);
    });

    peer.on('error', (err) => {
      this.lastError.set(`Errore rete P2P: ${err.type}`);
      this.connectionStatus.set(`Errore P2P: ${err.type}`);
    });
  }

  /**
   * Si collega come GUEST alla stanza creata da un amico
   */
  joinOnlineRoom(codeInput: string, guestName: string): void {
    const cleanCode = codeInput.trim().toUpperCase();
    if (!cleanCode) return;

    this.disconnectNetwork();
    const normalizedCode = cleanCode.startsWith('RSK-') ? cleanCode : `RSK-${cleanCode}`;
    const hostPeerId = `${PEER_PREFIX}${normalizedCode}`;

    this.connectionStatus.set(`Connessione a ${normalizedCode}...`);
    const peer = new Peer(PEER_CONFIG);
    this.peer = peer;

    peer.on('open', () => {
      const conn = peer.connect(hostPeerId, { reliable: true });
      this.hostConnection = conn;

      conn.on('open', () => {
        this.networkMode.set('GUEST');
        this.roomCode.set(normalizedCode);
        this.connectionStatus.set(`Connesso alla stanza ${normalizedCode}`);

        const joinMsg: ClientToHostMessage = {
          type: 'JOIN_LOBBY',
          clientSecretId: this.clientSecretId,
          playerName: guestName.trim() || 'Ospite',
        };
        conn.send(joinMsg);
      });

      conn.on('data', (raw) => {
        this.handleHostMessageOnGuest(raw as HostToClientMessage);
      });

      conn.on('close', () => {
        this.connectionStatus.set('Disconnesso dall’Host');
        this.lastError.set('La connessione con l’Host è stata chiusa.');
      });
    });

    peer.on('error', (err) => {
      this.connectionStatus.set(`Impossibile connettersi (${err.type})`);
      this.lastError.set(`Stanza ${normalizedCode} non trovata o non raggiungibile.`);
    });
  }

  /**
   * Permette a un Guest di reclamare uno specifico slot nella Lobby
   */
  claimLobbySlot(slotId: string, playerName: string): void {
    if (this.networkMode() === 'GUEST' && this.hostConnection) {
      const msg: ClientToHostMessage = {
        type: 'CLAIM_SLOT',
        clientSecretId: this.clientSecretId,
        slotId,
        playerName,
      };
      this.hostConnection.send(msg);
    }
  }

  disconnectNetwork(): void {
    this.guestConnections.forEach((c) => c.close());
    this.guestConnections.clear();
    this.hostConnection?.close();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;

    this.networkMode.set('OFFLINE');
    this.roomCode.set(null);
    this.localPlayerId.set('p1');
    this.connectionStatus.set('Modalità Locale (Offline)');
  }

  // ================= LOGICA INTERNA HOST P2P =================

  private setupHostIncomingConnection(conn: DataConnection): void {
    let guestSecret: string | null = null;

    conn.on('data', (raw) => {
      const msg = raw as ClientToHostMessage;
      guestSecret = msg.clientSecretId;
      this.guestConnections.set(guestSecret, conn);

      if (msg.type === 'JOIN_LOBBY') {
        this.assignOrReconnectGuestSlot(msg.clientSecretId, msg.playerName);
        this.broadcastLobbyFromHost();
        // Se la partita è già iniziata, sincronizza subito la mappa al Guest!
        if (!this.isLobbyOpen()) {
          this.broadcastGameStateFromHost();
        }
      } else if (msg.type === 'CLAIM_SLOT') {
        this.assignGuestToSpecificSlot(msg.clientSecretId, msg.slotId, msg.playerName);
        this.broadcastLobbyFromHost();
      } else if (msg.type === 'GAME_COMMAND') {
        this.handleRemoteGuestCommand(msg.clientSecretId, msg.command, conn);
      }
    });

    conn.on('close', () => {
      if (guestSecret) {
        this.guestConnections.delete(guestSecret);
        const updated = this.lobbySlots().map((s) =>
          s.assignedClientSecretId === guestSecret ? { ...s, isOnlineConnected: false } : s,
        );
        this.lobbySlots.set(updated);
        this.broadcastLobbyFromHost();
      }
    });
  }

  private assignOrReconnectGuestSlot(secretId: string, name: string): void {
    const slots = structuredClone(this.lobbySlots());

    // 1. Verifica se questo amico era già associato a uno slot (riconnessione dopo F5)
    let existing = slots.find((s) => s.assignedClientSecretId === secretId);
    if (existing) {
      existing.isOnlineConnected = true;
      existing.name = name || existing.name;
      this.lobbySlots.set(slots);
      return;
    }

    // 2. Cerca il primo slot Umano libero oppure trasforma il primo slot IA in Umano per l'amico
    let target =
      slots.find((s) => !s.isAi && !s.assignedClientSecretId) ?? slots.find((s) => s.isAi);

    if (target) {
      target.isAi = false;
      delete target.aiGeneralId;
      target.name = name;
      target.assignedClientSecretId = secretId;
      target.isOnlineConnected = true;
    } else if (slots.length < 6) {
      const newIdx = slots.length + 1;
      slots.push({
        id: `p${newIdx}`,
        name,
        color: '#a855f7',
        isAi: false,
        assignedClientSecretId: secretId,
        isOnlineConnected: true,
      });
    }

    this.lobbySlots.set(slots);
  }

  private assignGuestToSpecificSlot(secretId: string, slotId: string, name: string): void {
    const slots = structuredClone(this.lobbySlots());
    const target = slots.find((s) => s.id === slotId);
    if (!target || target.assignedClientSecretId === this.clientSecretId) return;

    // Libera il vecchio slot del Guest
    for (const s of slots) {
      if (s.assignedClientSecretId === secretId) {
        s.assignedClientSecretId = undefined;
        s.isOnlineConnected = false;
      }
    }

    target.isAi = false;
    delete target.aiGeneralId;
    target.name = name || target.name;
    target.assignedClientSecretId = secretId;
    target.isOnlineConnected = true;

    this.lobbySlots.set(slots);
  }

  private handleRemoteGuestCommand(
    secretId: string,
    command: GameCommand,
    conn: DataConnection,
  ): void {
    const slot = this.lobbySlots().find((s) => s.assignedClientSecretId === secretId);
    if (!slot) {
      conn.send({
        type: 'COMMAND_ERROR',
        error: 'Non sei associato a nessun giocatore in questa partita.',
      } satisfies HostToClientMessage);
      return;
    }

    // Forza il playerId reale associato al canale WebRTC del Guest (Anti-Spoofing)
    const verifiedCommand: GameCommand = {
      ...command,
      playerId: slot.id,
    };

    const res = this.dispatch(verifiedCommand);
    if (!res.success && res.error) {
      conn.send({
        type: 'COMMAND_ERROR',
        error: res.error,
      } satisfies HostToClientMessage);
    }
  }

  public broadcastLobbyFromHost(): void {
    if (this.networkMode() !== 'HOST') return;
    const code = this.roomCode() ?? '';
    const slots = this.lobbySlots();

    for (const [secretId, conn] of this.guestConnections.entries()) {
      const assignedSlot = slots.find((s) => s.assignedClientSecretId === secretId);
      const msg: HostToClientMessage = {
        type: 'LOBBY_SYNC',
        roomCode: code,
        mapVariant: this.lobbyMapVariant(),
        slots,
        yourPlayerId: assignedSlot?.id ?? null,
        isGameInProgress: !this.isLobbyOpen(),
      };
      conn.send(msg);
    }
  }

  private broadcastGameStateFromHost(): void {
    if (this.networkMode() !== 'HOST') return;
    const slots = this.lobbySlots();

    for (const [secretId, conn] of this.guestConnections.entries()) {
      const assignedSlot = slots.find((s) => s.assignedClientSecretId === secretId);
      const viewerId = assignedSlot?.id;
      const msg: HostToClientMessage = {
        type: 'STATE_SYNC',
        yourPlayerId: viewerId ?? null,
        state: this.engine.getPlayerView(viewerId),
        isAiThinking: this.isAiThinking(),
        isLobbyOpen: this.isLobbyOpen(),
      };
      conn.send(msg);
    }
  }

  private handleHostMessageOnGuest(msg: HostToClientMessage): void {
    if (msg.type === 'LOBBY_SYNC') {
      this.lobbyMapVariant.set(msg.mapVariant);
      this.lobbySlots.set(msg.slots);
      this.localPlayerId.set(msg.yourPlayerId);
    } else if (msg.type === 'STATE_SYNC') {
      this.localPlayerId.set(msg.yourPlayerId);
      this.state.set(msg.state);
      this.isAiThinking.set(msg.isAiThinking);
      this.isLobbyOpen.set(msg.isLobbyOpen);
      this.lastError.set(null);
    } else if (msg.type === 'COMMAND_ERROR') {
      this.lastError.set(msg.error);
    }
  }

  // ================= GESTIONE PARTITA & SALVATAGGI =================

  async refreshSavesList(): Promise<void> {
    const saves = await this.storage.getAllSaves();
    this.savedGames.set(saves);
  }

  startNewGame(
    mapVariant: MapVariant = this.lobbyMapVariant(),
    players: PlayerConfig[] = this.lobbySlots(),
  ): void {
    if (this.networkMode() === 'GUEST') return;

    this.clearAiTimer();
    this.engine = RiskEngine.createNewGame({ mapVariant, players });
    const viewerId =
      this.networkMode() === 'HOST' ? (this.localPlayerId() ?? undefined) : undefined;
    this.state.set(this.engine.getPlayerView(viewerId));
    this.lastError.set(null);
    this.isLobbyOpen.set(false);

    this.persistAutosave();
    this.broadcastGameStateFromHost();
    this.scheduleAiIfNeeded();
  }

  loadSavedGame(record: SavedGameRecord): void {
    if (this.networkMode() === 'GUEST') return;

    this.clearAiTimer();
    const restoredState: FullGameState = structuredClone(record.fullState);
    this.engine = new RiskEngine(restoredState);

    // Sincronizza gli slot della Lobby con i giocatori del salvataggio caricato
    const currentSlots = this.lobbySlots();
    const syncedSlots: LobbySlotInfo[] = restoredState.players.map((p, idx) => {
      const existingSlot = currentSlots[idx];
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        isAi: p.isAi,
        aiGeneralId: p.aiGeneralId,
        assignedClientSecretId: p.isAi ? undefined : existingSlot?.assignedClientSecretId,
        isOnlineConnected: p.isAi ? false : existingSlot?.isOnlineConnected,
      };
    });
    this.lobbySlots.set(syncedSlots);

    const viewerId =
      this.networkMode() === 'HOST' ? (this.localPlayerId() ?? undefined) : undefined;
    this.state.set(this.engine.getPlayerView(viewerId));
    this.lastError.set(null);
    this.isLobbyOpen.set(false);

    this.broadcastLobbyFromHost();
    this.broadcastGameStateFromHost();
    this.scheduleAiIfNeeded();
  }

  async saveManualGame(title: string): Promise<void> {
    if (this.networkMode() === 'GUEST') return;
    await this.storage.saveManualSlot(title, this.engine.getFullState());
    await this.refreshSavesList();
  }

  async deleteSavedGame(id: string): Promise<void> {
    await this.storage.deleteSave(id);
    await this.refreshSavesList();
  }

  dispatch(command: GameCommand): ActionResult {
    // Se siamo un GUEST connesso in P2P, inoltriamo il comando all'Host via WebRTC
    if (this.networkMode() === 'GUEST') {
      if (this.hostConnection) {
        const msg: ClientToHostMessage = {
          type: 'GAME_COMMAND',
          clientSecretId: this.clientSecretId,
          command,
        };
        this.hostConnection.send(msg);
      }
      return { success: true, state: this.state() };
    }

    // Esecuzione autoritativa (OFFLINE oppure HOST)
    const result = this.engine.dispatch(command);
    const viewerId =
      this.networkMode() === 'HOST' ? (this.localPlayerId() ?? undefined) : undefined;
    this.state.set(this.engine.getPlayerView(viewerId));
    this.lastError.set(result.error ?? null);

    if (result.success) {
      this.persistAutosave();
      this.broadcastGameStateFromHost();
    }

    this.scheduleAiIfNeeded();
    return result;
  }

  openLobby(): void {
    this.clearAiTimer();
    this.isAiThinking.set(false);
    void this.refreshSavesList();
    this.isLobbyOpen.set(true);
    this.broadcastGameStateFromHost();
  }

  resumeCurrentGame(): void {
    this.isLobbyOpen.set(false);
    this.broadcastGameStateFromHost();
    this.scheduleAiIfNeeded();
  }

  private persistAutosave(): void {
    if (this.networkMode() === 'GUEST') return;
    void this.storage.saveAutosave(this.engine.getFullState()).then(() => this.refreshSavesList());
  }

  private scheduleAiIfNeeded(): void {
    this.clearAiTimer();
    if (this.networkMode() === 'GUEST' || this.isLobbyOpen()) {
      this.isAiThinking.set(false);
      return;
    }

    const current = this.state();
    if (current.phase === 'GAME_OVER') {
      this.isAiThinking.set(false);
      this.broadcastGameStateFromHost();
      return;
    }

    const active = current.players[current.activePlayerIndex];
    if (!active.isAi) {
      this.isAiThinking.set(false);
      this.broadcastGameStateFromHost();
      return;
    }

    this.isAiThinking.set(true);
    this.broadcastGameStateFromHost();

    this.aiTimer = setTimeout(() => {
      const cmd = computeNextAiCommand(this.engine.getPlayerView(), this.engine.getMapGraph());
      const res = this.engine.dispatch(cmd);

      if (!res.success) {
        this.engine.dispatch({ type: 'END_TURN', playerId: active.id });
      }

      const viewerId =
        this.networkMode() === 'HOST' ? (this.localPlayerId() ?? undefined) : undefined;
      this.state.set(this.engine.getPlayerView(viewerId));

      this.persistAutosave();
      this.broadcastGameStateFromHost();
      this.scheduleAiIfNeeded();
    }, 350);
  }

  private clearAiTimer(): void {
    if (this.aiTimer !== null) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  private getOrCreateClientSecret(): string {
    const existing = localStorage.getItem(SECRET_STORAGE_KEY);
    if (existing) return existing;
    const generated = `secret_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
    localStorage.setItem(SECRET_STORAGE_KEY, generated);
    return generated;
  }
}
