// src/engine/risk-engine.ts
import { areTerritoriesAdjacent, buildMapGraph } from './map/map-graph.helper';
import { MapGraph, MapVariant, TerritoryId } from './map/map.models';
import {
  ActionResult,
  CombatReport,
  FullGameState,
  GameCommand,
  PlayerConfig,
  PlayerState,
  PlayerViewState,
  TerritoryCard,
  TerritoryState,
} from './models/game.models';
import { createShuffledDeck, getCardTradeBonus, isValidCardSet } from './rules/cards.helper';
import { calculateRisk2Reinforcements } from './rules/reinforcements.helper';
import { SeededRng } from './utils/prng';

export class RiskEngine {
  private state: FullGameState;
  private graph: MapGraph;

  constructor(initialState: FullGameState) {
    this.state = structuredClone(initialState);
    this.graph = buildMapGraph(this.state.mapVariant);
  }

  static createNewGame(options: {
    mapVariant: MapVariant;
    players: PlayerConfig[];
    seed?: number;
  }): RiskEngine {
    const seed = options.seed ?? Date.now();
    const rng = new SeededRng(seed);
    const graph = buildMapGraph(options.mapVariant);

    const startingArmiesPerPlayer: Record<number, number> = {
      2: 40,
      3: 35,
      4: 30,
      5: 25,
      6: 20,
    };
    const initialPool = startingArmiesPerPlayer[options.players.length] ?? 30;

    const players: PlayerState[] = options.players.map((p) => ({
      ...p,
      isEliminated: false,
      reinforcementsAvailable: 0,
      conqueredTerritoryThisTurn: false,
      cards: [],
    }));

    const shuffledNodes = rng.shuffle(graph.territoryList);
    const territories = {} as Record<TerritoryId, TerritoryState>;
    const remainingArmies = new Map<string, number>(players.map((p) => [p.id, initialPool]));

    shuffledNodes.forEach((node, idx) => {
      const owner = players[idx % players.length];
      territories[node.id] = {
        id: node.id,
        ownerId: owner.id,
        armies: 1,
      };
      remainingArmies.set(owner.id, (remainingArmies.get(owner.id) ?? 1) - 1);
    });

    for (const player of players) {
      const ownedIds = Object.values(territories)
        .filter((t) => t.ownerId === player.id)
        .map((t) => t.id);

      let left = remainingArmies.get(player.id) ?? 0;
      while (left > 0 && ownedIds.length > 0) {
        const randomTerritoryId = ownedIds[rng.nextInt(0, ownedIds.length - 1)];
        territories[randomTerritoryId].armies += 1;
        left--;
      }
    }

    const deck = createShuffledDeck(graph, rng);

    const firstPlayer = players[0];
    const breakdown = calculateRisk2Reinforcements(graph, territories, firstPlayer.id);
    firstPlayer.reinforcementsAvailable = breakdown.totalArmies;

    const initialState: FullGameState = {
      gameId: `risik2-${seed}`,
      mapVariant: options.mapVariant,
      rngState: rng.state,
      turnNumber: 1,
      activePlayerIndex: 0,
      phase: 'DEPLOY',
      players,
      territories,
      deck,
      discardPile: [],
      cardTradesCount: 0,
      pendingOccupation: null,
      lastCombat: null,
      lastReinforcementBreakdown: breakdown,
      winnerId: null,
    };

    return new RiskEngine(initialState);
  }

  public getFullState(): FullGameState {
    return structuredClone(this.state);
  }

  public getMapGraph(): MapGraph {
    return this.graph;
  }

  public getPlayerView(viewerId?: string): PlayerViewState {
    const { rngState: _, deck, discardPile: __, ...view } = structuredClone(this.state);

    // Se è specificato un viewerId (modalità Online P2P), maschera le carte degli avversari
    if (viewerId) {
      view.players = view.players.map((p) => {
        if (p.id === viewerId) return p;
        return {
          ...p,
          cards: p.cards.map((_, idx) => ({
            id: `hidden_${p.id}_${idx}`,
            territoryId: null,
            symbol: 'INFANTRY',
          })),
        };
      });
    }

    return {
      ...view,
      deckCount: deck.length,
    };
  }

  public dispatch(command: GameCommand): ActionResult {
    if (this.state.phase === 'GAME_OVER') {
      return this.fail('La partita è già terminata.');
    }

    const activePlayer = this.state.players[this.state.activePlayerIndex];
    if (command.playerId !== activePlayer.id) {
      return this.fail(`Non è il turno di ${command.playerId}.`);
    }

    switch (command.type) {
      case 'TRADE_CARDS':
        return this.handleTradeCards(command.cardIds);
      case 'DEPLOY_ARMIES':
        return this.handleDeploy(command.territoryId, command.armies);
      case 'ATTACK':
        return this.handleAttack(command.fromId, command.toId, command.mode, command.attackerDice);
      case 'OCCUPY_TERRITORY':
        return this.handleOccupy(command.armiesToMove);
      case 'END_ATTACK_PHASE':
        return this.handleEndAttackPhase();
      case 'FORTIFY':
        return this.handleFortify(command.fromId, command.toId, command.armies);
      case 'END_TURN':
        return this.handleEndTurn();
    }
  }

  // ================= HANDLER DELLE FASI =================

  private handleTradeCards(cardIds: [string, string, string]): ActionResult {
    if (this.state.phase !== 'DEPLOY') {
      return this.fail('Puoi giocare un Tris di carte solo nella fase di Rinforzo.');
    }

    const player = this.state.players[this.state.activePlayerIndex];
    const selectedCards = cardIds
      .map((id) => player.cards.find((c) => c.id === id))
      .filter((c): c is TerritoryCard => Boolean(c));

    if (selectedCards.length !== 3) {
      return this.fail('Devi selezionare 3 carte valide dalla tua mano.');
    }

    const tuple: [TerritoryCard, TerritoryCard, TerritoryCard] = [
      selectedCards[0],
      selectedCards[1],
      selectedCards[2],
    ];

    if (!isValidCardSet(tuple)) {
      return this.fail('Combinazione non valida: servono 3 simboli uguali, 3 diversi o un Jolly.');
    }

    const bonusArmies = getCardTradeBonus(this.state.cardTradesCount);
    this.state.cardTradesCount += 1;
    player.reinforcementsAvailable += bonusArmies;

    // Bonus territorio: +2 armate direttamente sui territori posseduti raffigurati sulle carte
    for (const card of tuple) {
      if (card.territoryId && this.state.territories[card.territoryId]?.ownerId === player.id) {
        this.state.territories[card.territoryId].armies += 2;
      }
    }

    // Rimuovi le carte dalla mano e mettile negli scarti
    const idSet = new Set(cardIds);
    player.cards = player.cards.filter((c) => !idSet.has(c.id));
    this.state.discardPile.push(...tuple);

    return this.ok();
  }

  private handleDeploy(territoryId: TerritoryId, armies: number): ActionResult {
    if (this.state.phase !== 'DEPLOY') {
      return this.fail('Puoi piazzare rinforzi solo nella fase di Rinforzo.');
    }
    const player = this.state.players[this.state.activePlayerIndex];

    if (player.cards.length >= 5) {
      return this.fail('Hai 5 o più carte in mano: devi prima scambiare un Tris!');
    }

    const territory = this.state.territories[territoryId];
    if (!territory || territory.ownerId !== player.id) {
      return this.fail('Puoi piazzare rinforzi solo sui tuoi territori.');
    }

    const count = Math.min(armies, player.reinforcementsAvailable);
    if (count <= 0) {
      return this.fail('Nessun rinforzo disponibile.');
    }

    territory.armies += count;
    player.reinforcementsAvailable -= count;

    if (player.reinforcementsAvailable === 0) {
      this.state.phase = 'ATTACK';
    }

    return this.ok();
  }

  private handleAttack(
    fromId: TerritoryId,
    toId: TerritoryId,
    mode: 'SINGLE' | 'BLITZ',
    requestedDice?: 1 | 2 | 3,
  ): ActionResult {
    if (this.state.phase !== 'ATTACK') {
      return this.fail('Non sei nella fase di Attacco.');
    }

    const player = this.state.players[this.state.activePlayerIndex];
    const from = this.state.territories[fromId];
    const to = this.state.territories[toId];

    if (!from || !to) return this.fail('Territorio non valido.');
    if (from.ownerId !== player.id) return this.fail('Il territorio attaccante non è tuo.');
    if (to.ownerId === player.id) return this.fail('Non puoi attaccare un tuo territorio.');
    if (!areTerritoriesAdjacent(this.graph, fromId, toId)) {
      return this.fail('I due territori non sono confinanti.');
    }
    if (from.armies < 2) {
      return this.fail('Servono almeno 2 armate per attaccare.');
    }

    const rng = new SeededRng(this.state.rngState);
    let totalAttackerLosses = 0;
    let totalDefenderLosses = 0;
    let lastAttackerRolls: number[] = [];
    let lastDefenderRolls: number[] = [];
    let roundsFought = 0;
    let lastUsedAttackerDice = 1;

    const executeSingleRound = () => {
      const maxAttackerDice = Math.min(3, from.armies - 1) as 1 | 2 | 3;
      const aDice =
        mode === 'BLITZ'
          ? maxAttackerDice
          : (Math.min(requestedDice ?? maxAttackerDice, maxAttackerDice) as 1 | 2 | 3);

      // Regola Risiko!: la difesa tira fino a 3 dadi se ha 3 o più armate nel territorio
      const dDice = Math.min(3, to.armies) as 1 | 2 | 3;

      lastUsedAttackerDice = aDice;

      lastAttackerRolls = Array.from({ length: aDice }, () => rng.rollDie(6)).sort((a, b) => b - a);
      lastDefenderRolls = Array.from({ length: dDice }, () => rng.rollDie(6)).sort((a, b) => b - a);

      const comparisons = Math.min(lastAttackerRolls.length, lastDefenderRolls.length);
      for (let i = 0; i < comparisons; i++) {
        if (lastAttackerRolls[i] > lastDefenderRolls[i]) {
          to.armies -= 1;
          totalDefenderLosses += 1;
        } else {
          from.armies -= 1;
          totalAttackerLosses += 1;
        }
      }
      roundsFought++;
    };

    if (mode === 'SINGLE') {
      executeSingleRound();
    } else {
      while (from.armies > 1 && to.armies > 0) {
        executeSingleRound();
      }
    }

    this.state.rngState = rng.state;
    const conquered = to.armies === 0;

    if (conquered) {
      const previousOwnerId = to.ownerId;
      to.ownerId = player.id;
      player.conqueredTerritoryThisTurn = true;

      const minMove = Math.min(lastUsedAttackerDice, from.armies - 1);
      const maxMove = from.armies - 1;

      if (minMove === maxMove) {
        from.armies -= minMove;
        to.armies = minMove;
      } else {
        from.armies -= minMove;
        to.armies = minMove;
        this.state.phase = 'OCCUPY';
        this.state.pendingOccupation = {
          fromId,
          toId,
          minArmies: 0,
          maxArmies: from.armies - 1,
        };
      }

      this.checkPlayerElimination(previousOwnerId, player);
    }

    const report: CombatReport = {
      fromId,
      toId,
      attackerRolls: lastAttackerRolls,
      defenderRolls: lastDefenderRolls,
      attackerLosses: totalAttackerLosses,
      defenderLosses: totalDefenderLosses,
      conquered,
      roundsFought,
    };
    this.state.lastCombat = report;

    return this.ok();
  }

  private handleOccupy(additionalArmies: number): ActionResult {
    if (this.state.phase !== 'OCCUPY' || !this.state.pendingOccupation) {
      return this.fail('Nessuna occupazione in sospeso.');
    }

    const { fromId, toId, maxArmies } = this.state.pendingOccupation;
    const moveCount = Math.max(0, Math.min(additionalArmies, maxArmies));

    this.state.territories[fromId].armies -= moveCount;
    this.state.territories[toId].armies += moveCount;

    this.state.pendingOccupation = null;
    if ((this.state.phase as string) !== 'GAME_OVER') {
      this.state.phase = 'ATTACK';
    }

    return this.ok();
  }

  private handleEndAttackPhase(): ActionResult {
    if (this.state.phase !== 'ATTACK') {
      return this.fail('Puoi passare alla fortificazione solo dalla fase di Attacco.');
    }
    this.state.phase = 'FORTIFY';
    return this.ok();
  }

  private handleFortify(fromId: TerritoryId, toId: TerritoryId, armies: number): ActionResult {
    if (this.state.phase !== 'FORTIFY') {
      return this.fail('Non sei nella fase di Spostamento Strategico.');
    }

    const player = this.state.players[this.state.activePlayerIndex];
    const from = this.state.territories[fromId];
    const to = this.state.territories[toId];

    if (!from || !to || from.ownerId !== player.id || to.ownerId !== player.id) {
      return this.fail('Entrambi i territori devono appartenerti.');
    }
    if (!areTerritoriesAdjacent(this.graph, fromId, toId)) {
      return this.fail('I territori devono essere confinanti per lo spostamento.');
    }
    if (from.armies < 2) {
      return this.fail('Deve rimanere almeno 1 armata nel territorio di partenza.');
    }

    const count = Math.max(1, Math.min(armies, from.armies - 1));
    from.armies -= count;
    to.armies += count;

    return this.handleEndTurn();
  }

  private handleEndTurn(): ActionResult {
    if (this.state.phase === 'DEPLOY' || this.state.phase === 'OCCUPY') {
      return this.fail('Completa prima la fase corrente.');
    }

    const currentPlayer = this.state.players[this.state.activePlayerIndex];

    // Se il giocatore ha conquistato almeno 1 territorio in questo turno, pesca 1 carta
    if (currentPlayer.conqueredTerritoryThisTurn) {
      this.drawCardForPlayer(currentPlayer);
    }

    const totalPlayers = this.state.players.length;
    let nextIdx = this.state.activePlayerIndex;

    do {
      nextIdx = (nextIdx + 1) % totalPlayers;
      if (nextIdx === 0) {
        this.state.turnNumber += 1;
      }
    } while (this.state.players[nextIdx].isEliminated);

    this.state.activePlayerIndex = nextIdx;
    const nextPlayer = this.state.players[nextIdx];
    nextPlayer.conqueredTerritoryThisTurn = false;

    const breakdown = calculateRisk2Reinforcements(
      this.graph,
      this.state.territories,
      nextPlayer.id,
    );
    nextPlayer.reinforcementsAvailable = breakdown.totalArmies;
    this.state.lastReinforcementBreakdown = breakdown;
    this.state.lastCombat = null;
    this.state.phase = 'DEPLOY';

    return this.ok();
  }

  private drawCardForPlayer(player: PlayerState): void {
    if (this.state.deck.length === 0 && this.state.discardPile.length > 0) {
      const rng = new SeededRng(this.state.rngState);
      this.state.deck = rng.shuffle(this.state.discardPile);
      this.state.discardPile = [];
      this.state.rngState = rng.state;
    }

    const card = this.state.deck.pop();
    if (card) {
      player.cards.push(card);
    }
  }

  private checkPlayerElimination(defeatedPlayerId: string, conqueror: PlayerState): void {
    const stillOwnsAny = this.graph.territoryList.some(
      (t) => this.state.territories[t.id].ownerId === defeatedPlayerId,
    );

    if (!stillOwnsAny) {
      const eliminated = this.state.players.find((p) => p.id === defeatedPlayerId);
      if (eliminated && !eliminated.isEliminated) {
        eliminated.isEliminated = true;
        // Chi elimina un avversario cattura tutte le sue carte territorio!
        conqueror.cards.push(...eliminated.cards);
        eliminated.cards = [];
      }
    }

    const alivePlayers = this.state.players.filter((p) => !p.isEliminated);
    if (alivePlayers.length === 1) {
      this.state.winnerId = alivePlayers[0].id;
      this.state.phase = 'GAME_OVER';
      this.state.pendingOccupation = null;
    }
  }

  private ok(): ActionResult {
    return { success: true, state: this.getPlayerView() };
  }

  private fail(error: string): ActionResult {
    return { success: false, error, state: this.getPlayerView() };
  }
}
