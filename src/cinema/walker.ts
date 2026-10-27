import { bodyFits, moveBody, type BodySettings, type CollisionWorld } from './collision.ts';
import { toRadians, type Vec3 } from './layout.ts';
import type { Orientation } from './cameraPath.ts';

/** Explore-mode settings (config.camera.explore). */
export interface WalkerSettings extends BodySettings {
  /** Metres per second at full stick or with a movement key held. */
  walkSpeed: number;
  /** Time constant of the eye following the floor up and down steps. */
  eyeSmoothingSeconds: number;
  minPitchDeg: number;
  maxPitchDeg: number;
}

export interface WalkerState {
  x: number;
  z: number;
  /** Floor under the body. */
  floorY: number;
  /** Camera height; eases towards floorY + eyeHeight. */
  eyeY: number;
  yaw: number;
  pitch: number;
}

/** Desired movement relative to the view: forward/back and right/left, each in [−1, 1]. */
export interface MoveIntent {
  forward: number;
  right: number;
}

/**
 * Advances the walker by `dt` seconds (the caller clamps large gaps, e.g. after returning to the
 * tab). Movement is horizontal along the view's yaw, at most `walkSpeed` (diagonals are not
 * faster), and goes through `moveBody`, which never skips a collider.
 * Returns the new state and whether anything is still moving (input held or the eye settling).
 */
export function stepWalker(
  world: CollisionWorld,
  settings: WalkerSettings,
  state: WalkerState,
  intent: MoveIntent,
  dt: number,
  instantEye = false,
): { state: WalkerState; active: boolean } {
  let { forward, right } = intent;
  const magnitude = Math.hypot(forward, right);
  if (magnitude > 1) {
    forward /= magnitude;
    right /= magnitude;
  }
  const distance = settings.walkSpeed * dt;
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  // View forward is (−sin yaw, 0, −cos yaw); right is (cos yaw, 0, −sin yaw).
  const dx = (-sin * forward + cos * right) * distance;
  const dz = (-cos * forward - sin * right) * distance;
  const moved = moveBody(world, settings, state, dx, dz);

  const targetEye = moved.floorY + settings.eyeHeight;
  let eyeY = state.eyeY;
  if (instantEye || settings.eyeSmoothingSeconds <= 0) eyeY = targetEye;
  else eyeY += (targetEye - eyeY) * (1 - Math.exp(-dt / settings.eyeSmoothingSeconds));
  // Settle within a millimetre so the loop can stop (about 0.6 s after an aisle step).
  if (Math.abs(targetEye - eyeY) < 1e-3) eyeY = targetEye;

  return {
    state: { ...state, x: moved.x, z: moved.z, floorY: moved.floorY, eyeY },
    active: magnitude > 0 || eyeY !== targetEye,
  };
}

/** Turns the view by the given amounts (radians), keeping pitch within limits; never rolls. */
export function turnWalker(settings: WalkerSettings, state: WalkerState, yawBy: number, pitchBy: number): WalkerState {
  return {
    ...state,
    yaw: wrapAngle(state.yaw + yawBy),
    pitch: clampPitch(settings, state.pitch + pitchBy),
  };
}

export function clampPitch(settings: WalkerSettings, pitch: number): number {
  return Math.min(toRadians(settings.maxPitchDeg), Math.max(toRadians(settings.minPitchDeg), pitch));
}

/** A named place where exploring can start when the camera is not somewhere a person can stand. */
export interface StartPoint {
  id: string;
  label: string;
  x: number;
  z: number;
}

export interface WalkStart {
  state: WalkerState;
  /** Set when the camera could not stand where it was and is taken to this start point instead. */
  relocatedTo: StartPoint | null;
}

/**
 * Where exploring starts from the current camera: right below it if a person fits there, otherwise
 * at the nearest start point that fits. The view keeps its heading (pitch clamped, or level after a
 * move) so the user is not turned around.
 */
export function chooseWalkStart(
  world: CollisionWorld,
  settings: WalkerSettings,
  camera: Vec3,
  view: Orientation,
  startPoints: readonly StartPoint[],
): WalkStart {
  const floorHere = world.floorAt(camera.x, camera.z);
  const standsAbove = camera.y > floorHere + settings.maxStep;
  if (standsAbove && bodyFits(world, settings, camera.x, camera.z, floorHere)) {
    return {
      state: { x: camera.x, z: camera.z, floorY: floorHere, eyeY: floorHere + settings.eyeHeight, yaw: view.yaw, pitch: clampPitch(settings, view.pitch) },
      relocatedTo: null,
    };
  }
  const candidates = startPoints
    .map((point) => ({ point, floorY: world.floorAt(point.x, point.z), distance: Math.hypot(point.x - camera.x, point.z - camera.z) }))
    .filter(({ point, floorY }) => bodyFits(world, settings, point.x, point.z, floorY))
    .sort((a, b) => a.distance - b.distance);
  if (candidates.length === 0) throw new Error('No explore start point fits in the room');
  const { point, floorY } = candidates[0];
  return {
    state: { x: point.x, z: point.z, floorY, eyeY: floorY + settings.eyeHeight, yaw: view.yaw, pitch: 0 },
    relocatedTo: point,
  };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
