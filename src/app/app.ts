import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MapBoardComponent } from './components/map-board/map-board';
import { GameLobbyComponent } from './components/game-lobby/game-lobby.component';
import { LocalSessionGateway } from '@services/gateway/local-session.gateway';

@Component({
  imports: [MapBoardComponent, GameLobbyComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly gateway = inject(LocalSessionGateway);
}
