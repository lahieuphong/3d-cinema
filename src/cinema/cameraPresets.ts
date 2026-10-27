import type { ToggleablePart } from './architecture.ts';
import type { AuditoriumConfig } from './config.ts';
import { floorElevationAt, toDegrees, toRadians, type AuditoriumLayout, type SeatData, type Vec3 } from './layout.ts';
import { seatViewPose } from './seatView.ts';

export type CameraPresetId = 'overview' | 'seats' | 'seatEye' | 'side' | 'plan';

/** `orbit`: orbit/zoom/pan around the target. `eye`: look around from a fixed eye point. */
export type CameraMode = 'orbit' | 'eye';

/**
 * `experience`: a place a visitor could be, inside the room and clear of everything; orbiting
 * stays inside the room. `inspection`: technical views that may cut walls away or sit outside.
 */
export type CameraSpace = 'experience' | 'inspection';

export interface CameraPose {
  position: Vec3;
  /** Where the camera looks. In orbit mode this is also the orbit target. */
  lookAt: Vec3;
  mode: CameraMode;
}

export interface CameraPresetInfo {
  id: CameraPresetId;
  label: string;
  space: CameraSpace;
  /** Shell parts hidden while this preset is active because they would block its view. */
  hides: ToggleablePart[];
}

export const CAMERA_PRESETS: readonly CameraPresetInfo[] = [
  { id: 'overview', label: 'Tổng quan', space: 'experience', hides: [] },
  { id: 'seats', label: 'Nhìn về ghế', space: 'experience', hides: [] },
  { id: 'seatEye', label: 'Ghế F06', space: 'experience', hides: [] },
  { id: 'side', label: 'Mặt cắt bên', space: 'inspection', hides: ['rightWall'] },
  { id: 'plan', label: 'Mặt bằng', space: 'inspection', hides: ['ceiling'] },
];

export const DEFAULT_PRESET: CameraPresetId = 'overview';

export function presetInfo(id: CameraPresetId): CameraPresetInfo {
  return CAMERA_PRESETS.find((preset) => preset.id === id)!;
}

type LensSettings = Pick<AuditoriumConfig['camera'], 'fov' | 'maxFov' | 'minHorizontalFov' | 'maxHorizontalFov'>;

/**
 * Vertical FOV (degrees) for a viewport: `fov` normally; wider on portrait screens to keep at
 * least `minHorizontalFov`, but never past `maxFov` (wider distorts the room); narrower on very
 * wide screens so the horizontal FOV stays under `maxHorizontalFov`.
 */
export function fovForAspect({ fov, maxFov, minHorizontalFov, maxHorizontalFov }: LensSettings, aspect: number): number {
  const horizontal = horizontalFov(fov, aspect);
  if (horizontal < minHorizontalFov) return Math.min(maxFov, verticalFov(minHorizontalFov, aspect));
  if (horizontal > maxHorizontalFov) return verticalFov(maxHorizontalFov, aspect);
  return fov;
}

export function horizontalFov(verticalDeg: number, aspect: number): number {
  return toDegrees(2 * Math.atan(Math.tan(toRadians(verticalDeg) / 2) * aspect));
}

function verticalFov(horizontalDeg: number, aspect: number): number {
  return toDegrees(2 * Math.atan(Math.tan(toRadians(horizontalDeg) / 2) / aspect));
}

export function resolveEyeSeat(layout: AuditoriumLayout): SeatData {
  return layout.seatById.get(layout.config.camera.presets.seatEye.seatId) ?? layout.seats[Math.floor(layout.seats.length / 2)];
}

/**
 * Pose for a preset, framed for the canvas aspect ratio and the FOV that aspect gets. Nothing in
 * the room moves to make a view fit; on narrow screens the views change composition instead.
 */
export function computePresetPose(id: CameraPresetId, layout: AuditoriumLayout, aspect: number): CameraPose {
  const { interior, rows, screen, config, stage } = layout;
  const presets = config.camera.presets;
  const fov = toRadians(fovForAspect(config.camera, aspect));
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];

  switch (id) {
    case 'overview': {
      // From above the back landing, looking at the screen. The pitch puts the top of the screen
      // frame a fixed share of the FOV below the top edge, so the rest of the frame (more of it on
      // tall screens) shows the seats and aisles instead of ceiling.
      const p = presets.overview;
      const z = interior.z.max - p.backWallInset;
      const x = aspect < 1 ? p.portraitOffsetX : 0;
      const position = { x, y: floorElevationAt(layout, z) + p.heightAboveLanding, z };
      const distance = Math.hypot(z - screen.frame.z.max, x);
      const topElevation = Math.atan2(screen.frame.y.max - position.y, distance);
      const pitch = topElevation + p.topMargin * fov - fov / 2;
      return { position, lookAt: { x: 0, y: position.y + Math.tan(pitch) * distance, z: screen.frame.z.max }, mode: 'orbit' };
    }
    case 'seats': {
      const p = presets.seats;
      if (aspect >= p.diagonalBelowAspect) {
        // From just in front of the screen, high up, looking back down the stepped floor so the
        // whole block from row A's front edge to the last row stays in frame.
        return {
          position: { x: 0, y: interior.y.max - p.depthBelowCeiling, z: screen.center.z + p.distanceFromScreen },
          lookAt: lerp(
            { x: 0, y: firstRow.floorY, z: firstRow.treadZ.min },
            { x: 0, y: lastRow.floorY, z: lastRow.treadZ.max },
            p.targetBlend,
          ),
          mode: 'orbit',
        };
      }
      // Narrow screens cannot show the 8.6 m wide block head-on from inside the room. Look along
      // its diagonal instead, from high in the front right corner towards the back left, so the
      // rows recede across the tall frame; the rest is reached by orbiting or exploring.
      const d = p.diagonal;
      return {
        position: { x: interior.x.max - d.wallInset, y: interior.y.max - d.depthBelowCeiling, z: stage.z.max + d.stageInset },
        lookAt: {
          x: layout.seatingZone.x.min * d.targetAcross,
          y: rows[Math.floor(rows.length / 2)].floorY,
          z: lerp({ x: 0, y: 0, z: firstRow.seatZ }, { x: 0, y: 0, z: lastRow.seatZ }, d.targetAlong).z,
        },
        mode: 'orbit',
      };
    }
    case 'seatEye':
      return seatViewPose(layout, resolveEyeSeat(layout));
    case 'side': {
      // Section view from outside the right wall (which this preset hides), framed to fit the
      // whole room length and height for the current aspect ratio.
      const p = presets.side;
      const dir = normalize(p.direction);
      const target = { x: 0, y: (interior.y.min + interior.y.max) / 2, z: (interior.z.min + interior.z.max) / 2 };
      const halfWidth = (interior.z.max - interior.z.min) / 2 + p.fitMargin;
      const halfHeight = (interior.y.max - interior.y.min) / 2 + p.fitMargin;
      const fitDistance = fitDistanceFor(halfWidth, halfHeight, fov, aspect);
      // Fit at the cut plane (the right wall's inner face), not at the room centre line.
      const distance = fitDistance + interior.x.max / dir.x;
      return {
        position: { x: target.x + dir.x * distance, y: target.y + dir.y * distance, z: target.z + dir.z * distance },
        lookAt: target,
        mode: 'orbit',
      };
    }
    case 'plan': {
      // From above with the ceiling hidden. The room's long axis runs up the frame on portrait
      // screens (screen at the top) and across on landscape ones (screen on the left); the camera is
      // tilted a hair off vertical so "up" on screen is well defined for the orbit controls.
      const p = presets.plan;
      const portrait = aspect < 1;
      const across = (interior.x.max - interior.x.min) / 2 + p.fitMargin;
      const along = (interior.z.max - interior.z.min) / 2 + p.fitMargin;
      const distance = portrait ? fitDistanceFor(across, along, fov, aspect) : fitDistanceFor(along, across, fov, aspect);
      const target = { x: 0, y: p.targetHeight, z: 0 };
      const tilt = Math.tan(toRadians(p.tiltDeg)) * distance;
      return {
        position: portrait ? { x: 0, y: target.y + distance, z: tilt } : { x: -tilt, y: target.y + distance, z: 0 },
        lookAt: target,
        mode: 'orbit',
      };
    }
  }
}

/** Distance at which a rectangle of half-size (halfWidth × halfHeight) facing the camera fills the frame. */
function fitDistanceFor(halfWidth: number, halfHeight: number, verticalFovRad: number, aspect: number): number {
  const tanHalf = Math.tan(verticalFovRad / 2);
  return Math.max(halfHeight / tanHalf, halfWidth / (tanHalf * aspect));
}

/** One-line Vietnamese caption for the active preset. */
export function describePreset(id: CameraPresetId, layout: AuditoriumLayout, pose: CameraPose): string {
  const { config } = layout;
  switch (id) {
    case 'overview':
      return `Tổng quan: từ cuối phòng (cao ${formatMetres(pose.position.y)}), nhìn về màn chiếu. Kéo để xoay quanh.`;
    case 'seats':
      return 'Nhìn về ghế: từ phía màn chiếu nhìn lại các hàng ghế. Kéo để xoay quanh.';
    case 'seatEye': {
      const seat = resolveEyeSeat(layout);
      return `Ghế ${seat.id}: mắt cao ${formatMetres(config.viewer.eyeHeight)} trên sàn hàng ${seat.rowLabel}. Kéo để nhìn quanh.`;
    }
    case 'side':
      return `Kiểm tra – mặt cắt bên: vách phải tạm ẩn để thấy bậc sàn, mỗi hàng nâng ${formatMetres(config.seating.riserHeight)}.`;
    case 'plan':
      return 'Kiểm tra – mặt bằng: trần tạm ẩn, nhìn từ trên xuống toàn bộ ghế và lối đi.';
  }
}

const metreFormat = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMetres(value: number): string {
  return `${metreFormat.format(value)} m`;
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
