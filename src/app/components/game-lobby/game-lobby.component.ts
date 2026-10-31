// src/app/components/game-lobby/game-lobby.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AI_GENERALS } from '@engine/ai/ai-bot';
import { MapVariant } from '@engine/map/map.models';
import { AiGeneralId, PlayerConfig } from '@engine/models/game.models';
import { LocalSessionGateway } from '@services/gateway/local-session.gateway';
import { SavedGameRecord } from '@services/storage/game-storage.service';
import { LobbySlotInfo } from '@services/network/p2p.models';

const PALETTE = [
  '#ef4444', // Rosso
  '#3b82f6', // Blu
  '#22c55e', // Verde
  '#eab308', // Giallo
  '#a855f7', // Viola
  '#f97316', // Arancione
];

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-game-lobby',
  styleUrl: './game-lobby.component.scss',
  templateUrl: './game-lobby.component.html',
})
export class GameLobbyComponent {
  readonly gateway = inject(LocalSessionGateway);
  readonly generalsList = Object.values(AI_GENERALS);

  myPlayerName = 'Comandante';
  joinCodeInput = '';
  manualSaveTitle = '';

  setVariant(v: MapVariant): void {
    this.gateway.lobbyMapVariant.set(v);
    this.gateway.broadcastLobbyFromHost();
  }

  addPlayerSlot(isAi: boolean): void {
    const current = this.gateway.lobbySlots();
    if (current.length >= 6) return;

    const idx = current.length;
    const color = PALETTE[idx % PALETTE.length];
    const newSlot: LobbySlotInfo = isAi
      ? {
          id: `p${idx + 1}`,
          name: 'Brigadier Campbell',
          color,
          isAi: true,
          aiGeneralId: 'CAMPBELL',
        }
      : {
          id: `p${idx + 1}`,
          name: `Giocatore ${idx + 1}`,
          color,
          isAi: false,
        };

    this.gateway.lobbySlots.set([...current, newSlot]);
    this.gateway.broadcastLobbyFromHost();
  }

  removePlayerSlot(index: number): void {
    const current = this.gateway.lobbySlots();
    if (current.length <= 2) return;
    const filtered = current
      .filter((_, idx) => idx !== index)
      .map((s, idx) => ({ ...s, id: `p${idx + 1}` }));
    this.gateway.lobbySlots.set(filtered);
    this.gateway.broadcastLobbyFromHost();
  }

  onSlotTypeChange(slot: LobbySlotInfo, value: string): void {
    if (value === 'HUMAN') {
      slot.isAi = false;
      delete slot.aiGeneralId;
    } else {
      slot.isAi = true;
      slot.aiGeneralId = value as AiGeneralId;
      slot.assignedClientSecretId = undefined;
      slot.isOnlineConnected = false;
      const gen = AI_GENERALS[slot.aiGeneralId];
      if (gen) {
        slot.name = gen.title.split(' (')[0];
      }
    }
    this.gateway.broadcastLobbyFromHost();
  }

  onHostLobbyEdited(): void {
    this.gateway.broadcastLobbyFromHost();
  }

  startConfiguredGame(): void {
    const cleanSlots: LobbySlotInfo[] = this.gateway.lobbySlots().map((p, idx) => ({
      ...p,
      id: `p${idx + 1}`,
      name: p.name.trim() || `Giocatore ${idx + 1}`,
    }));
    this.gateway.lobbySlots.set(cleanSlots);
    this.gateway.broadcastLobbyFromHost();
    this.gateway.startNewGame(this.gateway.lobbyMapVariant(), cleanSlots);
  }

  async saveCurrent(): Promise<void> {
    await this.gateway.saveManualGame(this.manualSaveTitle);
    this.manualSaveTitle = '';
  }
}
