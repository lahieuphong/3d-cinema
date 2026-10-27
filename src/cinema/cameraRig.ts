import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  angleBetween,
  createPathCurve,
  lerpOrientation,
  orientationTowards,
  type Orientation,
  type PathCurve,
} from './cameraPath.ts';
import { fovForAspect, type CameraMode, type CameraPose } from './cameraPresets.ts';
import type { AuditoriumConfig } from './config.ts';
import { toRadians, type Vec3 } from './layout.ts';

/** Lens, transition and control limits; the auditorium and the seat inspector each pass their own. */
export type CameraRigSettings = Pick<
  AuditoriumConfig['camera'],
  'fov' | 'maxFov' | 'minHorizontalFov' | 'maxHorizontalFov' | 'near' | 'far' | 'transitionSeconds' | 'orbit' | 'eye'
>;

/**
 * Who writes the camera. Exactly one at a time:
 * - `controls`: OrbitControls (orbit around a target, or look around from a fixed eye point);
 * - `transition`: an animated move to a pose;
 * - `driver`: an external controller (the guided tour or the explore walker).
 * OrbitControls are enabled only while they own the camera, so they can never pull it back.
 */
export type CameraOwner = 'controls' | 'transition' | 'driver';

/** Writes the camera every frame while it owns it. */
export interface CameraDriver {
  /** Returns true while it needs another frame. */
  update(camera: PerspectiveCamera, dt: number): boolean;
}

export interface MoveOptions {
  animate: boolean;
  /** Waypoints between the current position and the pose, for a path around obstacles. */
  via?: readonly Vec3[];
  /** Called once the camera has arrived (not if the move is replaced or interrupted). */
  onArrive?(): void;
}

/** Keeps an orbiting camera (and its target) somewhere valid; returns true if it moved them. */
export type OrbitConstraint = (position: Vector3, target: Vector3) => boolean;

interface Transition {
  curve: PathCurve;
  from: Orientation;
  to: Orientation;
  pose: CameraPose;
  progress: number;
  seconds: number;
  onArrive?: () => void;
}

/**
 * A perspective camera, OrbitControls, at most one transition and at most one driver.
 * Time comes in as clamped frame deltas, so a long pause (hidden tab) never makes anything jump.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Applied after every OrbitControls update in orbit mode; null = free (inspection). */
  constraint: OrbitConstraint | null = null;
  private readonly settings: CameraRigSettings;
  private readonly defaultRotateSpeed: number;
  private transition: Transition | null = null;
  private driver: CameraDriver | null = null;
  private currentMode: CameraMode = 'orbit';

  /** `centre`: the orbit target is kept within `settings.orbit.maxTargetRadius` of this point. */
  constructor(settings: CameraRigSettings, domElement: HTMLElement, centre: Vec3) {
    this.settings = settings;
    this.camera = new PerspectiveCamera(settings.fov, 1, settings.near, settings.far);
    this.camera.rotation.order = 'YXZ';

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = settings.orbit.dampingFactor;
    this.controls.screenSpacePanning = true;
    // Keeps panning from wandering off: the target stays within a sphere around the centre of interest.
    this.controls.cursor.set(centre.x, centre.y, centre.z);
    this.controls.maxTargetRadius = settings.orbit.maxTargetRadius;
    this.defaultRotateSpeed = this.controls.rotateSpeed;
  }

  get owner(): CameraOwner {
    if (this.transition) return 'transition';
    if (this.driver) return 'driver';
    return 'controls';
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** OrbitControls configuration in use: orbit around a target, or look around from an eye point. */
  get mode(): CameraMode {
    return this.currentMode;
  }

  /** Current view direction as yaw and pitch. */
  get orientation(): Orientation {
    const forward = this.camera.getWorldDirection(new Vector3());
    return orientationTowards({ x: 0, y: 0, z: 0 }, forward);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = fovForAspect(this.settings, aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Moves to `pose`, replacing any transition or driver; starts from wherever the camera is now. */
  moveTo(pose: CameraPose, options: MoveOptions | boolean): void {
    const { animate, via = [], onArrive } = typeof options === 'boolean' ? { animate: options } : options;
    this.releaseControls();
    this.driver = null;
    const from = this.orientation;
    const to = orientationTowards(pose.position, pose.lookAt);
    const curve = createPathCurve([this.camera.position.clone(), ...via, pose.position]);
    const seconds = animate ? this.transitionSeconds(curve.length, angleBetween(from, to)) : 0;
    this.transition = { curve, from, to, pose, progress: 0, seconds, onArrive };
    if (seconds === 0) this.finishTransition(this.transition);
  }

  /** Hands the camera to `driver` (tour, explore) until another move, hold or drive. */
  drive(driver: CameraDriver): void {
    this.releaseControls();
    this.transition = null;
    this.driver = driver;
  }

  /** Stops a transition or driver where the camera is and hands it back to OrbitControls. */
  hold(mode: CameraMode, orbitDistance = 5): void {
    this.transition = null;
    this.driver = null;
    const forward = this.camera.getWorldDirection(new Vector3());
    const position = this.camera.position.clone();
    const distance = mode === 'eye' ? this.settings.eye.pivotDistance : orbitDistance;
    this.configureControls(mode, position, position.clone().addScaledVector(forward, distance));
  }

  /** Advances whoever owns the camera by `dt` seconds. Returns true while another frame is needed. */
  update(dt: number): boolean {
    const transition = this.transition;
    if (transition) {
      transition.progress = transition.seconds > 0 ? Math.min(1, transition.progress + dt / transition.seconds) : 1;
      if (transition.progress >= 1) {
        this.finishTransition(transition);
        return false;
      }
      const eased = easeInOutCubic(transition.progress);
      transition.curve.pointAt(eased, this.camera.position);
      this.applyOrientation(lerpOrientation(transition.from, transition.to, eased));
      return true;
    }
    if (this.driver) return this.driver.update(this.camera, dt);

    const changed = this.controls.update();
    if (this.currentMode === 'orbit' && this.constraint?.(this.camera.position, this.controls.target)) {
      this.camera.lookAt(this.controls.target);
      return true;
    }
    return changed;
  }

  /** Writes a yaw/pitch orientation (no roll). */
  applyOrientation({ yaw, pitch }: Orientation): void {
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  dispose(): void {
    this.transition = null;
    this.driver = null;
    this.controls.dispose();
  }

  private transitionSeconds(length: number, angle: number): number {
    const base = this.settings.transitionSeconds;
    return Math.min(base * 2, Math.max(base * 0.7, base * (0.5 + length / 14 + angle / Math.PI / 2)));
  }

  private finishTransition(transition: Transition): void {
    this.transition = null;
    this.camera.position.copy(transition.curve.pointAt(1));
    this.configureControls(transition.pose.mode, this.camera.position.clone(), toVector(transition.pose.lookAt));
    transition.onArrive?.();
  }

  private configureControls(mode: CameraMode, position: Vector3, lookAt: Vector3): void {
    const { camera, controls } = this;
    const { orbit, eye } = this.settings;
    camera.position.copy(position);
    if (mode === 'eye') {
      // Rotate about a point just ahead of the eye: dragging looks around without moving the head.
      const direction = lookAt.clone().sub(position).normalize();
      controls.target.copy(position).addScaledVector(direction, eye.pivotDistance);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      controls.minPolarAngle = toRadians(eye.minPolarAngleDeg);
      controls.maxPolarAngle = toRadians(eye.maxPolarAngleDeg);
      controls.rotateSpeed = eye.rotateSpeed;
    } else {
      controls.target.copy(lookAt);
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.minDistance = orbit.minDistance;
      // Never clamp a preset that is deliberately further out (the fitted inspection views).
      controls.maxDistance = Math.max(orbit.maxDistance, position.distanceTo(lookAt));
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = toRadians(orbit.maxPolarAngleDeg);
      controls.rotateSpeed = this.defaultRotateSpeed;
    }
    this.currentMode = mode;
    camera.lookAt(controls.target);
    controls.enabled = true;
    controls.update();
  }

  /**
   * Takes the camera away from OrbitControls: disables them and clears leftover damping so it
   * cannot drift the camera later. (An undamped update consumes the remaining delta; the pose
   * before it is then restored.)
   */
  private releaseControls(): void {
    const { camera, controls } = this;
    if (!controls.enabled) return;
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    const target = controls.target.clone();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    controls.target.copy(target);
    controls.enabled = false;
  }
}

function toVector(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
