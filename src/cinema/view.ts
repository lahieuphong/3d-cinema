import { type Mesh, type Object3D, Scene } from 'three';
import { buildArchitecture, INTERIOR_MATERIALS, type Architecture, type ToggleablePart } from './architecture.ts';
import { CameraRig } from './cameraRig.ts';
import { computePresetPose, type CameraMode, type CameraPose, type CameraPresetId } from './cameraPresets.ts';
import type { AuditoriumLayout, Vec3 } from './layout.ts';
import { createLighting, type Lighting } from './lighting.ts';
import {
  createBlockoutMaterials,
  createSeatMaterials,
  disposeMaterials,
  type BlockoutMaterials,
  type SeatMaterials,
} from './materials.ts';
import { prefersReducedMotion, RenderHost, type ViewStatus } from './renderHost.ts';
import { createCinemaSeatModel, createSeatInstances, type SeatInstances, type SeatModel } from './seats.ts';

export { WebGLUnavailableError, type ViewStatus } from './renderHost.ts';

export interface CinemaViewCallbacks {
  onStatus(status: ViewStatus): void;
  onTransitionChange(active: boolean): void;
  /** The user started orbiting, zooming or panning by hand. */
  onManualCamera(): void;
}

/**
 * The auditorium viewport: room, 110 seats, lighting and the inspection camera, drawn by a
 * RenderHost. Frames are rendered on demand and keep coming only while a preset transition or
 * orbit damping is still moving the camera.
 */
export class CinemaView {
  readonly layout: AuditoriumLayout;
  private readonly callbacks: CinemaViewCallbacks;
  private readonly host: RenderHost;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly materials: BlockoutMaterials;
  private readonly seatMaterials: SeatMaterials;
  private readonly architecture: Architecture;
  private readonly seatModel: SeatModel;
  private readonly seatInstances: SeatInstances;
  private readonly lighting: Lighting;
  private reportedTransition = false;
  private disposed = false;

  constructor(container: HTMLElement, layout: AuditoriumLayout, callbacks: CinemaViewCallbacks) {
    this.layout = layout;
    this.callbacks = callbacks;
    const { config } = layout;

    this.host = new RenderHost(container, {
      background: config.render.background,
      maxPixelRatio: config.render.maxPixelRatio,
      ariaLabel: 'Khung nhìn 3D của phòng chiếu. Kéo để xoay, cuộn hoặc chụm để thu phóng.',
      onResize: (width, height) => this.rig.setAspect(width / height),
      onFrame: (time) => this.renderFrame(time),
      onStatus: (status) => callbacks.onStatus(status),
    });

    try {
      this.materials = createBlockoutMaterials();
      // Exit signs are read at an angle from most seats.
      const sign = this.materials.exitSign.map;
      if (sign) sign.anisotropy = Math.min(8, this.host.renderer.capabilities.getMaxAnisotropy());
      this.seatMaterials = createSeatMaterials();
      this.architecture = buildArchitecture(layout, this.materials);
      this.seatModel = createCinemaSeatModel(config, this.seatMaterials);
      this.seatInstances = createSeatInstances(this.seatModel, layout.seats);
      this.lighting = createLighting(layout);
      this.scene.add(this.architecture.group, this.seatInstances.group, this.lighting.group);

      const { interior } = layout;
      this.rig = new CameraRig(config.camera, this.host.canvas, {
        x: (interior.x.min + interior.x.max) / 2,
        y: (interior.y.min + interior.y.max) / 2,
        z: (interior.z.min + interior.z.max) / 2,
      });
    } catch (error) {
      // Nothing else holds the renderer yet; release it so a failed mount leaves no canvas or context.
      this.host.dispose();
      throw error;
    }
    this.rig.controls.addEventListener('change', this.host.requestRender);
    this.rig.controls.addEventListener('start', this.handleControlsStart);
    this.host.start();
  }

  /** Moves the camera to a preset (animated unless the user prefers reduced motion). */
  setPreset(id: CameraPresetId, animate: boolean): CameraPose {
    const pose = computePresetPose(id, this.layout, this.rig.camera.aspect);
    this.rig.moveTo(pose, animate && !prefersReducedMotion());
    this.reportTransition();
    this.host.requestRender();
    return pose;
  }

  setPartVisible(part: ToggleablePart, visible: boolean): void {
    this.architecture.toggleable[part].visible = visible;
    this.host.requestRender();
  }

  /**
   * Development: puts the camera at an exact pose, e.g. for close-up checks. Orbit mode keeps the
   * camera above its target (it would be moved for upward views); 'eye' keeps it exactly in place.
   */
  debugSetCamera(position: Vec3, target: Vec3, mode: CameraMode = 'orbit'): void {
    this.rig.moveTo({ position, lookAt: target, mode }, false);
    this.reportTransition();
    this.host.requestRender();
  }

  /**
   * Development: renders the current view with seats, then the interior fit-out, hidden, and
   * reports how the draw calls and triangles split between seats, interior and room shell.
   */
  measureCost() {
    const { renderer } = this.host;
    const frame = () => {
      renderer.render(this.scene, this.rig.camera);
      const { calls, triangles } = renderer.info.render;
      return { calls, triangles };
    };
    const minus = (a: { calls: number; triangles: number }, b: { calls: number; triangles: number }) => ({
      calls: a.calls - b.calls,
      triangles: a.triangles - b.triangles,
    });
    const interiorMeshes: Object3D[] = [];
    this.architecture.group.traverse((object) => {
      if ((object as Mesh).isMesh && object.visible && INTERIOR_MATERIALS.has(object.userData.material)) interiorMeshes.push(object);
    });

    const total = frame();
    this.seatInstances.group.visible = false;
    const withoutSeats = frame();
    this.seatInstances.group.visible = true;
    for (const mesh of interiorMeshes) mesh.visible = false;
    const withoutInterior = frame();
    for (const mesh of interiorMeshes) mesh.visible = true;
    frame();

    const seats = minus(total, withoutSeats);
    const interior = minus(total, withoutInterior);
    return { total, seats, interior, shell: minus(withoutSeats, interior) };
  }

  /** Snapshot for development tooling and automated checks. */
  getDebugState() {
    const { camera, controls } = this.rig;
    return {
      mode: this.rig.mode,
      transitioning: this.rig.isTransitioning,
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, aspect: camera.aspect },
      ...this.host.getDebugInfo(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rig.controls.removeEventListener('change', this.host.requestRender);
    this.rig.controls.removeEventListener('start', this.handleControlsStart);
    this.rig.dispose();

    // Each owner releases what it created; shared materials go last, after every user is gone.
    this.scene.clear();
    this.seatInstances.dispose();
    this.seatModel.dispose();
    this.architecture.dispose();
    this.lighting.dispose();
    disposeMaterials(this.materials);
    disposeMaterials(this.seatMaterials);
    this.host.dispose();
  }

  private renderFrame(time: number): boolean {
    const needsAnotherFrame = this.rig.update(time);
    this.host.renderer.render(this.scene, this.rig.camera);
    this.reportTransition();
    return needsAnotherFrame;
  }

  private readonly handleControlsStart = (): void => {
    this.callbacks.onManualCamera();
  };

  private reportTransition(): void {
    const active = this.rig.isTransitioning;
    if (active === this.reportedTransition) return;
    this.reportedTransition = active;
    this.callbacks.onTransitionChange(active);
  }
}
