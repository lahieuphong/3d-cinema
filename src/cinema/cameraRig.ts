import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fovForAspect, type CameraMode, type CameraPose } from './cameraPresets.ts';
import type { AuditoriumConfig } from './config.ts';
import { toRadians, type Vec3 } from './layout.ts';

/** Lens, transition and control limits; the auditorium and the seat inspector each pass their own. */
export type CameraRigSettings = Pick<
  AuditoriumConfig['camera'],
  'fov' | 'maxFov' | 'minHorizontalFov' | 'near' | 'far' | 'transitionSeconds' | 'orbit' | 'eye'
>;

interface Transition {
  fromPosition: Vector3;
  fromLookAt: Vector3;
  toPosition: Vector3;
  toLookAt: Vector3;
  pose: CameraPose;
  /** Set from the first animation frame's timestamp. */
  startTime: number | null;
  durationMs: number;
}

/**
 * Inspection camera: a perspective camera, OrbitControls, and at most one preset transition.
 *
 * While a transition runs, the controls are disabled and never updated, so they cannot pull the
 * camera back; when it ends, the controls' target, mode and limits are set for the new pose in one go.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly settings: CameraRigSettings;
  private readonly defaultRotateSpeed: number;
  private readonly lookAt = new Vector3();
  private transition: Transition | null = null;
  private currentMode: CameraMode = 'orbit';

  /** `centre`: the orbit target is kept within `settings.orbit.maxTargetRadius` of this point. */
  constructor(settings: CameraRigSettings, domElement: HTMLElement, centre: Vec3) {
    this.settings = settings;
    this.camera = new PerspectiveCamera(settings.fov, 1, settings.near, settings.far);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = settings.orbit.dampingFactor;
    this.controls.screenSpacePanning = true;
    // Keeps panning from wandering off: the target stays within a sphere around the centre of interest.
    this.controls.cursor.set(centre.x, centre.y, centre.z);
    this.controls.maxTargetRadius = settings.orbit.maxTargetRadius;
    this.defaultRotateSpeed = this.controls.rotateSpeed;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  get mode(): CameraMode {
    return this.currentMode;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = fovForAspect(this.settings, aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Starts moving to `pose`, replacing any transition already in progress. */
  moveTo(pose: CameraPose, animate: boolean): void {
    // Mid-transition the controls are idle; otherwise drop any leftover orbit inertia first.
    if (!this.transition) this.stopInertia();

    // Start looking along the current view direction at the same distance the new pose uses,
    // so the look-at point glides instead of snapping to the old orbit target.
    const toPosition = toVector(pose.position);
    const toLookAt = toVector(pose.lookAt);
    const forward = this.camera.getWorldDirection(new Vector3());
    this.transition = {
      fromPosition: this.camera.position.clone(),
      fromLookAt: this.camera.position.clone().addScaledVector(forward, toPosition.distanceTo(toLookAt)),
      toPosition,
      toLookAt,
      pose,
      startTime: null,
      durationMs: animate ? this.settings.transitionSeconds * 1000 : 0,
    };
    this.controls.enabled = false;
    if (!animate) this.finishTransition(this.transition);
  }

  /** Advances the transition or the orbit damping. Returns true while another frame is needed. */
  update(time: number): boolean {
    const transition = this.transition;
    if (!transition) return this.controls.update();

    transition.startTime ??= time;
    const progress = transition.durationMs > 0 ? Math.min(1, (time - transition.startTime) / transition.durationMs) : 1;
    if (progress >= 1) {
      this.finishTransition(transition);
      return false;
    }
    const eased = easeInOutCubic(progress);
    this.camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
    this.lookAt.lerpVectors(transition.fromLookAt, transition.toLookAt, eased);
    this.camera.lookAt(this.lookAt);
    return true;
  }

  dispose(): void {
    this.transition = null;
    this.controls.dispose();
  }

  private finishTransition(transition: Transition): void {
    this.transition = null;
    const { camera, controls } = this;
    const { orbit, eye } = this.settings;
    camera.position.copy(transition.toPosition);

    if (transition.pose.mode === 'eye') {
      // Rotate about a point just ahead of the eye: dragging looks around without moving the head.
      const direction = transition.toLookAt.clone().sub(transition.toPosition).normalize();
      controls.target.copy(transition.toPosition).addScaledVector(direction, eye.pivotDistance);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      controls.minPolarAngle = toRadians(eye.minPolarAngleDeg);
      controls.maxPolarAngle = toRadians(eye.maxPolarAngleDeg);
      controls.rotateSpeed = eye.rotateSpeed;
    } else {
      controls.target.copy(transition.toLookAt);
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.minDistance = orbit.minDistance;
      // Never clamp a preset that is deliberately further out (the fitted side view on narrow screens).
      controls.maxDistance = Math.max(orbit.maxDistance, camera.position.distanceTo(controls.target));
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = toRadians(orbit.maxPolarAngleDeg);
      controls.rotateSpeed = this.defaultRotateSpeed;
    }

    this.currentMode = transition.pose.mode;
    camera.lookAt(controls.target);
    controls.enabled = true;
    controls.update();
  }

  /**
   * Clears residual damping so it cannot drift the camera after a preset is applied.
   * An undamped update consumes the remaining delta; the pose before it is then restored.
   */
  private stopInertia(): void {
    const { camera, controls } = this;
    const position = camera.position.clone();
    const target = controls.target.clone();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    camera.position.copy(position);
    controls.target.copy(target);
    camera.lookAt(target);
  }
}

function toVector(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
