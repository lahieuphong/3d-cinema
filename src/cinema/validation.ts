import {
  floorElevationAt,
  seatEyePosition,
  seatFootprintCorners,
  type AuditoriumLayout,
  type Box,
  type Range,
} from './layout.ts';

const TOLERANCE = 1e-6;

const within = (value: number, range: Range) => value >= range.min - TOLERANCE && value <= range.max + TOLERANCE;
const boxWithin = (inner: Box, outer: Box) =>
  (['x', 'y', 'z'] as const).every((axis) => within(inner[axis].min, outer[axis]) && within(inner[axis].max, outer[axis]));
const rangesOverlap = (a: Range, b: Range) => a.min < b.max - TOLERANCE && b.min < a.max - TOLERANCE;

/**
 * Checks the generated layout against the Prompt 01 contract.
 * Returns a list of human-readable problems; an empty list means the layout is valid.
 */
export function validateLayout(layout: AuditoriumLayout): string[] {
  const problems: string[] = [];
  const { config, interior, rows, seats, seatingZone, aisles, stage, screen } = layout;
  const { seating } = config;

  if (rows.length !== seating.rowLabels.length) {
    problems.push(`Expected ${seating.rowLabels.length} rows, got ${rows.length}.`);
  }
  for (const row of rows) {
    const count = seats.filter((s) => s.rowIndex === row.index).length;
    if (count !== seating.seatsPerRow) problems.push(`Row ${row.label} has ${count} seats, expected ${seating.seatsPerRow}.`);
  }
  const expectedTotal = seating.rowLabels.length * seating.seatsPerRow;
  if (seats.length !== expectedTotal) problems.push(`Expected ${expectedTotal} seats, got ${seats.length}.`);

  const ids = new Set(seats.map((s) => s.id));
  if (ids.size !== seats.length) problems.push('Seat ids are not unique.');

  seats.forEach((seat, index) => {
    if (seat.index !== index) problems.push(`${seat.id}: index ${seat.index} does not match its position ${index}.`);
    if (!/^[A-Z]\d{2}$/.test(seat.id)) problems.push(`${seat.id}: id does not match the "A01" pattern.`);

    const values = [seat.position.x, seat.position.y, seat.position.z, seat.yaw, seat.floorY];
    if (!values.every(Number.isFinite)) problems.push(`${seat.id}: non-finite coordinates.`);

    const row = rows[seat.rowIndex];
    if (seat.floorY !== row.floorY || seat.position.y !== row.floorY) {
      problems.push(`${seat.id}: pivot is not on its row floor (${row.floorY}).`);
    }

    const corners = seatFootprintCorners(layout, seat);
    for (const corner of corners) {
      if (!within(corner.x, seatingZone.x) || !within(corner.z, seatingZone.z)) {
        problems.push(`${seat.id}: footprint leaves the seating zone.`);
        break;
      }
      if (!within(corner.x, interior.x) || !within(corner.z, interior.z)) {
        problems.push(`${seat.id}: footprint leaves the room.`);
        break;
      }
    }

    // Every corner must stand on the same floor level as the pivot: no seat straddles a riser.
    const footprintZ = { min: Math.min(...corners.map((c) => c.z)), max: Math.max(...corners.map((c) => c.z)) };
    if (!within(footprintZ.min, row.treadZ) || !within(footprintZ.max, row.treadZ)) {
      problems.push(`${seat.id}: footprint is not contained in row ${row.label}'s tread.`);
    }
    for (const corner of corners) {
      // Sample just inside the corner so a footprint touching a riser edge is judged by the floor it stands on.
      const insetZ = corner.z + Math.sign(seat.position.z - corner.z) * 1e-4;
      if (Math.abs(floorElevationAt(layout, insetZ) - seat.floorY) > TOLERANCE) {
        problems.push(`${seat.id}: floor under the footprint is not at ${seat.floorY}.`);
        break;
      }
    }

    const footprintX = { min: Math.min(...corners.map((c) => c.x)), max: Math.max(...corners.map((c) => c.x)) };
    for (const aisle of aisles) {
      if (rangesOverlap(footprintX, aisle.x) && rangesOverlap(footprintZ, aisle.z)) {
        problems.push(`${seat.id}: footprint intrudes into the ${aisle.side} aisle.`);
      }
    }

    const eye = seatEyePosition(layout, seat);
    if (!within(eye.x, interior.x) || !within(eye.y, interior.y) || !within(eye.z, interior.z)) {
      problems.push(`${seat.id}: eye position is outside the room.`);
    }
  });

  // Neighbouring footprints may touch but must not overlap.
  for (const row of rows) {
    const rowSeats = seats.filter((s) => s.rowIndex === row.index).sort((a, b) => a.position.x - b.position.x);
    for (let i = 1; i < rowSeats.length; i++) {
      const gap = rowSeats[i].position.x - rowSeats[i - 1].position.x;
      if (gap < config.seat.footprintWidth - TOLERANCE) {
        problems.push(`${rowSeats[i - 1].id}/${rowSeats[i].id}: footprints overlap.`);
      }
    }
  }
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].seatZ - rows[i - 1].seatZ;
    if (gap < config.seat.footprintDepth - TOLERANCE) problems.push(`Rows ${rows[i - 1].label}/${rows[i].label} overlap.`);
    if (rows[i].floorY <= rows[i - 1].floorY) problems.push(`Row ${rows[i].label} is not higher than row ${rows[i - 1].label}.`);
  }

  if (seatingZone.x.max - seatingZone.x.min <= 0) problems.push('The aisles leave no width for seats.');
  for (const aisle of aisles) {
    if (!within(aisle.x.min, interior.x) || !within(aisle.x.max, interior.x)) problems.push(`The ${aisle.side} aisle leaves the room.`);
  }

  // Fixed elements stay inside the room and clear of each other.
  if (!boxWithin(stage, interior)) problems.push('Stage leaves the room.');
  if (!boxWithin(screen.frame, interior)) problems.push('Screen frame leaves the room.');
  if (screen.frame.y.min <= stage.y.max) problems.push('Screen frame intersects the stage.');
  if (rows[0].treadZ.min <= stage.z.max) problems.push('Row A starts inside the stage.');
  if (layout.metrics.frontClearance <= 0) problems.push('No clear floor in front of row A.');
  if (layout.metrics.backClearance <= 0) problems.push('No clear floor behind the last row.');

  const placeholderTop = config.seat.placeholder.backrest.bottomHeight + config.seat.placeholder.backrest.height;
  if (rows[rows.length - 1].floorY + placeholderTop >= interior.y.max) problems.push('Last row seats reach the ceiling.');

  return problems;
}
