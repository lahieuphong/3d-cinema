/**
 * Single source of truth for every auditorium dimension.
 *
 * Units are metres. +Y is up, X runs across the room, Z runs along it.
 * The origin is the centre of the floor plan with the top of the room floor at Y = 0.
 * The screen is at the -Z end, the back of the room at +Z, and every seat faces -Z.
 *
 * Geometry, seat positions and camera presets are all derived from this object,
 * so changing a value here moves everything that depends on it.
 */
export const AUDITORIUM_CONFIG = {
  room: {
    /** Clear interior width along X. Walls are added outside this volume. */
    width: 12,
    /** Clear interior length along Z. */
    length: 18,
    /** Clear interior height along Y (floor top to ceiling underside). */
    height: 6.5,
    wallThickness: 0.3,
    floorThickness: 0.3,
    ceilingThickness: 0.3,
  },

  seating: {
    /** Front (nearest the screen) to back. */
    rowLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    seatsPerRow: 11,
    /** Seat centre to seat centre along X. */
    seatPitch: 0.78,
    /** Row centre to row centre along Z; also the depth of each row's tread. */
    rowPitch: 1.15,
    /** Floor rise from one row to the next. */
    riserHeight: 0.18,
    /** Floor elevation of row A. 0 means row A stands on the room floor. */
    firstRowElevation: 0,
    /** Flat floor between the back edge of the last row's tread and the back wall. */
    backLandingDepth: 1.2,
    /** Gap between the back of a seat footprint and the riser of the row behind it. */
    seatBackClearance: 0.1,
  },

  seat: {
    /**
     * Plan-view space reserved for one seat, centred on its pivot.
     * The width equals the seat pitch so a row is a continuous band with no gaps.
     */
    footprintWidth: 0.78,
    footprintDepth: 0.75,
    /** Proportions of the Prompt 01 placeholder seat, in seat-local space (pivot at floor, facing -Z). */
    placeholder: {
      cushion: { width: 0.6, depth: 0.5, thickness: 0.12, topHeight: 0.46, frontZ: -0.34 },
      backrest: { width: 0.6, height: 0.66, thickness: 0.09, bottomHeight: 0.4, baseZ: 0.21, reclineDeg: 9 },
      /** Side supports that reach armrest height; one on each side of the cushion. */
      standard: { thickness: 0.06, depth: 0.52, height: 0.64, centerX: 0.335, centerZ: -0.03 },
    },
  },

  /** One aisle against each side wall, running the full length of the seating. */
  aisles: {
    width: 1.5,
    /** Contrasting strip on the edge of every aisle step so level changes read clearly. */
    nosing: { depth: 0.08, height: 0.015, wallInset: 0.02 },
  },

  /** Platform in front of the screen, against the front wall. */
  stage: { width: 9.6, depth: 1.4, height: 0.5 },

  screen: {
    /** Visible picture width; height follows from the aspect ratio. */
    width: 8.5,
    aspectRatio: 16 / 9,
    /** Elevation of the bottom edge of the visible picture above the room floor. */
    bottomElevation: 1.0,
    /** Distance from the front wall's inner face to the screen surface. */
    offsetFromFrontWall: 0.3,
    frame: {
      /** Width of the masking border around the visible picture. */
      border: 0.18,
      depth: 0.1,
      /** How far the frame's front face stands proud of the screen surface. */
      protrusion: 0.03,
      /** How far the screen surface extends behind the frame on every side. */
      overlap: 0.02,
    },
  },

  viewer: {
    /** Assumed seated eye height above the floor the seat stands on. */
    eyeHeight: 1.15,
    /** Eye position behind the footprint centre (towards the backrest), in seat-local space. */
    eyeSetback: 0.15,
  },

  camera: {
    /** Vertical field of view on landscape screens. */
    fov: 50,
    /** Narrow (portrait) screens widen the vertical FOV up to this value... */
    maxFov: 75,
    /** ...trying to keep at least this horizontal FOV. */
    minHorizontalFov: 50,
    near: 0.05,
    far: 200,
    transitionSeconds: 0.9,
    /** Inspection orbit limits. The target is kept within `maxTargetRadius` of the room centre. */
    orbit: {
      minDistance: 0.5,
      maxDistance: 45,
      maxPolarAngleDeg: 88,
      maxTargetRadius: 14,
      dampingFactor: 0.12,
    },
    /** Look-around at a seat: the camera rotates about a point just ahead of the eye. */
    eye: { pivotDistance: 0.05, minPolarAngleDeg: 25, maxPolarAngleDeg: 150, rotateSpeed: 0.45 },
    presets: {
      overview: {
        /** Distance from the back wall's inner face. */
        backWallInset: 0.6,
        /** Height above the back landing floor. */
        heightAboveLanding: 2.8,
        /** Look-at point: 0 = screen centre, 1 = floor at the front edge of row A. */
        targetBlend: 0.5,
      },
      seats: {
        /** Distance in front of the screen surface. */
        distanceFromScreen: 1.0,
        /** Distance below the ceiling. */
        depthBelowCeiling: 1.6,
        /** Look-at point on the stepped floor: 0 = front edge of row A, 1 = back edge of the last row. */
        targetBlend: 0.4,
      },
      side: {
        /** View direction from the target towards the camera (normalised in code); nearly level. */
        direction: { x: 1, y: 0.14, z: -0.12 },
        /** Margin added around the room section when fitting it into the frame. */
        fitMargin: 0.6,
      },
      seatEye: {
        seatId: 'F06',
      },
    },
  },

  render: {
    maxPixelRatio: 2,
    background: 0x16181c,
  },
};

export type AuditoriumConfig = typeof AUDITORIUM_CONFIG;
