# Specifica Funzionale e Architetturale: Progetto "RisikII" (Remake Moderno di Risk II - 2000)

## 1. Visione del Prodotto e Obiettivi di Sistema

### 1.1 Scopo del Progetto

Ricreare fedelmente l'esperienza, le meccaniche e la profondità strategica del videogioco **Risk II** (sviluppato da Deep Red Games e pubblicato da MicroProse/Hasbro Interactive nel 2000), rendendolo nativamente eseguibile su **Windows 10/11+** e browser moderni senza dipendenze legacy (DirectPlay, SafeDisc, codec AVI a 16-bit).

### 1.2 Requisiti Non Funzionali Chiave (NFR)

1. **100% Offline-First (PWA + Desktop Wrapper):** Il gioco deve essere installabile come Progressive Web App (PWA) da qualsiasi browser Chromium (Edge/Chrome) e funzionare interamente senza connessione internet dopo il primo avvio. Deve inoltre poter essere compilato in un eseguibile standalone `.exe` / `.msi` per Windows 10/11 tramite **Tauri** (WebView2).
2. **Architettura Dual-Mode (Isomorphic Engine):** Il motore delle regole deve essere scritto in TypeScript puro, completamente disaccoppiato dalla UI e dal layer di rete, così da girare identicamente in locale (Single-Player / HotSeat) e in modalità Multiplayer.
3. **Multiplayer P2P Host-Client per Gruppi di Amici:** Nessun costo di server backend dedicato. Uno dei giocatori funge da **Host autoritativo** (eseguendo il `GameEngine` e i salvataggi su IndexedDB nel proprio browser) mentre gli altri amici si collegano come **Guest** tramite WebRTC DataChannels (topologia a stella).
4. **Determinismo e Ripristino Sessione:** Tutte le estrazioni casuali (dadi, mazzo carte, assegnazione territori) devono passare da un generatore pseudocasuale con seed (`Seeded PRNG`). Le partite (anche multiplayer) devono essere salvate automaticamente ad ogni fase su IndexedDB per consentire la ripresa in serate successive o il recupero immediato in caso di disconnessione/ricaricamento pagina ($F5$).

---

## 2. Istruzioni per l'AI Agentica (Linee Guida di Sviluppo)

> **NOTA PER L'AGENTE AI:** Quando generi o modifichi codice per questo repository, rispetta tassativamente i seguenti vincoli architetturali:
>
> 1. **Zero Logica di Dominio nella UI:** I componenti grafici non devono mai mutare lo stato della partita né calcolare esiti di battaglie o validità delle mosse. La UI può solo leggere un `PlayerViewState` immutabile e inviare oggetti serializzabili `GameCommand` tramite l'interfaccia `GameSessionGateway`.
> 2. **Motore Puro e Deterministico (`/packages/engine`):** All'interno della cartella del motore è **vietato** usare `Math.random()`, `Date.now()`, `window`, `document` o API specifiche del browser. Usa esclusivamente il `PRNG` interno allo stato della partita.
> 3. **Information Hiding (Fog of War):** L'Host non deve mai trasmettere il `FullGameState` ai client remoti. Ogni aggiornamento di stato deve passare attraverso il selettore `projectPlayerView(fullState, targetPlayerId)` che oscura le carte in mano agli avversari, gli obiettivi segreti altrui e gli ordini di attacco simultanei non ancora rivelati.
> 4. **Validazione Rigorosa:** Ogni `GameCommand` ricevuto dal motore deve essere validato rispetto alla fase corrente della macchina a stati, al proprietario del turno e alla disponibilità effettiva di armate.

### 2.1 Struttura Monorepo / Moduli Consigliata

```text
risik2/
├── src/
│   ├── engine/                 # CORE PURO (Zero dipendenze DOM/UI/Network)
│   │   ├── models/             # Interfacce State, Command, Event, Config
│   │   ├── map/                # Grafo dei 48 territori, adiacenze, continenti
│   │   ├── rules/              # Validatori e risolutori (Classic & Same-Time)
│   │   ├── combat/             # Risoluzione d6 (Classic) e d12 colorati (Same-Time)
│   │   ├── ai/                 # Euristiche e profili dei 16 Generali storici
│   │   ├── prng.ts             # Algoritmo deterministico Mulberry32
│   │   └── risk-engine.ts      # Macchina a stati principale e proiezione viste
│   ├── gateway/                # ASTRATTO COMUNICAZIONE UI <-> ENGINE
│   │   ├── session.gateway.ts  # Interfaccia comune
│   │   ├── local.gateway.ts    # Connessione diretta + AI Web Worker (Offline/Host)
│   │   └── webrtc.gateway.ts   # Bridge PeerJS/WebRTC (Host & Guest Online)
│   ├── storage/                # PERSISTENZA LOCALE
│   │   └── db.ts               # Schema IndexedDB (Dexie.js): salvataggi, profili, torneo
│   └── ui/                     # FRONTEND (Angular / React + SVG Interattivo)
│       ├── map-board/          # Mappa SVG 48 territori, frecce attacco, filtri vista
│       ├── hud/                # Pannello fasi, carte, I-COM diplomazia, log
│       ├── battle-modal/       # Finestra BattleView con lancio dadi / Blitz
│       └── lobby/              # Configurazione partita, slot giocatori, codice stanza P2P
└── src-tauri/                  # Configurazione opzionale per build .exe nativa Windows
```

---

## 3. Dominio Geografico: Il Grafo dei 48 Territori

A differenza del Risiko da tavolo classico (42 territori), _Risk II_ introduce **6 territori insulari/strategici aggiuntivi** (attivabili o disattivabili nelle impostazioni pre-partita) che aprono nuove rotte intercontinentali, portando il totale a **48 territori** divisi in **6 continenti**.

### 3.1 Tabella dei Continenti e Bonus Rinforzo Default

| ID Continente | Nome                | Territori (Classico 42) | Territori (Risk II 48) | Bonus Armate Default |
| :------------ | :------------------ | :---------------------: | :--------------------: | :------------------: |
| `NA`          | Nord America        |            9            |           11           |         $+5$         |
| `SA`          | Sud America         |            4            |           5            |         $+2$         |
| `EU`          | Europa              |            7            |           8            |         $+5$         |
| `AF`          | Africa              |            6            |           6            |         $+3$         |
| `AS`          | Asia                |           12            |           12           |         $+7$         |
| `OC`          | Oceania (Australia) |            4            |           6            |         $+2$         |

_(Nota: nelle impostazioni di creazione partita l'Host può modificare la regola del bonus continente tra `DEFAULT`, `INCREASING`, o `CUSTOM`, oppure disattivare i bonus)._

### 3.2 I 6 Territori Aggiuntivi di Risk II e Relative Connessioni

Quando l'opzione `extraTerritories` è attiva, il grafo delle adiacenze viene espanso con i seguenti nodi:

1. **`QIKIQTAALUK` (Isola di Baffin - Nord America):**
   - Connesso a: `NORTHWEST_TERRITORY`, `ONTARIO`, `QUEBEC`, `GREENLAND`.
2. **`HAWAII` (Nord America):**
   - Connesso a: `WESTERN_US`, `CENTRAL_AMERICA`, `JAPAN` _(crea un secondo ponte Pacifico tra Nord America e Asia)_.
3. **`FALKLAND_ISLANDS` (Sud America):**
   - Connesso a: `ARGENTINA`, `SOUTH_AFRICA` _(crea una seconda rotta sud-atlantica tra Sud America e Africa)_.
4. **`SVALBARD` (Europa):**
   - Connesso a: `GREENLAND`, `ICELAND`, `SCANDINAVIA`, `UKRAINE` _(espande il fronte artico tra Nord America ed Europa orientale)_.
5. **`PHILIPPINES` (Oceania):**
   - Connesso a: `SIAM`, `CHINA`, `JAPAN`, `INDONESIA`, `NEW_GUINEA` _(rompe il collo di bottiglia unico Siam-Indonesia)_.
6. **`NEW_ZEALAND` (Oceania):**
   - Connesso a: `EASTERN_AUSTRALIA`, `ARGENTINA` _(collega direttamente l'Oceania al Sud America attraverso il Pacifico meridionale)_.

### 3.3 Lista Completa dei 42 Territori Base e Adiacenze Standard

- **Nord America (`NA`):**
  - `ALASKA`: `NORTHWEST_TERRITORY`, `ALBERTA`, `KAMCHATKA`
  - `NORTHWEST_TERRITORY`: `ALASKA`, `ALBERTA`, `ONTARIO`, `GREENLAND` $(+ \text{`QIKIQTAALUK`})$
  - `GREENLAND`: `NORTHWEST_TERRITORY`, `ONTARIO`, `QUEBEC`, `ICELAND` $(+ \text{`QIKIQTAALUK`}, \text{`SVALBARD`})$
  - `ALBERTA`: `ALASKA`, `NORTHWEST_TERRITORY`, `ONTARIO`, `WESTERN_US`
  - `ONTARIO`: `NORTHWEST_TERRITORY`, `ALBERTA`, `GREENLAND`, `QUEBEC`, `WESTERN_US`, `EASTERN_US` $(+ \text{`QIKIQTAALUK`})$
  - `QUEBEC`: `ONTARIO`, `GREENLAND`, `EASTERN_US` $(+ \text{`QIKIQTAALUK`})$
  - `WESTERN_US`: `ALBERTA`, `ONTARIO`, `EASTERN_US`, `CENTRAL_AMERICA` $(+ \text{`HAWAII`})$
  - `EASTERN_US`: `ONTARIO`, `QUEBEC`, `WESTERN_US`, `CENTRAL_AMERICA`
  - `CENTRAL_AMERICA`: `WESTERN_US`, `EASTERN_US`, `VENEZUELA` $(+ \text{`HAWAII`})$
- **Sud America (`SA`):**
  - `VENEZUELA`: `CENTRAL_AMERICA`, `PERU`, `BRAZIL`
  - `PERU`: `VENEZUELA`, `BRAZIL`, `ARGENTINA`
  - `BRAZIL`: `VENEZUELA`, `PERU`, `ARGENTINA`, `NORTH_AFRICA`
  - `ARGENTINA`: `PERU`, `BRAZIL` $(+ \text{`FALKLAND_ISLANDS`}, \text{`NEW_ZEALAND`})$
- **Europa (`EU`):**
  - `ICELAND`: `GREENLAND`, `GREAT_BRITAIN`, `SCANDINAVIA` $(+ \text{`SVALBARD`})$
  - `GREAT_BRITAIN`: `ICELAND`, `SCANDINAVIA`, `NORTHERN_EUROPE`, `WESTERN_EUROPE`
  - `SCANDINAVIA`: `ICELAND`, `GREAT_BRITAIN`, `NORTHERN_EUROPE`, `UKRAINE` $(+ \text{`SVALBARD`})$
  - `NORTHERN_EUROPE`: `GREAT_BRITAIN`, `SCANDINAVIA`, `UKRAINE`, `SOUTHERN_EUROPE`, `WESTERN_EUROPE`
  - `WESTERN_EUROPE`: `GREAT_BRITAIN`, `NORTHERN_EUROPE`, `SOUTHERN_EUROPE`, `NORTH_AFRICA`
  - `SOUTHERN_EUROPE`: `WESTERN_EUROPE`, `NORTHERN_EUROPE`, `UKRAINE`, `MIDDLE_EAST`, `EGYPT`, `NORTH_AFRICA`
  - `UKRAINE` (Europa Orientale): `SCANDINAVIA`, `NORTHERN_EUROPE`, `SOUTHERN_EUROPE`, `URAL`, `AFGHANISTAN`, `MIDDLE_EAST` $(+ \text{`SVALBARD`})$
- **Africa (`AF`):**
  - `NORTH_AFRICA`: `BRAZIL`, `WESTERN_EUROPE`, `SOUTHERN_EUROPE`, `EGYPT`, `EAST_AFRICA`, `CONGO`
  - `EGYPT`: `NORTH_AFRICA`, `SOUTHERN_EUROPE`, `MIDDLE_EAST`, `EAST_AFRICA`
  - `EAST_AFRICA`: `EGYPT`, `NORTH_AFRICA`, `CONGO`, `SOUTH_AFRICA`, `MADAGASCAR`, `MIDDLE_EAST`
  - `CONGO`: `NORTH_AFRICA`, `EAST_AFRICA`, `SOUTH_AFRICA`
  - `SOUTH_AFRICA`: `CONGO`, `EAST_AFRICA`, `MADAGASCAR` $(+ \text{`FALKLAND_ISLANDS`})$
  - `MADAGASCAR`: `EAST_AFRICA`, `SOUTH_AFRICA`
- **Asia (`AS`):**
  - `URAL`: `UKRAINE`, `SIBERIA`, `CHINA`, `AFGHANISTAN`
  - `SIBERIA`: `URAL`, `YAKUTSK`, `IRKUTSK`, `MONGOLIA`, `CHINA`
  - `YAKUTSK`: `SIBERIA`, `KAMCHATKA`, `IRKUTSK`
  - `KAMCHATKA`: `YAKUTSK`, `IRKUTSK`, `MONGOLIA`, `JAPAN`, `ALASKA`
  - `IRKUTSK`: `SIBERIA`, `YAKUTSK`, `KAMCHATKA`, `MONGOLIA`
  - `MONGOLIA`: `SIBERIA`, `IRKUTSK`, `KAMCHATKA`, `JAPAN`, `CHINA`
  - `JAPAN`: `KAMCHATKA`, `MONGOLIA` $(+ \text{`HAWAII`}, \text{`PHILIPPINES`})$
  - `AFGHANISTAN`: `UKRAINE`, `URAL`, `CHINA`, `INDIA`, `MIDDLE_EAST`
  - `CHINA`: `AFGHANISTAN`, `URAL`, `SIBERIA`, `MONGOLIA`, `SIAM`, `INDIA` $(+ \text{`PHILIPPINES`})$
  - `MIDDLE_EAST`: `UKRAINE`, `SOUTHERN_EUROPE`, `EGYPT`, `EAST_AFRICA`, `INDIA`, `AFGHANISTAN`
  - `INDIA`: `MIDDLE_EAST`, `AFGHANISTAN`, `CHINA`, `SIAM`
  - `SIAM`: `INDIA`, `CHINA`, `INDONESIA` $(+ \text{`PHILIPPINES`})$
- **Oceania (`OC`):**
  - `INDONESIA`: `SIAM`, `NEW_GUINEA`, `WESTERN_AUSTRALIA` $(+ \text{`PHILIPPINES`})$
  - `NEW_GUINEA`: `INDONESIA`, `WESTERN_AUSTRALIA`, `EASTERN_AUSTRALIA` $(+ \text{`PHILIPPINES`})$
  - `WESTERN_AUSTRALIA`: `INDONESIA`, `NEW_GUINEA`, `EASTERN_AUSTRALIA`
  - `EASTERN_AUSTRALIA`: `NEW_GUINEA`, `WESTERN_AUSTRALIA` $(+ \text{`NEW_ZEALAND`})$

---

## 4. Configurazione Partita, Setup Iniziale e Condizioni di Vittoria

### 4.1 Parametri Stanza (`GameSettings`)

L'Host può configurare fino a **8 giocatori** (umani o Generali IA) e personalizzare i seguenti parametri:

1. **Modalità di Gioco (`gameMode`):** `'CLASSIC'` | `'SAME_TIME'`.
2. **Territori Aggiuntivi (`extraTerritories`):** `'NONE'` (42 territori), `'ALL'` (48 territori), o selezione custom dei 6 territori extra.
3. **Assegnazione Iniziale Territori (`territoryAllocation`):**
   - `'RANDOM'`: I territori vengono distribuiti equamente a caso dal motore.
   - `'GRAB'`: I giocatori scelgono a turno un territorio libero finché la mappa non è completa.
   - `'ELECTION'` _(Esclusiva Risk II)_: Ogni giocatore riceve un budget di punti offerta (es. $1000$ punti). Per ogni territorio messo all'asta, tutti i giocatori puntano in segreto un'offerta $\ge 0$. Chi offre di più ottiene il territorio. Al termine dell'asta, i punti risparmiati vengono convertiti in armate bonus iniziali.
4. **Schieramento Iniziale Armate (`initialDeployment`):** `'AUTOMATIC'` (distribuite dal motore) | `'MANUAL'` (piazzate dai giocatori sui propri territori).
5. **Valore Scambio Carte (`cardTradeMode`):**
   - `'ASCENDING'` (Crescente globale): Il $1^\circ$ tris vale $4$, il $2^\circ$ vale $6$, poi $8, 10, 12, 15, 20, 25, \dots$ ($+5$ per ogni tris successivo al sesto).
   - `'FIXED_SET'` (Valore fisso per combinazione): Tre Fanti $= 4$, Tre Cavalli $= 6$, Tre Cannoni $= 8$, Uno per tipo (o con Jolly) $= 10$.
6. **Obiettivo di Vittoria (`victoryCondition`):**
   - `'DOMINATION_100'`: Conquistare tutti i 42/48 territori.
   - `'DOMINATION_80'`: Controllare l'$80\%$ della mappa a fine turno/round ($34$ su $42$ territori, oppure $38$ su $48$ territori).
   - `'DOMINATION_60'`: Controllare il $60\%$ della mappa a fine turno/round ($25$ su $42$ territori, oppure $33$ su $48$ territori).
   - `'MISSION'` _(Obiettivi Segreti)_: Ogni giocatore pesca una carta missione segreta (es. _"Conquista Europa, Oceania e un terzo continente a scelta"_ oppure _"Elimina l'armata Rossa; se sei tu o se viene eliminata da altri, conquista il $60\%$ della mappa"_). Quando il requisito è soddisfatto, il pulsante **Mission** lampeggia e il giocatore può reclamare la vittoria.
   - `'CAPITAL'`: Ogni giocatore sceglie segretamente la propria Capitale iniziale. Per vincere occorre mantenere la propria Capitale e conquistare $N$ Capitali nemiche (in base al numero di giocatori).

### 4.2 Dotazione Iniziale di Armate

In base al numero di giocatori $P \in [2, 8]$ e alla variante mappa (42 vs 48), ogni giocatore riceve una dotazione iniziale complessiva $A_{\text{init}}$:

- $2$ giocatori: $40$ armate ($45$ con 48 territori)
- $3$ giocatori: $35$ armate ($40$ con 48 territori)
- $4$ giocatori: $30$ armate ($35$ con 48 territori)
- $5$ giocatori: $25$ armate ($30$ con 48 territori)
- $6$ giocatori: $20$ armate ($25$ con 48 territori)
- $7$ giocatori: $20$ armate ($22$ con 48 territori)
- $8$ giocatori: $15$ armate ($20$ con 48 territori)

---

## 5. Meccaniche Core: Modalità "Classic Risk" (Sequenziale)

In modalità Classica, i giocatori agiscono uno alla volta secondo un ordine turno prestabilito. Ogni turno individuale attraversa 4 stati sequenziali:

### 5.1 Fase 1: Rinforzo (`CLASSIC_REINFORCE`)

1. **Calcolo Armate Base:** Il giocatore riceve un numero di armate pari a:
   $$R_{\text{base}} = \max\left(3, \left\lfloor \frac{T_{\text{owned}}}{3} \right\rfloor\right) + \sum_{c \in C_{\text{owned}}} \text{Bonus}(c)$$
   dove $T_{\text{owned}}$ è il numero di territori posseduti all'inizio del turno e $C_{\text{owned}}$ i continenti posseduti interamente.
2. **Scambio Carte:** Se il giocatore possiede un tris valido di carte (3 simboli uguali, 3 simboli diversi, oppure 2 carte + 1 Jolly), può scambiarle per armate aggiuntive. Se il giocatore possiede almeno $5$ carte in mano, lo scambio è **obbligatorio** prima di poter attaccare.
3. **Bonus Territorio Carta:** Se una o più carte del tris scambiato raffigurano un territorio attualmente posseduto dal giocatore, vengono aggiunte $+2$ armate direttamente su uno di quei territori (massimo una volta per tris scambiato).
4. **Piazzamento:** Il giocatore distribuisce liberamente tutte le armate nel proprio pool sui territori che controlla.

### 5.2 Fase 2: Attacco (`CLASSIC_ATTACK`)

1. Il giocatore può dichiarare attacchi da qualsiasi proprio territorio con almeno $2$ armate verso un territorio nemico adiacente.
2. **Lancio Dadi Standard ($d6$):**
   - L'attaccante sceglie se lanciare $1, 2$ o $3$ dadi a 6 facce (deve avere almeno $\text{dadi} + 1$ armate nel territorio attaccante) oppure selezionare **Blitz** (risoluzione automatica fino alla conquista o all'esaurimento truppe).
   - Il difensore lancia automaticamente $\min(2, A_{\text{difesa}})$ dadi a 6 facce.
   - I dadi vengono ordinati in modo decrescente ($A_1 \ge A_2 \ge A_3$ e $D_1 \ge D_2$). Si confrontano le coppie $(A_1, D_1)$ e, se entrambi hanno lanciato almeno 2 dadi, $(A_2, D_2)$.
   - Per ogni coppia: se $A_i > D_i$, il difensore perde $1$ armata; se $A_i \le D_i$, l'attaccante perde $1$ armata (i pareggi favoriscono sempre la difesa).
3. **Conquista e Occupazione:** Se le armate del difensore scendono a $0$, l'attaccante conquista il territorio e deve spostarvi un numero di armate compreso tra il numero di dadi usati nell'ultimo tiro e $A_{\text{origine}} - 1$.
4. **Eliminazione Giocatore:** Se un giocatore perde il suo ultimo territorio, viene eliminato dalla partita. L'attaccante che lo ha eliminato eredita immediatamente tutte le sue carte Risk. Se questo porta la mano dell'attaccante a $\ge 6$ carte, deve effettuare immediatamente degli scambi fino a scendere sotto 5 carte e piazzare i relativi rinforzi prima di proseguire la fase di attacco.

### 5.3 Fase 3: Movimento Tattico (`CLASSIC_TACTICAL_MOVE`)

- **Regola Specifica di Risk II:** A differenza di alcune varianti da tavolo che permettono spostamenti lungo catene di territori connessi, in _Risk II_ è consentito **un solo movimento tattico per turno** di un qualsiasi numero di armate (lasciandone almeno $1$ sul territorio di partenza) **esclusivamente tra due territori direttamente confinanti** controllati dal giocatore.

### 5.4 Fase 4: Pescaggio Carta (`CLASSIC_CARD_DRAW`)

- Se il giocatore ha conquistato almeno $1$ territorio durante la fase di attacco, pesca $1$ carta dal mazzo (che contiene 48 carte territorio divise tra Fanteria, Cavalleria e Artiglieria + 2 carte Jolly).

---

## 6. Meccaniche Core: Modalità "Same-Time Risk" (Simultanea)

La modalità **Same-Time Risk** è il cuore distintivo di _Risk II_. I turni sono sostituiti da **Round simultanei** articolati in 4 Fasi globali in cui tutti i giocatori in vita pianificano le proprie mosse in segreto prima della risoluzione.

### 6.1 Fase 1: I-COM (Diplomazia e Alleanze)

Tramite il pannello **I-COM**, i giocatori possono proporre, accettare, rifiutare o rompere trattati bilaterali con gli altri giocatori (umani o IA). Esistono 3 livelli di alleanza vincolati dal motore o tracciati per la reputazione:

- **Alleanza Livello 1 (Patto Imperiale):** Nessuno dei due alleati può attaccare un continente interamente posseduto dall'altro o il suo gruppo più grande di territori contigui. Gli altri territori isolati restano attaccabili.
- **Alleanza Livello 2 (Patto di Non Aggressione con Permesso Carta):** I due alleati non possono attaccarsi, fatta eccezione per un singolo attacco tollerato per round su un territorio periferico con $1$ sola armata allo scopo di ottenere la carta Risk.
- **Alleanza Livello 3 (Alleanza Totale):** Divieto assoluto di attacco reciproco. Qualsiasi attacco verso l'alleato rompe istantaneamente il trattato e genera un malus permanente di onore (`honorPenalty`) nella memoria di tutti i Generali IA.

### 6.2 Fase 2: Rinforzo Simultaneo (`SAMETIME_REINFORCE`)

- Tutti i giocatori calcolano i propri rinforzi, scambiano eventuali tris di carte e piazzano le nuove armate contemporaneamente.
- Le armate piazzate dai giocatori restano **invisibili agli avversari** finché tutti non confermano la fine della fase di rinforzo (`COMMIT_REINFORCEMENTS`), momento in cui vengono rivelate simultaneamente sulla mappa.

### 6.3 Fase 3: Pianificazione Ordini di Battaglia (`SAMETIME_PLAN_ORDERS`)

Ogni giocatore traccia in segreto le proprie frecce di attacco sulla mappa impegnando un numero specifico di armate dal territorio di partenza (lasciando sempre almeno $1$ armata di presidio a difesa del territorio stesso).

- **Impegno Truppe:** Da un territorio con $N$ armate è possibile lanciare più attacchi verso territori adiacenti diversi, purché la somma delle armate impegnate nelle frecce non superi $N - 1$.
- **Surge Attack (Attacco in Profondità / Ondata):** Ogni giocatore ha diritto a **un solo Surge Attack per round**. Un Surge Attack permette di pianificare un attacco primario $A \rightarrow B$ e un attacco secondario concatenato $B \rightarrow C$ (partendo da un territorio $B$ non ancora conquistato). L'attacco $B \rightarrow C$ avrà luogo solo se $B$ viene effettivamente conquistato durante il round.

### 6.4 Il Sistema dei 5 Dadi Colorati a 12 Facce ($d12$) nel Same-Time Risk

In modalità _Same-Time_, i dadi classici $d6$ vengono sostituiti da **dadi speciali a 12 facce ($d12$) divisi in 5 fasce di colore**. Ogni faccia riporta un valore da $1$ a $6$, ma la distribuzione delle facce è fortemente ponderata ("truccata") in base alla dimensione dell'armata coinvolta nello scontro. Più il colore del dado è scuro, più alta è la probabilità di ottenere $5$ e $6$.

| Colore Dado ($d12$)      | Range Armate in Attacco | Range Armate in Difesa | Distribuzione delle 12 Facce $[1, 2, 3, 4, 5, 6]$                       | Valore Atteso ($\mu$) |
| :----------------------- | :---------------------: | :--------------------: | :---------------------------------------------------------------------- | :-------------------: |
| **Bianco (`WHITE`)**     |         $1 - 3$         |        $1 - 6$         | $[1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6]$ _(4x1, 3x2, 2x3, 1x4, 1x5, 1x6)_ |    $2.58$ ($2.6$)     |
| **Giallo (`YELLOW`)**    |         $4 - 7$         |        $7 - 12$        | $[1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 5, 6]$ _(2x1, 4x2, 2x3, 2x4, 1x5, 1x6)_ |    $2.92$ ($2.9$)     |
| **Arancione (`ORANGE`)** |        $8 - 12$         |       $13 - 20$        | $[1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6]$ _(1x1, 2x2, 3x3, 3x4, 2x5, 1x6)_ |    $3.50$ ($3.5$)     |
| **Rosso (`RED`)**        |        $13 - 18$        |         $21+$          | $[1, 2, 3, 3, 4, 4, 5, 5, 5, 5, 6, 6]$ _(1x1, 1x2, 2x3, 2x4, 4x5, 2x6)_ |    $4.08$ ($4.1$)     |
| **Nero (`BLACK`)**       |          $19+$          |   _Non disponibile_    | $[1, 2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6]$ _(1x1, 1x2, 1x3, 2x4, 3x5, 4x6)_ |    $4.42$ ($4.5$)     |

- **Regola di Aggiornamento Dinamico del Dado:** Durante una battaglia, man mano che un esercito subisce perdite, il colore del suo dado $d12$ viene ricalcolato ad ogni round di tiro scendendo nella fascia corrispondente alle truppe superstiti.

### 6.5 Fase 3b: Ordine Deterministico di Risoluzione delle Battaglie (`SAMETIME_RESOLVE_BATTLES`)

Quando tutti i giocatori hanno confermato i propri ordini, tutte le frecce vengono rivelate sulla mappa e il `GameEngine` risolve i combattimenti rigorosamente nel seguente ordine di priorità:

1. **Sotto-fase A – Border Clashes (Scontri di Confine):**
   - Si verificano quando il territorio $A$ attacca $B$ e contemporaneamente il territorio $B$ attacca $A$.
   - I due contingenti attaccanti si scontrano direttamente "sul confine" (entrambi usano la tabella di **Attacco** per determinare il colore del proprio dado $d12$, lanciando 1 dado ciascuno; in caso di pareggio nessuno perde truppe in quel lancio, oppure chi ha il tiro più alto infligge 1 perdita all'altro).
   - L'armata che annienta il contingente avversario sul confine prosegue automaticamente il proprio attacco invadendo il territorio nemico con le truppe superstiti.

2. **Sotto-fase B – Mass Invasions (Invasioni di Massa / Multi-Giocatore):**
   - Si verificano quando **più giocatori diversi** (fino a 6 attaccanti contro 1 difensore, per un totale di 7 eserciti) attaccano contemporaneamente lo stesso territorio bersaglio $T$.
   - Ogni contingente attaccante e il difensore lanciano un singolo dado $d12$ del colore corrispondente alla propria forza.
   - Se il dado del difensore è $\ge$ al dado di un attaccante, quell'attaccante perde $1$ armata.
   - Se uno o più attaccanti superano rigorosamente il dado del difensore, il difensore perde $1$ armata per il colpo subito dal vincitore del lancio.
   - **Spoils of War (Bottino di Guerra):** Se la guarnigione del difensore viene azzerata e restano in vita contingenti di più giocatori attaccanti, questi ultimi combattono immediatamente tra loro (tutti in modalità Attacco) finché non sopravvive un unico esercito che conquista il territorio $T$.

3. **Sotto-fase C – Multiple-Border Attacks (Attacchi Multi-Confine):**
   - Si verificano quando **un singolo giocatore** attacca un territorio nemico $T$ partendo da $2$ o $3$ propri territori confinanti contemporaneamente (fino a 3 contingenti).
   - L'attaccante lancia un dado $d12$ separato per ciascun contingente (fino a 3 dadi), mentre il difensore lancia un solo dado $d12$ basato sulla guarnigione totale di $T$.
   - Il dado del difensore viene confrontato individualmente con ciascun dado dell'attaccante: se il difensore pareggia o supera tutti i dadi dell'attaccante, ogni contingente attaccante perde $1$ armata; viceversa, ogni contingente attaccante che supera il tiro del difensore infligge $1$ perdita al difensore.

4. **Sotto-fase D – Standard Single-Border Attacks (Attacchi Singoli):**
   - Attacchi $1\text{ vs }1$ da un singolo territorio a un altro: 1 dado $d12$ per l'attaccante contro 1 dado $d12$ per il difensore.

5. **Sotto-fase E – Surge Attacks (Attacchi in Profondità):**
   - Vengono risolti per ultimi. Se il giocatore ha conquistato il territorio intermedio $B$ con almeno $2$ armate superstiti, il contingente pianificato parte da $B$ per attaccare $C$.

_(Nota Ritirata: Durante la risoluzione manuale in BattleView, l'attaccante può ordinare il `RETREAT` delle truppe superstiti nel territorio di origine, tranne durante uno scontro Spoils of War)._

### 6.6 Fase 4: Movimento Tattico Simultaneo (`SAMETIME_TACTICAL_MOVE`)

- Tutti i giocatori possono eseguire 1 movimento tattico tra due propri territori adiacenti. Gli spostamenti avvengono simultaneamente prima dell'assegnazione della carta Risk (1 carta a chiunque abbia conquistato almeno un territorio nel round) e dell'avanzamento al round successivo.

---

## 7. Intelligenza Artificiale: I 16 Generali Storici e Modalità Torneo

### 7.1 Architettura del Motore IA

Il motore IA gira dentro un **Web Worker** dedicato (lato Host o in Single-Player) per non bloccare mai il thread di rendering. L'IA riceve il proprio `PlayerViewState` (quindi **non bara**: non vede le carte altrui né le frecce segrete pianificate dagli umani nel _Same-Time Risk_) e restituisce una sequenza di `GameCommand` validi.

Ogni Generale IA è definito da un vettore di parametri comportamentali ($\in [0.0, 1.0]$):

- `aggression`: Propensione ad attaccare anche con rapporti di forza non schiaccianti.
- `defenseThreshold`: Quantità minima di truppe mantenuta sui confini prima di impegnare armate in attacco.
- `honor`: Affidabilità nel rispettare i patti I-COM (Livello 1, 2, 3) e riluttanza al tradimento.
- `grudgeMemory`: Tendenza a dare priorità assoluta alla vendetta contro un giocatore che ha rotto un'alleanza o gli ha sottratto un continente.
- `missionFocus`: Priorità data ai territori del proprio obiettivo rispetto all'espansione opportunistica.
- `surgeTendency`: Frequenza di utilizzo dei _Surge Attacks_ e delle _Mass Invasions_ in modalità Same-Time.

### 7.2 Tabella dei 16 Generali di Risk II

| ID Generale  | Nome Storico            | Stile Tattico Principale                                                | `aggression` | `defense` | `honor` | `grudge` | `mission` |
| :----------- | :---------------------- | :---------------------------------------------------------------------- | :----------: | :-------: | :-----: | :------: | :-------: |
| `CAMPBELL`   | Colin Campbell          | Cauto, ossessionato dall'obiettivo, non porta rancore                   |    $0.40$    |  $0.75$   | $0.80$  |  $0.15$  |  $0.95$   |
| `MACKENZIE`  | Alexander Mackenzie     | Bilanciato ma vendicativo, ottima memoria dei torti                     |    $0.55$    |  $0.60$   | $0.70$  |  $0.90$  |  $0.65$   |
| `WELLINGTON` | Arthur Wellesley        | Maestro difensivo, contrattacca solo con vantaggio netto                |    $0.45$    |  $0.95$   | $0.90$  |  $0.50$  |  $0.80$   |
| `BONAPARTE`  | Napoleone Bonaparte     | Espansionista brillante, maestro di Mass Invasion e Surge               |    $0.90$    |  $0.55$   | $0.45$  |  $0.85$  |  $0.85$   |
| `MARMONT`    | Auguste de Marmont      | Opportunista, colpisce i confini indeboliti da altri                    |    $0.65$    |  $0.50$   | $0.35$  |  $0.60$  |  $0.70$   |
| `BARBACENA`  | Felisberto Caldeira     | Aggressore puro, preferisce il Sud America e attacchi rapidi            |    $0.85$    |  $0.35$   | $0.50$  |  $0.70$  |  $0.55$   |
| `DERLON`     | Jean-Baptiste d'Erlon   | Il più prudente in assoluto; attacca solo a vittoria certa e onore alto |    $0.25$    |  $0.90$   | $0.95$  |  $0.30$  |  $0.60$   |
| `MARANSIN`   | Jean-Pierre Maransin    | Tattico metodico, costruisce blocchi continentali solidi                |    $0.50$    |  $0.70$   | $0.65$  |  $0.55$  |  $0.75$   |
| `SOLIGNAC`   | Jean-Baptiste Solignac  | Impulsivo e poco difensivo, facile da sorprendere nelle retrovie        |    $0.70$    |  $0.30$   | $0.40$  |  $0.65$  |  $0.45$   |
| `SHERBROOKE` | John Coape Sherbrooke   | Diplomatico calcolatore, usa le alleanze per isolare il leader          |    $0.60$    |  $0.65$   | $0.75$  |  $0.75$  |  $0.80$   |
| `AUBERT`     | Claude Aubert           | Conservatore a inizio partita, esplosivo quando accumula carte          |    $0.50$    |  $0.80$   | $0.60$  |  $0.50$  |  $0.70$   |
| `SPENCER`    | Brent Spencer           | Focalizzato sul controllo marittimo e sulle isole extra                 |    $0.60$    |  $0.60$   | $0.70$  |  $0.45$  |  $0.65$   |
| `TAUPIN`     | Éloi Charlemagne Taupin | Guerrafondaio spietato e calcolatore, raramente accetta tregue          |    $0.95$    |  $0.45$   | $0.20$  |  $0.85$  |  $0.75$   |
| `FREIRE`     | Bernardim Freire        | Generale base, prevedibile e propenso a disperdere le forze             |    $0.45$    |  $0.45$   | $0.60$  |  $0.40$  |  $0.50$   |
| `VAUBAN`     | Sébastien Le Prestre    | Ingegnere militare d'élite: confini impenetrabili e Surge letali        |    $0.75$    |  $0.90$   | $0.75$  |  $0.80$  |  $0.90$   |
| `BAIRD`      | David Baird             | Instabile, onore bassissimo, aggressività estrema e vendetta totale     |    $0.95$    |  $0.30$   | $0.10$  |  $1.00$  |  $0.60$   |

### 7.3 Modalità Torneo Single-Player (16 Round)

Il gioco include la modalità **Torneo** originale strutturata in **16 Round preconfigurati** a difficoltà crescente (alternando regole _Classic_ e _Same-Time_, obiettivi _Domination_, _Mission_ e _Capital_, e combinazioni specifiche dei 16 Generali).

- **Regola Eliminazione:** Una singola sconfitta in qualsiasi round termina il torneo.
- **Calcolo Punteggio Round:** Al completamento di ogni round il giocatore ottiene punti base per la vittoria più bonus per la velocità (numero di turni impiegati) e per ogni Generale avversario eliminato personalmente. Lo stato del torneo e la Hall of Fame locale vengono salvati su IndexedDB.

---

## 8. Contratti Dati e Schemi TypeScript (Core Engine)

Di seguito i contratti TypeScript fondamentali che l'AI agentica deve implementare in `src/engine/models/`:

```typescript
export type GameMode = 'CLASSIC' | 'SAME_TIME';
export type TurnPhase =
  | 'SETUP_ALLOCATION'
  | 'SETUP_DEPLOYMENT'
  | 'CLASSIC_REINFORCE'
  | 'CLASSIC_ATTACK'
  | 'CLASSIC_OCCUPY'
  | 'CLASSIC_TACTICAL_MOVE'
  | 'SAMETIME_ICOM'
  | 'SAMETIME_REINFORCE'
  | 'SAMETIME_PLAN_ORDERS'
  | 'SAMETIME_RESOLVE_BATTLES'
  | 'SAMETIME_TACTICAL_MOVE'
  | 'GAME_OVER';

export type CardSymbol = 'INFANTRY' | 'CAVALRY' | 'ARTILLERY' | 'WILD';
export type AllianceLevel = 0 | 1 | 2 | 3;
export type SameTimeDieColor = 'WHITE' | 'YELLOW' | 'ORANGE' | 'RED' | 'BLACK';

export interface TerritoryState {
  id: string;
  ownerId: string | null;
  armies: number;
  isCapitalOfPlayerId?: string | null;
}

export interface PlannedAttackOrder {
  orderId: string;
  playerId: string;
  fromTerritoryId: string;
  toTerritoryId: string;
  committedArmies: number;
  isSurgeAttack: boolean; // Max 1 per player per round
  surgeParentOrderId?: string;
}

export interface FullGameState {
  matchId: string;
  seed: number; // Stato corrente del PRNG Mulberry32
  settings: GameSettings;
  roundNumber: number;
  phase: TurnPhase;
  activePlayerId: string | null; // Usato in CLASSIC o in SETUP_GRAB
  players: Record<string, PlayerInternalState>;
  territories: Record<string, TerritoryState>;
  deck: RiskCard[];
  discardPile: RiskCard[];
  setsTradedCount: number;
  alliances: Record<string, Record<string, AllianceLevel>>; // playerA -> playerB -> level
  pendingReinforcements: Record<string, Record<string, number>>; // playerId -> territoryId -> armies
  plannedOrders: Record<string, PlannedAttackOrder[]>; // playerId -> ordini segreti
  playerReadyStatus: Record<string, boolean>; // Chi ha premuto COMMIT nella fase corrente
  activeCombat: ActiveCombatState | null;
  winnerPlayerId: string | null;
}

// Vista filtrata inviata alla UI o via WebRTC a un singolo giocatore
export interface PlayerViewState {
  matchId: string;
  viewerPlayerId: string;
  settings: GameSettings;
  roundNumber: number;
  phase: TurnPhase;
  activePlayerId: string | null;
  myHand: RiskCard[];
  myMission?: MissionCard;
  myPlannedOrders: PlannedAttackOrder[];
  myPendingReinforcements: Record<string, number>;
  // Ordini avversari visibili SOLO quando phase === 'SAMETIME_RESOLVE_BATTLES'
  revealedAllOrders: PlannedAttackOrder[] | null;
  playersPublic: Array<{
    playerId: string;
    name: string;
    color: string;
    isAI: boolean;
    aiGeneralId?: string;
    isEliminated: boolean;
    cardsCount: number; // Numero carte, mai i valori!
    unplacedArmies: number;
    isReady: boolean;
  }>;
  territories: Record<string, TerritoryState>;
  alliances: Record<string, Record<string, AllianceLevel>>;
  activeCombat: ActiveCombatState | null;
  winnerPlayerId: string | null;
}

// Union Type esaustivo di tutti i comandi accettati dal motore
export type GameCommand =
  | { type: 'CLAIM_TERRITORY'; playerId: string; territoryId: string }
  | { type: 'SUBMIT_ELECTION_BIDS'; playerId: string; bids: Record<string, number> }
  | { type: 'TRADE_CARDS'; playerId: string; cardIds: [string, string, string] }
  | { type: 'PLACE_REINFORCEMENT'; playerId: string; territoryId: string; armies: number }
  | { type: 'PROPOSE_ALLIANCE'; playerId: string; targetPlayerId: string; level: AllianceLevel }
  | { type: 'RESPOND_ALLIANCE'; playerId: string; proposerPlayerId: string; accept: boolean }
  | {
      type: 'DECLARE_CLASSIC_ATTACK';
      playerId: string;
      fromId: string;
      toId: string;
      dice: 1 | 2 | 3 | 'BLITZ';
    }
  | { type: 'OCCUPY_CONQUERED_TERRITORY'; playerId: string; armiesToMove: number }
  | {
      type: 'ADD_SAMETIME_ORDER';
      playerId: string;
      fromId: string;
      toId: string;
      armies: number;
      isSurge: boolean;
    }
  | { type: 'REMOVE_SAMETIME_ORDER'; playerId: string; orderId: string }
  | { type: 'COMBAT_ROLL_STEP'; playerId: string; mode: 'SINGLE_ROLL' | 'BLITZ' | 'RETREAT' }
  | {
      type: 'EXECUTE_TACTICAL_MOVE';
      playerId: string;
      fromId: string;
      toId: string;
      armies: number;
    }
  | { type: 'CLAIM_MISSION_VICTORY'; playerId: string }
  | { type: 'COMMIT_PHASE'; playerId: string };
```

---

## 9. Architettura Multiplayer P2P (WebRTC) e Persistenza Offline

### 9.1 Topologia e Flusso di Connessione tra Amici

1. **Creazione Stanza (Host):**
   - L'Host apre la PWA, configura le regole della partita e clicca su **"Ospita Partita Online"**.
   - Il client dell'Host inizializza un nodo PeerJS / WebRTC registrando un codice stanza leggibile a 6 caratteri (es. `RSK-4920`) e resta in ascolto di connessioni entranti.
2. **Accesso alla Stanza (Guest):**
   - Gli amici aprono la stessa PWA, cliccano **"Unisciti a Partita"**, inseriscono il codice `RSK-4920` e il proprio nickname.
   - Il browser del Guest genera (o recupera dal proprio `localStorage`) un `playerSecretToken` (UUID v4) e apre un `DataChannel` WebRTC diretto verso l'Host.
3. **Gestione Riconnessioni ($F5$ / Caduta Wi-Fi) e "Salva & Riprendi domani":**
   - L'Host associa ogni slot giocatore al relativo `playerSecretToken` e salva l'intero `FullGameState` in una tabella `saved_matches` su **IndexedDB** (tramite Dexie.js) ad ogni transizione di fase.
   - Se un amico ricarica la pagina per errore o cade la connessione, rientrando nella stanza invia automaticamente il proprio `playerSecretToken`: l'Host ricollega la nuova connessione WebRTC allo slot esistente e gli invia immediatamente un pacchetto `STATE_SYNC` con il suo `PlayerViewState` aggiornato.
   - Se il gruppo decide di interrompere la partita a fine serata, il giorno successivo l'Host carica il salvataggio da IndexedDB, apre una nuova stanza e gli amici riprendono il controllo dei propri eserciti in pochi secondi.

### 9.2 Configurazione Rete STUN / TURN

- Configurare `RTCPeerConnection` con server STUN pubblici gratuiti (`stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`) e prevedere nel file di configurazione il supporto per credenziali TURN standard per garantire la connessione anche ad amici sotto NAT simmetrico o rete cellulare 4G/5G.

---

## 10. Interfaccia Utente (UI/UX) e Filtri Mappa di Risk II

L'interfaccia deve riprodurre l'ergonomia e la chiarezza visiva di _Risk II_ su schermi $16:9$ moderni:

1. **Mappa Vettoriale SVG Interattiva (48 Territori):**
   - Ogni territorio è un `<path>` SVG distinto con `id` corrispondente al grafo, centroide calcolato per il posizionamento dello scudo/badge contenente il numero di armate e livello overlay `<svg>` superiore per disegnare le frecce curve animate degli attacchi e i confini lampeggianti.
   - I 6 territori opzionali (`QIKIQTAALUK`, `HAWAII`, `FALKLAND_ISLANDS`, `SVALBARD`, `PHILIPPINES`, `NEW_ZEALAND`) e le relative linee tratteggiate di connessione marittima vengono mostrati/nascosti dinamicamente in base ai settings della partita.
2. **Le 5 Modalità di Visualizzazione Mappa (Map Views originali di Risk II):**
   - **Vista Politica (Default):** Territori colorati in base al giocatore proprietario.
   - **Vista Continenti:** Territori colorati per continente d'appartenenza con indicazione dei bonus.
   - **Vista Minaccia Confini (Border Threat View):** Evidenzia con gradiente dal verde al rosso acceso i propri territori di confine in base al rapporto tra le proprie truppe di presidio e le truppe nemiche adiacenti.
   - **Vista Forza Truppe (Troop Strength View):** Heatmap cromatica basata sulla densità di armate presenti in ogni territorio.
   - **Vista Carte Possedute:** Illumina sulla mappa i territori corrispondenti alle carte attualmente nella mano del giocatore (utile per pianificare il bonus $+2$ armate).
3. **Finestra BattleView:**
   - Modale o pannello tattico che mostra i due (o più, in caso di _Mass Invasion_) generali contrapposti, i battaglioni schierati, il colore del dado $d12$ attivo in modalità _Same-Time_ (o i dadi $d6$ in modalità _Classic_) e i pulsanti **Roll Once**, **Blitz (Auto-Resolve)** e **Retreat**.

---

## 11. Roadmap di Esecuzione per AI Agentica (Epics & Definition of Done)

Per sviluppare il progetto tramite un agente AI senza sovraccaricare la finestra di contesto, richiedi l'implementazione procedendo **un Epic alla volta** nell'ordine seguente:

### Epic 1: Core Engine, PRNG e Grafo dei 48 Territori

- **Obiettivo:** Creare il pacchetto `src/engine/` con il grafo completo dei 42+6 territori, il PRNG deterministico `Mulberry32` e i modelli TypeScript.
- **Definition of Done (DoD):** Unit test Vitest che verificano la simmetria di tutte le adiacenze ($A \in \text{neighbors}(B) \iff B \in \text{neighbors}(A)$) sia in modalità 42 che 48 territori, e la riproducibilità al $100\%$ del PRNG a parità di seed.

### Epic 2: Macchina a Stati "Classic Mode" e Combattimento $d6$

- **Obiettivo:** Implementare in `src/engine/` le fasi di Setup (`RANDOM`, `GRAB`, `ELECTION`), Rinforzo, Scambio Carte, Attacco $d6$, Conquista, Eliminazione Giocatore (con eredità carte) e Movimento Tattico tra adiacenti.
- **DoD:** Unit test che simulano un'intera partita _Classic_ dall'inizio alla condizione di vittoria eseguendo esclusivamente chiamate `engine.dispatch(command)`.

### Epic 3: Motore "Same-Time Mode" e Sistema Dadi Colorati $d12$

- **Obiettivo:** Implementare le tabelle matematiche dei 5 dadi $d12$ (`WHITE`, `YELLOW`, `ORANGE`, `RED`, `BLACK`), il sistema di alleanze I-COM e la pipeline di risoluzione a 5 sotto-fasi (_Border Clashes_ $\rightarrow$ _Mass Invasions_ $\rightarrow$ _Multi-Border_ $\rightarrow$ _Single-Border_ $\rightarrow$ _Surge Attacks_).
- **DoD:** Suite di test che verifica i casi limite simultanei (es. $A \leftrightarrow B$ Border Clash, 4 giocatori che invadono lo stesso territorio con _Spoils of War_ finale, e _Surge Attack_ annullato se il territorio intermedio non viene conquistato).

### Epic 4: Interfaccia Utente PWA e Mappa SVG Interattiva

- **Obiettivo:** Inizializzare l'applicazione frontend con supporto PWA offline (`manifest.webmanifest` + Service Worker), disegnare la mappa SVG dei 48 territori con le 5 viste filtro, l'HUD delle fasi e il `LocalSessionGateway` per partite HotSeat.
- **DoD:** Partita multigiocatore locale (HotSeat) giocabile dall'inizio alla fine nel browser anche disattivando la rete dalle DevTools.

### Epic 5: I 16 Generali IA (Web Worker) e Modalità Torneo

- **Obiettivo:** Implementare il valutatore euristico basato sui parametri dei 16 Generali dentro un Web Worker e la progressione dei 16 round del Torneo con salvataggio automatico su IndexedDB (Dexie.js).
- **DoD:** Possibilità di giocare offline contro 1–7 Generali IA sia in modalità _Classic_ che _Same-Time_, con salvataggio e caricamento istantaneo della partita.

### Epic 6: Multiplayer P2P WebRTC (Host-Client) e Packaging Desktop Tauri

- **Obiettivo:** Implementare `WebRtcSessionGateway` (creazione stanza con codice, join degli amici, `playerSecretToken` per riconnessione su $F5$, e sincronizzazione `PlayerViewState`) e configurare Tauri per la generazione dell'installer `.exe` / `.msi` per Windows 10/11.
- **DoD:** Test su 2+ finestre browser separate (Host + Guest) che verificano l'oscuramento delle informazioni segrete sul canale di rete, la riconnessione dopo refresh pagina e la compilazione dell'eseguibile Windows.
