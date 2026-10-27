import { AUDITORIUM_CONFIG, type AuditoriumConfig } from './config.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Range {
  min: number;
  max: number;
}

export interface Box {
  x: Range;
  y: Range;
  z: Range;
}

export interface RowData {
  index: number;
  label: string;
  /** Top of this row's tread. */
  floorY: number;
  /** Nominal tread: one row pitch deep. The last row's walkable floor continues onto the back landing. */
  treadZ: Range;
  /** Z of every seat pivot in this row. */
  seatZ: number;
}

export interface SeatData {
  /** Stable identifier, e.g. "A01" … "J11". */
  id: string;
  /** Position in `layout.seats`; also the instance id of the seat meshes. */
  index: number;
  /** 0 = row A (front, nearest the screen). */
  rowIndex: number;
  /** 0 = most negative X. */
  columnIndex: number;
  rowLabel: string;
  /** 1-based, increasing from -X to +X (left to right for someone seated facing the screen). */
  seatNumber: number;
  /** Pivot: centre of the seat footprint, on the floor surface it stands on. */
  position: Vec3;
  /** Rotation about +Y in radians. 0 faces -Z, i.e. towards the screen. */
  yaw: number;
  /** Elevation of the floor under the seat (equal to position.y). */
  floorY: number;
}

/** A horizontal strip of raised floor; the stepped floor geometry is built from these. */
export interface FloorTread {
  rowIndex: number;
  z: Range;
  y: number;
}

export interface Aisle {
  side: 'left' | 'right';
  x: Range;
  z: Range;
}

export interface ScreenLayout {
  /** Centre of the visible picture, on the screen surface. */
  center: Vec3;
  width: number;
  height: number;
  /** Visible picture extents. */
  picture: { x: Range; y: Range };
  /** Bounding box of the frame, including its border and depth. */
  frame: Box;
}

export interface LayoutMetrics {
  /** Edge-to-edge width of the seat block (all footprints). */
  seatBlockWidth: number;
  /** Distance between the centres of the outermost seats. */
  seatCentreSpan: number;
  /** From the edge of the seat block to the side wall, on each side. */
  sideSpace: number;
  /** From the edge of the seat block to the inner edge of the aisle, on each side. */
  aisleBuffer: number;
  /** Combined tread depth of all rows. */
  rowBlockLength: number;
  /** Distance between the first and last row's seat pivots. */
  rowCentreSpan: number;
  lastRowFloorY: number;
  /** Clear floor between the stage front and the front edge of row A's tread. */
  frontClearance: number;
  /** From the back of the last row's seats to the back wall. */
  backClearance: number;
  /** Horizontal distance from the screen surface to the eye in the first / last row. */
  firstRowViewingDistance: number;
  lastRowViewingDistance: number;
  /** Upward angle from a first-row eye to the top of the picture. */
  firstRowScreenTopAngleDeg: number;
}

export interface AuditoriumLayout {
  config: AuditoriumConfig;
  /** Clear room volume. */
  interior: Box;
  /** Interior plus walls, floor slab and ceiling slab. */
  shell: Box;
  rows: RowData[];
  seats: SeatData[];
  seatById: ReadonlyMap<string, SeatData>;
  /** Raised floor strips (rows above the room floor), front to back. */
  treads: FloorTread[];
  /** Floor reserved for the seat block, between the two aisles. */
  seatingZone: { x: Range; z: Range };
  aisles: Aisle[];
  stage: Box;
  screen: ScreenLayout;
  metrics: LayoutMetrics;
}

const EPSILON = 1e-9;

export function createAuditoriumLayout(config: AuditoriumConfig = AUDITORIUM_CONFIG): AuditoriumLayout {
  const { room, seating, seat, aisles: aisleConfig, stage: stageConfig, screen: screenConfig } = config;

  const interior: Box = {
    x: { min: -room.width / 2, max: room.width / 2 },
    y: { min: 0, max: room.height },
    z: { min: -room.length / 2, max: room.length / 2 },
  };
  const shell: Box = {
    x: { min: interior.x.min - room.wallThickness, max: interior.x.max + room.wallThickness },
    y: { min: -room.floorThickness, max: interior.y.max + room.ceilingThickness },
    z: { min: interior.z.min - room.wallThickness, max: interior.z.max + room.wallThickness },
  };

  // Rows are packed against the back landing; whatever is left in front of row A is open floor.
  const rowCount = seating.rowLabels.length;
  const lastTreadBack = interior.z.max - seating.backLandingDepth;
  const firstTreadFront = lastTreadBack - rowCount * seating.rowPitch;
  // Shared by neighbouring rows so one row's back edge is exactly the next row's front edge.
  const treadFront = (index: number) => firstTreadFront + index * seating.rowPitch;
  // Seats sit towards the back of their tread, leaving legroom in front.
  const seatOffsetInTread = seating.rowPitch - seating.seatBackClearance - seat.footprintDepth / 2;

  const rows: RowData[] = seating.rowLabels.map((label, index) => ({
    index,
    label,
    floorY: seating.firstRowElevation + index * seating.riserHeight,
    treadZ: { min: treadFront(index), max: treadFront(index + 1) },
    seatZ: treadFront(index) + seatOffsetInTread,
  }));

  const seats: SeatData[] = [];
  const centreColumn = (seating.seatsPerRow - 1) / 2;
  for (const row of rows) {
    for (let column = 0; column < seating.seatsPerRow; column++) {
      const seatNumber = column + 1;
      seats.push({
        id: `${row.label}${String(seatNumber).padStart(2, '0')}`,
        index: seats.length,
        rowIndex: row.index,
        columnIndex: column,
        rowLabel: row.label,
        seatNumber,
        position: { x: (column - centreColumn) * seating.seatPitch, y: row.floorY, z: row.seatZ },
        yaw: 0,
        floorY: row.floorY,
      });
    }
  }

  // The stepped floor: every row raised above the room floor, the last one running on to the back wall.
  const treads: FloorTread[] = rows
    .filter((row) => row.floorY > EPSILON)
    .map((row) => ({
      rowIndex: row.index,
      z: { min: row.treadZ.min, max: row.index === rowCount - 1 ? interior.z.max : row.treadZ.max },
      y: row.floorY,
    }));

  const seatingZ: Range = { min: firstTreadFront, max: interior.z.max };
  const aisles: Aisle[] = [
    { side: 'left', x: { min: interior.x.min, max: interior.x.min + aisleConfig.width }, z: seatingZ },
    { side: 'right', x: { min: interior.x.max - aisleConfig.width, max: interior.x.max }, z: seatingZ },
  ];
  const seatingZone = { x: { min: aisles[0].x.max, max: aisles[1].x.min }, z: seatingZ };

  const stage: Box = {
    x: { min: -stageConfig.width / 2, max: stageConfig.width / 2 },
    y: { min: 0, max: stageConfig.height },
    z: { min: interior.z.min, max: interior.z.min + stageConfig.depth },
  };

  const screenHeight = screenConfig.width / screenConfig.aspectRatio;
  const screenZ = interior.z.min + screenConfig.offsetFromFrontWall;
  const { frame } = screenConfig;
  const picture = {
    x: { min: -screenConfig.width / 2, max: screenConfig.width / 2 },
    y: { min: screenConfig.bottomElevation, max: screenConfig.bottomElevation + screenHeight },
  };
  const screen: ScreenLayout = {
    center: { x: 0, y: (picture.y.min + picture.y.max) / 2, z: screenZ },
    width: screenConfig.width,
    height: screenHeight,
    picture,
    frame: {
      x: { min: picture.x.min - frame.border, max: picture.x.max + frame.border },
      y: { min: picture.y.min - frame.border, max: picture.y.max + frame.border },
      z: { min: screenZ + frame.protrusion - frame.depth, max: screenZ + frame.protrusion },
    },
  };

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const firstRowEyeZ = firstRow.seatZ + config.viewer.eyeSetback;
  const firstRowEyeY = firstRow.floorY + config.viewer.eyeHeight;
  const firstRowViewingDistance = firstRowEyeZ - screenZ;
  const seatBlockWidth = seating.seatsPerRow * seat.footprintWidth;

  const metrics: LayoutMetrics = {
    seatBlockWidth,
    seatCentreSpan: (seating.seatsPerRow - 1) * seating.seatPitch,
    sideSpace: interior.x.max - seatBlockWidth / 2,
    aisleBuffer: seatingZone.x.max - seatBlockWidth / 2,
    rowBlockLength: rowCount * seating.rowPitch,
    rowCentreSpan: lastRow.seatZ - firstRow.seatZ,
    lastRowFloorY: lastRow.floorY,
    frontClearance: firstRow.treadZ.min - stage.z.max,
    backClearance: interior.z.max - (lastRow.seatZ + seat.footprintDepth / 2),
    firstRowViewingDistance,
    lastRowViewingDistance: lastRow.seatZ + config.viewer.eyeSetback - screenZ,
    firstRowScreenTopAngleDeg: toDegrees(Math.atan2(picture.y.max - firstRowEyeY, firstRowViewingDistance)),
  };

  return {
    config,
    interior,
    shell,
    rows,
    seats,
    seatById: new Map(seats.map((s) => [s.id, s])),
    treads,
    seatingZone,
    aisles,
    stage,
    screen,
    metrics,
  };
}

/** Elevation of the walkable floor (room floor or stepped tiers) at a given Z. */
export function floorElevationAt(layout: AuditoriumLayout, z: number): number {
  for (const tread of layout.treads) {
    if (z >= tread.z.min && z < tread.z.max) return tread.y;
  }
  const last = layout.treads[layout.treads.length - 1];
  if (last && z === last.z.max) return last.y;
  return 0;
}

/** World-space eye position for someone seated in `seat`. */
export function seatEyePosition(layout: AuditoriumLayout, seat: SeatData): Vec3 {
  const { eyeHeight, eyeSetback } = layout.config.viewer;
  // Seat-local +Z (towards the backrest) rotated by the seat's yaw.
  return {
    x: seat.position.x + Math.sin(seat.yaw) * eyeSetback,
    y: seat.floorY + eyeHeight,
    z: seat.position.z + Math.cos(seat.yaw) * eyeSetback,
  };
}

/** The four plan-view corners of a seat footprint, in world space. */
export function seatFootprintCorners(layout: AuditoriumLayout, seat: SeatData): Array<{ x: number; z: number }> {
  const halfW = layout.config.seat.footprintWidth / 2;
  const halfD = layout.config.seat.footprintDepth / 2;
  const cos = Math.cos(seat.yaw);
  const sin = Math.sin(seat.yaw);
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([lx, lz]) => ({
    // Rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos.
    x: seat.position.x + lx * cos + lz * sin,
    z: seat.position.z - lx * sin + lz * cos,
  }));
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
