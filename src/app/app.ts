import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MapBoardComponent } from './components/map-board/map-board';

@Component({
  imports: [RouterOutlet, MapBoardComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('Risk2');
}
