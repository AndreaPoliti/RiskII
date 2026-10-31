// src/app/components/map-board/map-board.ts
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { areTerritoriesAdjacent, buildMapGraph } from '@engine/map/map-graph.helper';
import { MapVariant, TerritoryId, TerritoryNode } from '@engine/map/map.models';
import { LocalSessionGateway } from '@services/gateway/local-session.gateway';
import { findValidCardSetInHand, getCardTradeBonus } from '@engine/rules/cards.helper';

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
  imports: [CommonModule],
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
  readonly deployStep = signal<number>(1);

  readonly graph = computed(() => buildMapGraph(this.gameState().mapVariant));

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

    if (state.phase === 'DEPLOY') {
      if (clickedState.ownerId === player.id) {
        this.gateway.dispatch({
          type: 'DEPLOY_ARMIES',
          playerId: player.id,
          territoryId: clickedId,
          armies: this.deployStep(),
        });
      }
      return;
    }

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

    if (state.phase === 'FORTIFY') {
      if (clickedState.ownerId !== player.id) return;

      if (!this.sourceId() || clickedId === this.sourceId()) {
        if (clickedState.armies >= 2) {
          this.sourceId.set(clickedId);
          this.targetId.set(null);
        }
      } else if (areTerritoriesAdjacent(this.graph(), this.sourceId()!, clickedId)) {
        this.targetId.set(clickedId);
      } else if (clickedState.armies >= 2) {
        this.sourceId.set(clickedId);
        this.targetId.set(null);
      }
    }
  }

  tradeCards(cardIds: [string, string, string]): void {
    this.gateway.dispatch({
      type: 'TRADE_CARDS',
      playerId: this.activePlayer().id,
      cardIds,
    });
  }

  executeAttack(mode: 'SINGLE' | 'BLITZ', dice?: 1 | 2 | 3): void {
    const fromId = this.sourceId();
    const toId = this.targetId();
    if (!fromId || !toId) return;

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

  confirmOccupation(armiesToMove: number): void {
    this.gateway.dispatch({
      type: 'OCCUPY_TERRITORY',
      playerId: this.activePlayer().id,
      armiesToMove,
    });
    this.clearSelection();
  }

  endAttackPhase(): void {
    this.clearSelection();
    this.gateway.dispatch({
      type: 'END_ATTACK_PHASE',
      playerId: this.activePlayer().id,
    });
  }

  executeFortify(armies: number): void {
    const fromId = this.sourceId();
    const toId = this.targetId();
    if (!fromId || !toId) return;

    this.gateway.dispatch({
      type: 'FORTIFY',
      playerId: this.activePlayer().id,
      fromId,
      toId,
      armies,
    });
    this.clearSelection();
  }

  endTurn(): void {
    this.clearSelection();
    this.gateway.dispatch({
      type: 'END_TURN',
      playerId: this.activePlayer().id,
    });
  }

  restartGame(variant: MapVariant): void {
    this.clearSelection();
    this.gateway.startNewGame(variant);
  }

  clearSelection(): void {
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

  getOwnerColor(id: TerritoryId): string {
    const ownerId = this.gameState().territories[id]?.ownerId;
    return this.gameState().players.find((p) => p.id === ownerId)?.color ?? '#475569';
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
