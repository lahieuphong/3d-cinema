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
    /**
     * Fit-out zone behind the finished face of each side wall. The finished face (acoustic panels)
     * stays on the clear width above; the structural wall sits this much further out, leaving room
     * for the panels and a recessed band that holds the stair handrail outside the aisle.
     */
    sideLiningDepth: 0.12,
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
    /**
     * Procedural cinema seat (see seats.ts), in seat-local space: pivot at the footprint centre on
     * the floor, +Y up, the seat faces -Z. Heights are above the seat's own floor.
     */
    model: {
      armrest: {
        /** Seat centre line to each armrest centre line. */
        centerX: 0.33,
        width: 0.08,
        height: 0.055,
        topHeight: 0.655,
        frontZ: -0.3,
        backZ: 0.21,
        cornerRadius: 0.024,
      },
      /** Round cup holder set into the front of one armrest, flush with its top. */
      cupHolder: {
        /** 1 = right-hand armrest (+X) for someone seated facing the screen, -1 = left. */
        side: 1,
        centerZ: -0.255,
        outerRadius: 0.048,
        innerRadius: 0.038,
        /** From the rim down to the bottom of the well. */
        depth: 0.085,
        /** Height of the outer wall below the rim. */
        wallHeight: 0.1,
      },
      /** Side panel under each armrest, from the floor up into the armrest. */
      standard: {
        thickness: 0.05,
        footFrontZ: -0.25,
        footBackZ: 0.21,
        /** Kept behind the cup holder's outer wall so the panel never shows inside the well. */
        topFrontZ: -0.2,
        topBackZ: 0.19,
        topCornerRadius: 0.03,
        bevel: 0.008,
      },
      footPlate: { width: 0.08, height: 0.012 },
      /** Rigid pan tucked under the cushion. Tilted with the cushion. */
      seatPan: { width: 0.44, height: 0.04, depth: 0.4, topHeight: 0.345, centerZ: -0.1, cornerRadius: 0.012 },
      /** Pivot hubs joining the seat pan to the standards, axis along X. */
      seatHub: { radius: 0.03, centerY: 0.322, centerZ: -0.06, innerX: 0.2 },
      cushion: {
        width: 0.5,
        depth: 0.5,
        thickness: 0.11,
        centerZ: -0.11,
        /** Front edge raised by this angle (seat pan tilt). */
        tiltDeg: 4,
        /** How far the cushion sinks into the pan. */
        embed: 0.008,
      },
      backrest: {
        /** The backrest hinges about a horizontal line at this height and Z. */
        hingeHeight: 0.4,
        hingeZ: 0.195,
        /** Lean of the backrest towards +Z (backwards). */
        reclineDeg: 10,
        /** Rear cover: a tapered panel with rounded edges, wider at the shoulders. */
        shell: {
          bottomWidth: 0.54,
          topWidth: 0.58,
          height: 0.7,
          thickness: 0.055,
          bevel: 0.015,
          bottomCornerRadius: 0.05,
          topCornerRadius: 0.14,
        },
        /** Graphite cover over the lower back of the shell. Y is measured up the backrest from the hinge. */
        backPanel: { width: 0.5, height: 0.16, centerY: 0.1, thickness: 0.012, cornerRadius: 0.04, bevel: 0.004 },
        /** Upholstered pads on the front of the shell, bottom to top. */
        pads: [
          { name: 'lumbar', width: 0.48, height: 0.27, centerY: 0.155, thickness: 0.09 },
          { name: 'upper-back', width: 0.5, height: 0.24, centerY: 0.415, thickness: 0.085 },
          { name: 'headrest', width: 0.4, height: 0.15, centerY: 0.61, thickness: 0.1 },
        ],
        /** How far each pad sinks into the shell. */
        padEmbed: 0.01,
      },
      /** Brackets joining the bottom of the backrest to the standards. */
      hingeBracket: { width: 0.05, height: 0.11, depth: 0.09, centerX: 0.29, centerY: 0.45, centerZ: 0.21, cornerRadius: 0.01 },
      /**
       * Cushion shape (superellipsoid exponents): `outline` shapes the plan corners (small = squarer),
       * `profile` the edge across the thickness (1 = round, small = flatter face with a tighter edge),
       * `crown` (m) domes the visible face.
       */
      padShape: { outline: 0.3, profile: 0.62, crown: 0.012, radialSegments: 24, ringSegments: 7 },
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

  /** Interior fit-out (Prompt 03). Positions are derived from the room, rows and these values. */
  interior: {
    /** Acoustic panels on both side walls, in bays of one row pitch so joints line up with the risers. */
    wallPanels: {
      /** Front edge of the first bay (just behind the curtains); bays run from here to the back wall. */
      firstBayZ: -8.3,
      bayWidth: 1.15,
      joint: 0.03,
      thickness: 0.06,
      bevel: 0.006,
      /** Panels start this far above the stair pitch line; below is a recessed band for the handrail. */
      dadoHeight: 1.2,
      /** Horizontal joint between lower and upper panels. */
      splitY: 4.55,
      topY: 6.17,
      /** Bay indices (from the front) that hold the door or a speaker instead of panels. */
      doorBay: 1,
      speakerBays: [0, 6, 9, 12],
      /** Champagne inlays in the joints either side of door and speaker bays. */
      trim: { width: 0.03, recess: 0.005, depth: 0.05 },
    },
    skirting: { height: 0.1, thickness: 0.015 },
    ceiling: {
      /** Soffit along each side wall with a recessed light slot on its inner edge. */
      bulkhead: { width: 0.67, depth: 0.28, firstZ: -8.3, lipWidth: 0.1, slotWidth: 0.05 },
      /** Shallow cross beams with a light slot down the middle; none over the screen end. */
      beams: { firstZ: -6, pitch: 2.3, count: 7, width: 0.3, depth: 0.2, slotWidth: 0.06 },
      /** Emissive strips sit this far up inside their slot, so the line still shows at a glance angle. */
      slotRecess: 0.02,
      stripThickness: 0.01,
    },
    curtains: {
      innerX: 4.85,
      outerX: 5.95,
      centerZ: -8.72,
      folds: 5,
      foldDepth: 0.2,
      /** Folds are this much deeper at the hem than at the top. */
      hemFlare: 0.35,
      thickness: 0.02,
      bottomY: 0.01,
      topY: 6.14,
      segmentsPerFold: 12,
      rows: 10,
      /** Box over each curtain hiding its track, against the front wall and ceiling. */
      valance: { innerX: 4.78, bottomY: 6.12, frontZ: -8.55 },
    },
    speakers: {
      width: 0.36,
      height: 0.56,
      depth: 0.26,
      centerY: 4.25,
      /** Aimed down at the seating. */
      tiltDeg: 8,
      /** The front pair (first bay) also turns towards the audience. */
      toeInDeg: 20,
      /** Wall plate to cabinet back, before any toe-in clearance is added. */
      standoff: 0.06,
      woofer: { radius: 0.11, offsetY: -0.08 },
      tweeter: { radius: 0.028, offsetY: 0.17 },
      /** Rear pair on the back wall, either side of the centre line. */
      rearX: 3.6,
    },
    handrail: {
      /** Top of the rail above the stair pitch line. */
      height: 0.9,
      radius: 0.022,
      /** Rail centre line, measured from the finished wall face into the recess. */
      inset: 0.06,
      postRadius: 0.016,
      /** Horizontal run beyond the bottom and top nosings before the rail returns into the wall. */
      extension: 0.3,
      bendRadius: 0.15,
      returnBendRadius: 0.04,
      flange: { radius: 0.035, height: 0.008 },
    },
    door: {
      width: 0.95,
      height: 2.15,
      frame: 0.06,
      leafThickness: 0.045,
      /** Leaf face behind the structural wall face. */
      leafSetback: 0.08,
      pushBar: { y: 1.0, length: 0.72, radius: 0.016, standoff: 0.07 },
      thresholdHeight: 0.012,
    },
    exitSign: { width: 0.38, height: 0.19, depth: 0.08, gapAboveDoor: 0.1 },
    projector: {
      /** Lens centre: height, and distance in front of the back wall. */
      lensY: 5.55,
      lensDistanceFromWall: 1.0,
      body: { width: 0.62, height: 0.3, depth: 0.72, cornerRadius: 0.03 },
      lens: { radius: 0.075, length: 0.1 },
    },
  },

  /** Development seat inspector at /cinema?inspect=seat. */
  inspector: {
    /** Seats shown side by side in cluster mode, at the auditorium's seat pitch. */
    clusterSize: 3,
    floorRadius: 3,
    gridSize: 4,
    gridDivisions: 40,
    background: 0x1b1d22,
    camera: {
      fov: 35,
      maxFov: 60,
      minHorizontalFov: 35,
      near: 0.01,
      far: 50,
      transitionSeconds: 0.6,
      orbit: { minDistance: 0.4, maxDistance: 8, maxPolarAngleDeg: 89, maxTargetRadius: 1.5, dampingFactor: 0.12 },
      eye: { pivotDistance: 0.05, minPolarAngleDeg: 25, maxPolarAngleDeg: 150, rotateSpeed: 0.45 },
      /** Directions from the seat towards the camera (normalised in code). */
      views: {
        front: { x: -0.8, y: 0.5, z: -1 },
        side: { x: 1, y: 0.12, z: 0 },
        back: { x: 0.8, y: 0.55, z: 1 },
        top: { x: 0, y: 1, z: -0.45 },
        cup: { x: 0.45, y: 1, z: -0.8 },
      },
      /** Frame margin around the seat's bounding sphere. */
      fitMargin: 1.12,
      /** Fixed distance for the cup holder close-up. */
      cupDistance: 0.42,
    },
  },
};

export type AuditoriumConfig = typeof AUDITORIUM_CONFIG;
