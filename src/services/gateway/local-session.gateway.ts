// src/services/gateway/local-session.gateway.ts
import { computed, Injectable, signal } from '@angular/core';
import { computeNextAiCommand } from '@engine/ai/ai-bot';
import { MapVariant } from '@engine/map/map.models';
import {
  ActionResult,
  GameCommand,
  PlayerConfig,
  PlayerViewState,
} from '@engine/models/game.models';
import { RiskEngine } from '@engine/risk-engine';

const DEFAULT_PLAYERS: PlayerConfig[] = [
  { id: 'p1', name: 'Tu (Comandante)', color: '#ef4444', isAi: false },
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
  private engine!: RiskEngine;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = signal<PlayerViewState>(null!);
  readonly lastError = signal<string | null>(null);
  readonly isAiThinking = signal<boolean>(false);

  readonly activePlayer = computed(() => {
    const s = this.state();
    return s.players[s.activePlayerIndex];
  });

  constructor() {
    this.startNewGame('RISK_II_48', DEFAULT_PLAYERS);
  }

  startNewGame(
    mapVariant: MapVariant = 'RISK_II_48',
    players: PlayerConfig[] = DEFAULT_PLAYERS,
  ): void {
    this.clearAiTimer();
    this.engine = RiskEngine.createNewGame({ mapVariant, players });
    this.state.set(this.engine.getPlayerView());
    this.lastError.set(null);
    this.scheduleAiIfNeeded();
  }

  dispatch(command: GameCommand): ActionResult {
    const result = this.engine.dispatch(command);
    this.state.set(result.state);
    this.lastError.set(result.error ?? null);
    this.scheduleAiIfNeeded();
    return result;
  }

  private scheduleAiIfNeeded(): void {
    this.clearAiTimer();
    const current = this.state();
    if (current.phase === 'GAME_OVER') {
      this.isAiThinking.set(false);
      return;
    }

    const active = current.players[current.activePlayerIndex];
    if (!active.isAi) {
      this.isAiThinking.set(false);
      return;
    }

    this.isAiThinking.set(true);
    this.aiTimer = setTimeout(() => {
      const cmd = computeNextAiCommand(this.state(), this.engine.getMapGraph());
      const res = this.engine.dispatch(cmd);
      this.state.set(res.state);

      // Sicurezza anti-loop: se per qualsiasi motivo un comando IA fallisce, forza il fine turno
      if (!res.success) {
        this.engine.dispatch({ type: 'END_TURN', playerId: active.id });
        this.state.set(this.engine.getPlayerView());
      }

      this.scheduleAiIfNeeded();
    }, 320);
  }

  private clearAiTimer(): void {
    if (this.aiTimer !== null) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }
}
