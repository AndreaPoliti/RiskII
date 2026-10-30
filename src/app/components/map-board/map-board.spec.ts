import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapBoard } from './map-board';

describe('MapBoard', () => {
  let component: MapBoard;
  let fixture: ComponentFixture<MapBoard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapBoard],
    }).compileComponents();

    fixture = TestBed.createComponent(MapBoard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
