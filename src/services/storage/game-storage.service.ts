// src/services/storage/game-storage.service.ts
import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { MapVariant } from '@engine/map/map.models';
import { FullGameState } from '@engine/models/game.models';

export interface SavedGameRecord {
  id: string; // 'autosave' oppure ID slot manuale
  title: string;
  updatedAt: number;
  turnNumber: number;
  mapVariant: MapVariant;
  activePlayerName: string;
  playersCount: number;
  fullState: FullGameState;
}

@Injectable({ providedIn: 'root' })
export class GameStorageService extends Dexie {
  savedGames!: Table<SavedGameRecord, string>;

  constructor() {
    super('Risik2Database');
    this.version(1).stores({
      savedGames: 'id, updatedAt, mapVariant',
    });
  }

  async saveAutosave(state: FullGameState): Promise<void> {
    const activePlayer = state.players[state.activePlayerIndex];
    const record: SavedGameRecord = {
      id: 'autosave',
      title: 'Salvataggio Automatico',
      updatedAt: Date.now(),
      turnNumber: state.turnNumber,
      mapVariant: state.mapVariant,
      activePlayerName: activePlayer?.name ?? 'Sconosciuto',
      playersCount: state.players.length,
      fullState: structuredClone(state),
    };
    await this.savedGames.put(record);
  }

  async saveManualSlot(title: string, state: FullGameState): Promise<void> {
    const activePlayer = state.players[state.activePlayerIndex];
    const id = `save-${Date.now()}`;
    const record: SavedGameRecord = {
      id,
      title: title.trim() || `Partita Turno #${state.turnNumber}`,
      updatedAt: Date.now(),
      turnNumber: state.turnNumber,
      mapVariant: state.mapVariant,
      activePlayerName: activePlayer?.name ?? 'Sconosciuto',
      playersCount: state.players.length,
      fullState: structuredClone(state),
    };
    await this.savedGames.put(record);
  }

  async getAllSaves(): Promise<SavedGameRecord[]> {
    const list = await this.savedGames.orderBy('updatedAt').reverse().toArray();
    // Mantiene sempre l'autosave in cima alla lista se presente
    return list.sort((a, b) => {
      if (a.id === 'autosave') return -1;
      if (b.id === 'autosave') return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  async deleteSave(id: string): Promise<void> {
    await this.savedGames.delete(id);
  }
}
