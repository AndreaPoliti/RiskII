# RisikII - Linee Guida Architetturali per AI Agent

Leggi sempre `docs/SPEC.md` come fonte di verità per le regole di dominio di Risk II.

## Regole Inviolabili di Codice

1. **Isolamento del Motore (`src/engine/`)**:
   - Deve contenere SOLO TypeScript puro. Vietato importare `@angular/*`, `window`, `document` o `localStorage`.
   - Vietato usare `Math.random()`. Usa esclusivamente il PRNG deterministico con seed in `@engine/utils/prng.ts`.
2. **Command Pattern e Immutabilità**:
   - La UI non muta mai lo stato direttamente. Ogni azione passa tramite `GameSessionGateway.dispatch(command: GameCommand)`.
   - Il motore riceve `(state, command)` e produce un nuovo stato + lista di `GameEvent`.
3. **Sicurezza della Vista (`PlayerViewState`)**:
   - I componenti UI consumano solo `PlayerViewState` (generato da `getPlayerView(fullState, viewerId)`), mai `FullGameState`, per non esporre le carte avversarie o gli ordini segreti del Same-Time Mode.
4. **Stile Angular**:
   - Usa esclusivamente Componenti Standalone, Signals (`signal`, `computed`, `effect`) e il nuovo control flow (`@if`, `@for`, `@switch`).
