import { describe, expect, it } from 'vitest';
import { AUDITORIUM_CONFIG } from './config.ts';
import { createAuditoriumLayout, floorElevationAt, seatEyePosition, seatFootprintCorners } from './layout.ts';
import { validateLayout } from './validation.ts';

const layout = createAuditoriumLayout();
const { seats, rows, metrics } = layout;

describe('auditorium layout', () => {
  it('passes every layout check', () => {
    expect(validateLayout(layout)).toEqual([]);
  });

  it('has 10 rows A–J with 11 seats each and 110 unique ids', () => {
    expect(rows.map((r) => r.label).join('')).toBe('ABCDEFGHIJ');
    expect(seats).toHaveLength(110);
    expect(new Set(seats.map((s) => s.id)).size).toBe(110);
    for (const row of rows) expect(seats.filter((s) => s.rowIndex === row.index)).toHaveLength(11);
    expect(seats[0].id).toBe('A01');
    expect(seats[109].id).toBe('J11');
    expect(layout.seatById.get('F06')).toBe(seats[5 * 11 + 5]);
  });

  it('numbers seats 01–11 from -X to +X and keeps index in sync', () => {
    for (const row of rows) {
      const rowSeats = seats.filter((s) => s.rowIndex === row.index);
      rowSeats.forEach((seat, column) => {
        expect(seat.columnIndex).toBe(column);
        expect(seat.seatNumber).toBe(column + 1);
        if (column > 0) expect(seat.position.x).toBeGreaterThan(rowSeats[column - 1].position.x);
      });
    }
    seats.forEach((seat, index) => expect(seat.index).toBe(index));
  });

  it('has finite coordinates, faces the screen and is symmetric about X = 0', () => {
    for (const seat of seats) {
      expect([seat.position.x, seat.position.y, seat.position.z, seat.yaw].every(Number.isFinite)).toBe(true);
      expect(seat.yaw).toBe(0);
      const mirror = seats.find((s) => s.rowIndex === seat.rowIndex && s.seatNumber === 12 - seat.seatNumber)!;
      expect(mirror.position.x).toBeCloseTo(-seat.position.x, 9);
    }
  });

  it('stands every seat on its row floor', () => {
    for (const seat of seats) {
      expect(seat.position.y).toBe(seat.floorY);
      expect(seat.floorY).toBeCloseTo(seat.rowIndex * 0.18, 9);
      expect(floorElevationAt(layout, seat.position.z)).toBeCloseTo(seat.floorY, 9);
    }
  });

  it('keeps every footprint out of both aisles and inside the room', () => {
    for (const seat of seats) {
      for (const corner of seatFootprintCorners(layout, seat)) {
        expect(corner.x).toBeGreaterThanOrEqual(layout.seatingZone.x.min);
        expect(corner.x).toBeLessThanOrEqual(layout.seatingZone.x.max);
        for (const aisle of layout.aisles) {
          expect(corner.x <= aisle.x.min || corner.x >= aisle.x.max).toBe(true);
        }
      }
    }
  });

  it('matches the planned dimensions', () => {
    expect(metrics.seatBlockWidth).toBeCloseTo(8.58, 9);
    expect(metrics.seatCentreSpan).toBeCloseTo(7.8, 9);
    expect(metrics.sideSpace).toBeCloseTo(1.71, 9);
    expect(metrics.aisleBuffer).toBeCloseTo(0.21, 9);
    expect(metrics.rowBlockLength).toBeCloseTo(11.5, 9);
    expect(metrics.rowCentreSpan).toBeCloseTo(10.35, 9);
    expect(metrics.lastRowFloorY).toBeCloseTo(1.62, 9);
    expect(rows[0].treadZ.min).toBeCloseTo(-3.7, 9);
    expect(rows[0].seatZ).toBeCloseTo(-3.025, 9);
    expect(rows[9].seatZ).toBeCloseTo(7.325, 9);
    expect(layout.screen.center.z).toBeCloseTo(-8.7, 9);
    expect(layout.screen.height).toBeCloseTo(4.78125, 9);
    expect(layout.screen.width / layout.screen.height).toBeCloseTo(16 / 9, 9);
    expect(metrics.frontClearance).toBeCloseTo(3.9, 9);
    expect(metrics.backClearance).toBeCloseTo(1.3, 9);
  });

  it('builds one raised tread per row above the floor, continuous and rising', () => {
    expect(layout.treads).toHaveLength(9);
    layout.treads.forEach((tread, i) => {
      if (i > 0) {
        expect(tread.z.min).toBe(layout.treads[i - 1].z.max);
        expect(tread.y).toBeGreaterThan(layout.treads[i - 1].y);
      }
    });
    expect(layout.treads.at(-1)!.z.max).toBe(layout.interior.z.max);
  });

  it('puts the seated eye 1.15 m above the seat floor, inside the room', () => {
    const seat = layout.seatById.get('F06')!;
    const eye = seatEyePosition(layout, seat);
    expect(eye.y).toBeCloseTo(seat.floorY + 1.15, 9);
    expect(eye.z).toBeCloseTo(seat.position.z + 0.15, 9);
  });
});

describe('layout validation catches conflicts', () => {
  it('reports seats intruding into the aisles', () => {
    const config = structuredClone(AUDITORIUM_CONFIG);
    config.aisles.width = 2.2;
    expect(validateLayout(createAuditoriumLayout(config)).some((p) => p.includes('aisle'))).toBe(true);
  });

  it('reports rows that run into the stage when the room is too short', () => {
    const config = structuredClone(AUDITORIUM_CONFIG);
    config.room.length = 13;
    expect(validateLayout(createAuditoriumLayout(config))).toContain('Row A starts inside the stage.');
  });

  it('reports seats straddling a riser', () => {
    const config = structuredClone(AUDITORIUM_CONFIG);
    config.seating.seatBackClearance = -0.2;
    expect(validateLayout(createAuditoriumLayout(config)).some((p) => p.includes('tread'))).toBe(true);
  });
});
