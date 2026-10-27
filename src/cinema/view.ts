import { type Mesh, NeutralToneMapping, type Object3D, PCFShadowMap, Scene } from 'three';
import { buildArchitecture, INTERIOR_MATERIALS, type Architecture, type ToggleablePart } from './architecture.ts';
import { CameraRig } from './cameraRig.ts';
import { computePresetPose, type CameraMode, type CameraPose, type CameraPresetId } from './cameraPresets.ts';
import { createInteriorEnvironment, type InteriorEnvironment } from './environment.ts';
import { measureCameraPath } from './frameProbe.ts';
import type { AuditoriumLayout, Vec3 } from './layout.ts';
import { createRoomLighting, type RoomLighting } from './lighting.ts';
import {
  createBlockoutMaterials,
  createSeatMaterials,
  disposeMaterials,
  type BlockoutMaterials,
  type SeatMaterials,
} from './materials.ts';
import type { QualityLevel } from './quality.ts';
import { prefersReducedMotion, RenderHost, type ViewStatus } from './renderHost.ts';
import { createCinemaSeatModel, createSeatInstances, type SeatInstances, type SeatModel } from './seats.ts';

export { WebGLUnavailableError, type ViewStatus } from './renderHost.ts';

export interface CinemaViewCallbacks {
  onStatus(status: ViewStatus): void;
  onTransitionChange(active: boolean): void;
  /** The user started orbiting, zooming or panning by hand. */
  onManualCamera(): void;
}

/** Room materials that cast shadows from the ceiling downlight (the rest only receive them). */
const SHADOW_CASTING_MATERIALS = new Set(['panel', 'graphite', 'trim', 'curtain', 'projector', 'stage']);

/**
 * The auditorium viewport: room, 110 seats, lighting and the inspection camera, drawn by a
 * RenderHost. Frames are rendered on demand and keep coming only while a preset transition or
 * orbit damping is still moving the camera. The shadow map is static: it is redrawn only when
 * something it depends on changes (visibility, quality, context restore), never per camera move.
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
  private readonly lighting: RoomLighting;
  private environment: InteriorEnvironment;
  private seatModel: SeatModel;
  private seatInstances: SeatInstances;
  private quality: QualityLevel;
  private shadowRenders = 0;
  private reportedTransition = false;
  private disposed = false;

  constructor(container: HTMLElement, layout: AuditoriumLayout, callbacks: CinemaViewCallbacks, quality: QualityLevel) {
    this.layout = layout;
    this.callbacks = callbacks;
    this.quality = quality;
    const { config } = layout;
    const settings = config.quality[quality];

    this.host = new RenderHost(container, {
      background: config.render.background,
      maxPixelRatio: settings.maxPixelRatio,
      ariaLabel: 'Khung nhìn 3D của phòng chiếu. Kéo để xoay, cuộn hoặc chụm để thu phóng.',
      onResize: (width, height) => this.rig.setAspect(width / height),
      onFrame: (time) => this.renderFrame(time),
      onStatus: (status) => callbacks.onStatus(status),
      onContextRestored: () => this.handleContextRestored(),
    });
    const { renderer } = this.host;
    // Colour pipeline: sRGB textures decoded to linear, lit in linear, tone-mapped once in the
    // material shaders straight to the sRGB canvas (no post-processing pass, so no double mapping).
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = config.render.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    let environment: InteriorEnvironment | null = null;
    try {
      this.materials = createBlockoutMaterials();
      const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      // Read at an angle from most seats.
      for (const texture of [this.materials.exitSign.map, this.materials.carpet.map]) if (texture) texture.anisotropy = anisotropy;
      this.seatMaterials = createSeatMaterials();
      this.architecture = buildArchitecture(layout, this.materials);
      configureShadows(this.architecture);
      this.lighting = createRoomLighting(layout);
      this.lighting.setShadowQuality(settings.shadowMapSize, settings.shadowRadius);
      environment = createInteriorEnvironment(renderer);
      this.environment = environment;
      this.scene.environment = environment.texture;
      [this.seatModel, this.seatInstances] = this.buildSeats(quality);
      this.scene.add(this.architecture.group, this.seatInstances.group, this.lighting.group);

      const { interior } = layout;
      this.rig = new CameraRig(config.camera, this.host.canvas, {
        x: (interior.x.min + interior.x.max) / 2,
        y: (interior.y.min + interior.y.max) / 2,
        z: (interior.z.min + interior.z.max) / 2,
      });
    } catch (error) {
      // Nothing else holds the renderer yet; release it so a failed mount leaves no canvas or context.
      environment?.dispose();
      this.host.dispose();
      throw error;
    }
    this.rig.controls.addEventListener('change', this.host.requestRender);
    this.rig.controls.addEventListener('start', this.handleControlsStart);
    renderer.shadowMap.needsUpdate = true;
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

  /** Shows or hides a shell part with everything fixed to it, including its lights and shadows. */
  setPartVisible(part: ToggleablePart, visible: boolean): void {
    this.architecture.toggleable[part].visible = visible;
    this.lighting.setPartVisible(part, visible);
    this.invalidateShadows();
  }

  /**
   * Switches quality: rebuilds the seats at that level of detail and changes the pixel-ratio cap
   * and shadow map size. Camera, visibility and everything else stay as they are.
   */
  setQuality(level: QualityLevel): void {
    if (level === this.quality || this.disposed) return;
    this.quality = level;
    const settings = this.layout.config.quality[level];
    this.scene.remove(this.seatInstances.group);
    this.seatInstances.dispose();
    this.seatModel.dispose();
    [this.seatModel, this.seatInstances] = this.buildSeats(level);
    this.scene.add(this.seatInstances.group);
    this.lighting.setShadowQuality(settings.shadowMapSize, settings.shadowRadius);
    this.host.setMaxPixelRatio(settings.maxPixelRatio);
    this.invalidateShadows();
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
   * reports how the main pass splits between seats, interior and room shell; then renders once
   * with a shadow update to isolate the shadow pass. (renderer.info resets per render() call, and
   * a shadow update is counted inside the call that draws it.)
   */
  measureCost() {
    const { renderer } = this.host;
    const frame = (withShadowUpdate = false) => {
      renderer.shadowMap.needsUpdate = withShadowUpdate;
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
    const shadowPass = minus(frame(true), total);
    this.shadowRenders++;
    frame();

    const seats = minus(total, withoutSeats);
    const interior = minus(total, withoutInterior);
    const mapSize = this.lighting.key.shadow.mapSize.x;
    return {
      total,
      seats,
      interior,
      shell: minus(withoutSeats, interior),
      shadowPass,
      shadowMap: { size: mapSize, approxMiB: (mapSize * mapSize * 4) / 2 ** 20 },
    };
  }

  /**
   * Development: times `frames` frames along a fixed camera path (overview → left aisle →
   * from the screen → seat F06 → overview), then puts the camera back where it was.
   */
  async measureFrames(frames = 120) {
    const { camera, controls } = this.rig;
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone() };
    const aspect = camera.aspect;
    const pose = (id: CameraPresetId) => computePresetPose(id, this.layout, aspect);
    const keyframes = [
      pose('overview'),
      { position: { x: -4, y: 3.2, z: 3 }, lookAt: { x: 0, y: 2, z: -6 } },
      pose('seats'),
      pose('seatEye'),
      pose('overview'),
    ];
    try {
      return await measureCameraPath(this.host.renderer, this.scene, camera, keyframes, frames);
    } finally {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      controls.target.copy(saved.target);
      this.host.requestRender();
    }
  }

  /** Snapshot for development tooling and automated checks. */
  getDebugState() {
    const { camera, controls } = this.rig;
    const shadow = this.lighting.key.shadow;
    return {
      quality: this.quality,
      mode: this.rig.mode,
      transitioning: this.rig.isTransitioning,
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, aspect: camera.aspect },
      lights: this.lighting.describe(),
      shadow: { mapSize: shadow.mapSize.x, radius: shadow.radius, renders: this.shadowRenders },
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
    this.scene.environment = null;
    this.seatInstances.dispose();
    this.seatModel.dispose();
    this.architecture.dispose();
    this.lighting.dispose();
    this.environment.dispose();
    disposeMaterials(this.materials);
    disposeMaterials(this.seatMaterials);
    this.host.dispose();
  }

  private buildSeats(level: QualityLevel): [SeatModel, SeatInstances] {
    const model = createCinemaSeatModel(this.layout.config, this.seatMaterials, this.layout.config.quality[level].seat);
    const instances = createSeatInstances(model, this.layout.seats);
    for (const mesh of instances.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return [model, instances];
  }

  private invalidateShadows(): void {
    this.host.renderer.shadowMap.needsUpdate = true;
    this.host.requestRender();
  }

  private renderFrame(time: number): boolean {
    const needsAnotherFrame = this.rig.update(time);
    const { renderer } = this.host;
    if (renderer.shadowMap.needsUpdate) this.shadowRenders++;
    renderer.render(this.scene, this.rig.camera);
    this.reportTransition();
    return needsAnotherFrame;
  }

  /** The prefiltered environment and the shadow map lived on the lost context; rebuild them. */
  /**
   * The prefiltered environment was a render target, so its pixels died with the old context:
   * build it again. The old target is dropped, not disposed: its GL objects are already gone, and
   * disposing would make three.js delete stale handles on the new context.
   */
  private handleContextRestored(): void {
    this.environment = createInteriorEnvironment(this.host.renderer);
    this.scene.environment = this.environment.texture;
    this.invalidateShadows();
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

/**
 * Shadow roles per merged mesh: the ceiling and the screen neither cast nor receive (the downlight
 * stands for the ceiling itself); structural walls and floor finishes only receive, so no shadow
 * ever comes "through" a wall; fixtures and furniture cast and receive.
 */
function configureShadows(architecture: Architecture): void {
  for (const group of architecture.group.children) {
    for (const mesh of group.children as Mesh[]) {
      const off = group.name === 'ceiling' || group.name === 'screen';
      mesh.receiveShadow = !off;
      mesh.castShadow = !off && SHADOW_CASTING_MATERIALS.has(mesh.userData.material);
    }
  }
}
