// src/app/components/map-board/map-board.component.ts
import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { areTerritoriesAdjacent, buildMapGraph } from '@engine/map/map-graph.helper';
import { MapVariant, TerritoryId, TerritoryNode } from '@engine/map/map.models';
import { findValidCardSetInHand, getCardTradeBonus } from '@engine/rules/cards.helper';
import { getTerritoryDeployQuota } from '@engine/rules/reinforcements.helper';
import { LocalSessionGateway } from '@services/gateway/local-session.gateway';

interface EdgeLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isWrapAround: boolean;
  isHighlighted: boolean;
}

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-map-board',
  styleUrl: './map-board.scss',
  templateUrl: './map-board.html',
})
export class MapBoardComponent {
  readonly gateway = inject(LocalSessionGateway);
  readonly Math = Math;

  readonly gameState = this.gateway.state;
  readonly activePlayer = this.gateway.activePlayer;

  readonly sourceId = signal<TerritoryId | null>(null);
  readonly targetId = signal<TerritoryId | null>(null);

  // Quantità selezionate tramite Slider / Casella Numerica
  readonly deployAmount = signal<number>(1);
  readonly fortifyAmount = signal<number>(1);
  readonly occupyAmount = signal<number>(0);

  // Controllo visibilità del Popup Centrale dei Dadi
  readonly dismissedCombatTimestamp = signal<number | null>(null);

  readonly graph = computed(() => buildMapGraph(this.gameState().mapVariant));

  readonly isCombatModalVisible = computed(() => {
    const cmb = this.gameState().lastCombat;
    if (!cmb) return false;
    return this.dismissedCombatTimestamp() !== cmb.timestamp;
  });

  readonly nextTradeBonus = computed(() => getCardTradeBonus(this.gameState().cardTradesCount));

  readonly availableCardSet = computed(() => {
    const p = this.activePlayer();
    const set = findValidCardSetInHand(p.cards);
    if (!set) return null;
    return [set[0].id, set[1].id, set[2].id] as [string, string, string];
  });

  readonly sourceNode = computed(() => {
    const id = this.sourceId();
    return id ? (this.graph().territories[id] ?? null) : null;
  });

  readonly targetNode = computed(() => {
    const id = this.targetId();
    return id ? (this.graph().territories[id] ?? null) : null;
  });

  /** Quota rinforzi (1 + confinanti amici) per il territorio selezionato in DEPLOY */
  readonly selectedDeployQuota = computed(() => {
    const id = this.sourceId();
    if (!id || this.gameState().phase !== 'DEPLOY') return null;
    return this.getQuotaForTerritory(id);
  });

  /** Numero massimo di armate trasferibili dal territorio di origine in FORTIFY */
  readonly maxFortifyTransferable = computed(() => {
    const src = this.sourceId();
    if (!src) return 0;
    return Math.max(0, this.getArmies(src) - 1);
  });

  constructor() {
    // Sincronizza automaticamente l'origine della fortificazione se è già stata vincolata nel turno
    effect(
      () => {
        const s = this.gameState();
        if (s.phase === 'FORTIFY' && s.fortifySourceId) {
          this.sourceId.set(s.fortifySourceId);
        }
        if (s.phase === 'OCCUPY' && s.pendingOccupation) {
          this.occupyAmount.set(s.pendingOccupation.maxArmies);
        }
      },
      { allowSignalWrites: true },
    );
  }

  readonly edges = computed<EdgeLine[]>(() => {
    const g = this.graph();
    const src = this.sourceId();
    const seen = new Set<string>();
    const result: EdgeLine[] = [];

    for (const from of g.territoryList) {
      for (const toId of from.neighbors) {
        const pairKey = [from.id, toId].sort().join('--');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const to = g.territories[toId];
        if (!to) continue;

        const isHighlighted = src === from.id || src === to.id;
        const dx = Math.abs(from.centroid.x - to.centroid.x);

        if (dx > 650) {
          const leftNode = from.centroid.x < to.centroid.x ? from : to;
          const rightNode = from.centroid.x < to.centroid.x ? to : from;
          result.push({
            key: `${pairKey}-left`,
            x1: leftNode.centroid.x,
            y1: leftNode.centroid.y,
            x2: 0,
            y2: leftNode.centroid.y,
            isWrapAround: true,
            isHighlighted,
          });
          result.push({
            key: `${pairKey}-right`,
            x1: rightNode.centroid.x,
            y1: rightNode.centroid.y,
            x2: 1200,
            y2: rightNode.centroid.y,
            isWrapAround: true,
            isHighlighted,
          });
        } else {
          result.push({
            key: pairKey,
            x1: from.centroid.x,
            y1: from.centroid.y,
            x2: to.centroid.x,
            y2: to.centroid.y,
            isWrapAround: false,
            isHighlighted,
          });
        }
      }
    }
    return result;
  });

  onTerritoryClick(clickedId: TerritoryId): void {
    if (!this.gateway.canActNow()) return;

    const state = this.gameState();
    const player = this.activePlayer();
    const clickedState = state.territories[clickedId];

    // 1. DEPLOY: Seleziona il territorio e imposta lo slider al massimo consentito (o 1)
    if (state.phase === 'DEPLOY') {
      if (clickedState.ownerId === player.id) {
        this.sourceId.set(clickedId);
        this.targetId.set(null);
        const quota = this.getQuotaForTerritory(clickedId);
        this.deployAmount.set(Math.max(1, quota.remainingAllowed));
      }
      return;
    }

    // 2. ATTACK
    if (state.phase === 'ATTACK') {
      if (clickedState.ownerId === player.id) {
        if (clickedState.armies >= 2) {
          this.sourceId.set(clickedId);
          this.targetId.set(null);
        }
      } else if (
        this.sourceId() &&
        areTerritoriesAdjacent(this.graph(), this.sourceId()!, clickedId)
      ) {
        this.targetId.set(clickedId);
      }
      return;
    }

    // 3. FORTIFY (Multi-destinazione da singola origine)
    if (state.phase === 'FORTIFY') {
      if (clickedState.ownerId !== player.id) return;

      const lockedSource = state.fortifySourceId;

      if (lockedSource) {
        // L'origine è già bloccata: qualsiasi click su un vicino amico lo imposta come destinazione
        this.sourceId.set(lockedSource);
        if (
          clickedId !== lockedSource &&
          areTerritoriesAdjacent(this.graph(), lockedSource, clickedId)
        ) {
          this.targetId.set(clickedId);
          this.fortifyAmount.set(
            Math.max(1, Math.min(this.fortifyAmount(), this.maxFortifyTransferable())),
          );
        }
        return;
      }

      // Se l'origine non è ancora bloccata:
      if (!this.sourceId() || clickedId === this.sourceId()) {
        if (clickedState.armies >= 2) {
          this.sourceId.set(clickedId);
          this.targetId.set(null);
          this.fortifyAmount.set(1);
        }
      } else if (areTerritoriesAdjacent(this.graph(), this.sourceId()!, clickedId)) {
        this.targetId.set(clickedId);
        this.fortifyAmount.set(1);
      } else if (clickedState.armies >= 2) {
        this.sourceId.set(clickedId);
        this.targetId.set(null);
        this.fortifyAmount.set(1);
      }
    }
  }

  // ================= METODI DEPLOY =================

  getQuotaForTerritory(territoryId: TerritoryId) {
    const s = this.gameState();
    const p = this.activePlayer();
    return getTerritoryDeployQuota(
      this.graph(),
      s.territories,
      s.deployedThisTurn ?? {},
      territoryId,
      p.id,
      p.reinforcementsAvailable,
    );
  }

  setDeployAmount(val: number): void {
    const q = this.selectedDeployQuota();
    const max = q ? q.remainingAllowed : 1;
    const clamped = Math.max(1, Math.min(Math.floor(Number(val) || 1), max));
    this.deployAmount.set(clamped);
  }

  confirmDeploy(): void {
    const id = this.sourceId();
    if (!id) return;

    const res = this.gateway.dispatch({
      type: 'DEPLOY_ARMIES',
      playerId: this.activePlayer().id,
      territoryId: id,
      armies: this.deployAmount(),
    });

    if (res.success && res.state.phase === 'DEPLOY') {
      const updatedQuota = this.getQuotaForTerritory(id);
      this.deployAmount.set(Math.max(1, updatedQuota.remainingAllowed));
    } else if (res.state.phase !== 'DEPLOY') {
      this.clearSelection();
    }
  }

  // ================= METODI ATTACK & POPUP DADI =================

  executeAttack(mode: 'SINGLE' | 'BLITZ', dice?: 1 | 2 | 3): void {
    const fromId = this.sourceId();
    const toId = this.targetId();
    if (!fromId || !toId) return;

    this.dismissedCombatTimestamp.set(null);
    const res = this.gateway.dispatch({
      type: 'ATTACK',
      playerId: this.activePlayer().id,
      fromId,
      toId,
      mode,
      attackerDice: dice,
    });

    if (res.state.lastCombat?.conquered || res.state.territories[fromId].armies < 2) {
      this.clearSelection();
    }
  }

  continueAttackFromModal(fromId: TerritoryId, toId: TerritoryId, mode: 'SINGLE' | 'BLITZ'): void {
    this.sourceId.set(fromId);
    this.targetId.set(toId);
    this.executeAttack(mode, 3);
  }

  closeCombatModal(): void {
    const cmb = this.gameState().lastCombat;
    if (cmb) {
      this.dismissedCombatTimestamp.set(cmb.timestamp);
    }
  }

  // ================= METODI OCCUPY & FORTIFY =================

  setOccupyAmount(val: number): void {
    const occ = this.gameState().pendingOccupation;
    const max = occ ? occ.maxArmies : 0;
    const clamped = Math.max(0, Math.min(Math.floor(Number(val) || 0), max));
    this.occupyAmount.set(clamped);
  }

  confirmOccupation(armiesToMove: number): void {
    this.gateway.dispatch({
      type: 'OCCUPY_TERRITORY',
      playerId: this.activePlayer().id,
      armiesToMove,
    });
    this.closeCombatModal();
    this.clearSelection();
  }

  setFortifyAmount(val: number): void {
    const max = this.maxFortifyTransferable();
    const clamped = Math.max(1, Math.min(Math.floor(Number(val) || 1), max));
    this.fortifyAmount.set(clamped);
  }

  executeFortify(armies: number): void {
    const fromId = this.sourceId();
    const toId = this.targetId();
    if (!fromId || !toId) return;

    const res = this.gateway.dispatch({
      type: 'FORTIFY',
      playerId: this.activePlayer().id,
      fromId,
      toId,
      armies,
    });

    if (res.success) {
      // Mantiene selezionata l'origine così puoi cliccare subito un altro stato confinante!
      this.sourceId.set(fromId);
      this.targetId.set(null);
      const remaining = Math.max(1, res.state.territories[fromId].armies - 1);
      this.fortifyAmount.set(Math.min(1, remaining));
    }
  }

  tradeCards(cardIds: [string, string, string]): void {
    this.gateway.dispatch({
      type: 'TRADE_CARDS',
      playerId: this.activePlayer().id,
      cardIds,
    });
  }

  endAttackPhase(): void {
    this.clearSelection();
    this.closeCombatModal();
    this.gateway.dispatch({
      type: 'END_ATTACK_PHASE',
      playerId: this.activePlayer().id,
    });
  }

  endTurn(): void {
    this.clearSelection();
    this.closeCombatModal();
    this.gateway.dispatch({
      type: 'END_TURN',
      playerId: this.activePlayer().id,
    });
  }

  restartGame(variant: MapVariant): void {
    this.clearSelection();
    this.closeCombatModal();
    this.gateway.startNewGame(variant);
  }

  clearSelection(): void {
    if (this.gameState().phase === 'FORTIFY' && this.gameState().fortifySourceId) {
      this.sourceId.set(this.gameState().fortifySourceId);
      this.targetId.set(null);
      return;
    }
    this.sourceId.set(null);
    this.targetId.set(null);
  }

  isValidTargetForSource(id: TerritoryId): boolean {
    const src = this.sourceId();
    if (!src || !areTerritoriesAdjacent(this.graph(), src, id)) return false;

    const phase = this.gameState().phase;
    const owner = this.gameState().territories[id].ownerId;
    const activeId = this.activePlayer().id;

    if (phase === 'ATTACK') return owner !== activeId;
    if (phase === 'FORTIFY') return owner === activeId;
    return false;
  }

  isWrapAroundPair(a: TerritoryNode, b: TerritoryNode): boolean {
    return Math.abs(a.centroid.x - b.centroid.x) > 650;
  }

  getArmies(id: TerritoryId): number {
    return this.gameState().territories[id]?.armies ?? 0;
  }

  getTerritoryOwnerId(id: TerritoryId): string {
    return this.gameState().territories[id]?.ownerId ?? '';
  }

  getOwnerColor(id: TerritoryId): string {
    const ownerId = this.gameState().territories[id]?.ownerId;
    return this.getPlayerColorById(ownerId);
  }

  getPlayerColorById(playerId?: string): string {
    return this.gameState().players.find((p) => p.id === playerId)?.color ?? '#475569';
  }

  getOwnedCount(playerId: string): number {
    return Object.values(this.gameState().territories).filter((t) => t.ownerId === playerId).length;
  }

  getSymbolIcon(symbol: string): string {
    const icons: Record<string, string> = {
      INFANTRY: '💂',
      CAVALRY: '🐎',
      ARTILLERY: '💣',
      WILD: '⭐',
    };
    return icons[symbol] ?? '🃏';
  }

  getPhaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      DEPLOY: '1. RINFORZI',
      ATTACK: '2. ATTACCO',
      OCCUPY: 'CONQUISTA',
      FORTIFY: '3. FORTIFICAZIONE',
      GAME_OVER: 'PARTITA CONCLUSA',
    };
    return labels[phase] ?? phase;
  }
}
