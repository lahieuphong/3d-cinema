import type { ToggleablePart } from './architecture.ts';
import type { AuditoriumConfig } from './config.ts';
import {
  floorElevationAt,
  seatEyePosition,
  toDegrees,
  toRadians,
  type AuditoriumLayout,
  type SeatData,
  type Vec3,
} from './layout.ts';

export type CameraPresetId = 'overview' | 'seats' | 'side' | 'seatEye';

/** `orbit`: inspection orbit/zoom/pan around the target. `eye`: look around from a fixed eye point. */
export type CameraMode = 'orbit' | 'eye';

export interface CameraPose {
  position: Vec3;
  /** Where the camera looks. In orbit mode this is also the orbit target. */
  lookAt: Vec3;
  mode: CameraMode;
}

export interface CameraPresetInfo {
  id: CameraPresetId;
  label: string;
  /** Shell parts hidden while this preset is active because they would block its view. */
  hides: ToggleablePart[];
}

export const CAMERA_PRESETS: readonly CameraPresetInfo[] = [
  { id: 'overview', label: 'Tổng quan', hides: [] },
  { id: 'seats', label: 'Nhìn về ghế', hides: [] },
  { id: 'side', label: 'Kiểm tra bên', hides: ['rightWall'] },
  { id: 'seatEye', label: 'Tầm mắt tại ghế', hides: [] },
];

export const DEFAULT_PRESET: CameraPresetId = 'overview';

/** Vertical FOV for a viewport: wider on portrait screens so the subject stays in frame. */
export function fovForAspect(
  { fov, maxFov, minHorizontalFov }: Pick<AuditoriumConfig['camera'], 'fov' | 'maxFov' | 'minHorizontalFov'>,
  aspect: number,
): number {
  const needed = 2 * Math.atan(Math.tan(toRadians(minHorizontalFov) / 2) / aspect);
  return Math.min(maxFov, Math.max(fov, toDegrees(needed)));
}

export function resolveEyeSeat(layout: AuditoriumLayout): SeatData {
  return layout.seatById.get(layout.config.camera.presets.seatEye.seatId) ?? layout.seats[Math.floor(layout.seats.length / 2)];
}

export function computePresetPose(id: CameraPresetId, layout: AuditoriumLayout, aspect: number): CameraPose {
  const { interior, rows, screen, config } = layout;
  const presets = config.camera.presets;
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];

  switch (id) {
    case 'overview': {
      // From the back landing, above head height, looking towards the screen.
      const p = presets.overview;
      const z = interior.z.max - p.backWallInset;
      const frontOfSeating = { x: 0, y: firstRow.floorY, z: firstRow.treadZ.min };
      return {
        position: { x: 0, y: floorElevationAt(layout, z) + p.heightAboveLanding, z },
        lookAt: lerp(screen.center, frontOfSeating, p.targetBlend),
        mode: 'orbit',
      };
    }
    case 'seats': {
      // From just in front of the screen, high up, looking back down the stepped floor so the
      // whole block from row A's front edge to the last row stays in frame.
      const p = presets.seats;
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
    case 'side': {
      // Section view from outside the right wall (which this preset hides), framed to fit the
      // whole room length and height for the current aspect ratio.
      const p = presets.side;
      const dir = normalize(p.direction);
      const target = { x: 0, y: (interior.y.min + interior.y.max) / 2, z: (interior.z.min + interior.z.max) / 2 };
      const halfWidth = (interior.z.max - interior.z.min) / 2 + p.fitMargin;
      const halfHeight = (interior.y.max - interior.y.min) / 2 + p.fitMargin;
      const tanHalfFov = Math.tan(toRadians(fovForAspect(config.camera, aspect)) / 2);
      const fitDistance = Math.max(halfHeight / tanHalfFov, halfWidth / (tanHalfFov * aspect));
      // Fit at the cut plane (the right wall's inner face), not at the room centre line.
      const distance = fitDistance + interior.x.max / dir.x;
      return {
        position: { x: target.x + dir.x * distance, y: target.y + dir.y * distance, z: target.z + dir.z * distance },
        lookAt: target,
        mode: 'orbit',
      };
    }
    case 'seatEye': {
      return { position: seatEyePosition(layout, resolveEyeSeat(layout)), lookAt: { ...screen.center }, mode: 'eye' };
    }
  }
}

/** One-line Vietnamese caption for the active preset. */
export function describePreset(id: CameraPresetId, layout: AuditoriumLayout, pose: CameraPose): string {
  const { config } = layout;
  switch (id) {
    case 'overview':
      return `Tổng quan: camera ở cuối phòng (Z ${formatMetres(pose.position.z)}, cao ${formatMetres(pose.position.y)}), nhìn về màn chiếu.`;
    case 'seats':
      return `Nhìn về ghế: từ phía màn chiếu (Z ${formatMetres(pose.position.z)}), kiểm tra đối xứng và khoảng cách hàng.`;
    case 'side':
      return `Kiểm tra bên: vách phải tạm ẩn để thấy mặt cắt bậc sàn, mỗi hàng nâng ${formatMetres(config.seating.riserHeight)}.`;
    case 'seatEye': {
      const seat = resolveEyeSeat(layout);
      return `Tầm mắt tại ghế ${seat.id}: mắt cao ${formatMetres(config.viewer.eyeHeight)} trên sàn hàng ${seat.rowLabel} (Y ${formatMetres(pose.position.y)}). Kéo để nhìn quanh.`;
    }
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
