import {
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  PCFShadowMap,
  type PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import { buildArchitecture, INTERIOR_MATERIALS, type Architecture, type ToggleablePart } from './architecture.ts';
import { planCameraPath } from './cameraPath.ts';
import { CameraRig, type CameraDriver } from './cameraRig.ts';
import { computePresetPose, presetInfo, resolveEyeSeat, type CameraMode, type CameraPose, type CameraPresetId } from './cameraPresets.ts';
import { createCollisionWorld, type CollisionWorld } from './collision.ts';
import { createInteriorEnvironment, type InteriorEnvironment } from './environment.ts';
import { ExploreInput, isMovementKey, keyBelongsToFocus } from './exploreInput.ts';
import { measureCameraPath, measurePlacedFrames } from './frameProbe.ts';
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
import { RenderHost, type ViewStatus } from './renderHost.ts';
import { SeatHighlighter } from './seatHighlight.ts';
import { pickSeat, SeatPicker, visibleMeshes, type SeatHit } from './seatPicking.ts';
import { createCinemaSeatModel, createSeatInstances, seatPivotMatrix, type SeatInstances, type SeatModel } from './seats.ts';
import { seatViewPose } from './seatView.ts';
import type { SeatSelection } from './selection.ts';
import { TapTracker } from './tapTracker.ts';
import { createTour, TourPath } from './tour.ts';
import { chooseWalkStart, stepWalker, turnWalker, type StartPoint, type WalkerState } from './walker.ts';

export { WebGLUnavailableError, type ViewStatus } from './renderHost.ts';

/**
 * What the camera is doing, for the UI and for checks:
 * - `preset`: resting at (or orbiting from) an experience view;
 * - `inspection`: at a technical view (section, plan), free orbit, may be outside the room;
 * - `transition`: moving to a preset or to where the tour or exploring starts;
 * - `tour`: the guided tour drives the camera (or, with reduced motion, steps between its stops);
 * - `explore`: walking with keys, stick and drag-to-look;
 * - `seat`: at the eye of a chosen seat ("Xem từ ghế này"); drag looks around, the eye stays;
 * - `free`: stopped where the user left it (after stopping the tour or exploring); drag looks around.
 */
export type CameraState = 'preset' | 'inspection' | 'transition' | 'tour' | 'explore' | 'seat' | 'free';

export type TourEndReason = 'finished' | 'input' | 'command' | 'hidden' | 'context-lost';

export interface TourStatus {
  steps: boolean;
  stopIndex: number;
  stopCount: number;
  label: string;
  elapsed: number;
  duration: number;
}

export interface CinemaViewCallbacks {
  onStatus(status: ViewStatus): void;
  onCameraState(state: CameraState): void;
  /** A move (preset, tour start, explore start) reached its end. */
  onArrive(): void;
  /** The user grabbed the orbit controls by hand. */
  onManualCamera(): void;
  onTour(status: TourStatus | null, ended?: TourEndReason): void;
  /** Exploring started; `relocatedTo` is set when the camera was taken to a start point first. */
  onExploreStart(relocatedTo: StartPoint | null): void;
  /** A tap or click (not a drag) landed on a seat that is not hidden behind anything. */
  onSeatTap(seatId: string): void;
}

/** Room materials that cast shadows from the ceiling downlight (the rest only receive them). */
const SHADOW_CASTING_MATERIALS = new Set(['panel', 'graphite', 'trim', 'curtain', 'projector', 'stage']);

/** Everything that lives on the GPU; rebuilt from scratch after a lost context comes back. */
interface SceneContent {
  materials: BlockoutMaterials;
  seatMaterials: SeatMaterials;
  architecture: Architecture;
  lighting: RoomLighting;
  environment: InteriorEnvironment;
  seatModel: SeatModel;
  seatInstances: SeatInstances;
  /** Seat states drawn onto the instances, and picking proxies for the same model. */
  highlighter: SeatHighlighter;
  picker: SeatPicker;
}

/**
 * The auditorium viewport: room, 110 seats, lighting and the camera, drawn by a RenderHost.
 *
 * Camera: one CameraRig, written by exactly one owner at a time (OrbitControls, a transition, the
 * tour or the explore walker; see CameraState). Commands (preset, tour, explore) always start from
 * the current camera and replace whatever was running; nothing is queued.
 *
 * Rendering is on demand: frames run only while a transition, orbit damping, the tour or a held
 * explore input is moving the camera, or after a change to the scene, and stop as soon as all of
 * that has settled. The shadow map is redrawn only when the scene changes, never per camera move.
 */
export class CinemaView {
  readonly layout: AuditoriumLayout;
  private readonly callbacks: CinemaViewCallbacks;
  private readonly host: RenderHost;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly world: CollisionWorld;
  private readonly input: ExploreInput;
  private readonly selection: SeatSelection;
  private readonly unsubscribeSelection: () => void;
  private readonly taps: TapTracker;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  /** Seat whose eye the camera is at ("Xem từ ghế này"), or null. */
  private seatView: string | null = null;
  /** Durations of the last picks (ms), for the development hook. */
  private readonly pickTimes: number[] = [];
  private readonly listeners = new AbortController();
  private content: SceneContent;
  private quality: QualityLevel;
  private readonly hiddenParts = new Set<ToggleablePart>();
  private preset: CameraPresetId | null = null;
  /** The camera is exactly at the active preset's pose (not orbited away), so it reframes on resize. */
  private pristine = false;
  private tour: { path: TourPath; time: number; steps: boolean; stopIndex: number } | null = null;
  private walker: WalkerState | null = null;
  private exploring = false;
  private reducedMotion: boolean;
  /** Show the on-screen stick in explore mode (touch-first devices). */
  private readonly touchStick: boolean;
  private shadowRenders = 0;
  private reportedState: CameraState | null = null;
  private debugOverlay: Group | null = null;
  private disposed = false;

  constructor(
    container: HTMLElement,
    layout: AuditoriumLayout,
    callbacks: CinemaViewCallbacks,
    options: { quality: QualityLevel; reducedMotion: boolean; touchStick: boolean; selection: SeatSelection },
  ) {
    this.layout = layout;
    this.callbacks = callbacks;
    this.selection = options.selection;
    this.taps = new TapTracker({ slopPx: layout.config.selection.tapSlopPx, maxMs: layout.config.selection.tapMaxMs });
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.touchStick = options.touchStick;
    const { config } = layout;
    const settings = config.quality[options.quality];

    this.host = new RenderHost(container, {
      background: config.render.background,
      maxPixelRatio: settings.maxPixelRatio,
      maxDeltaSeconds: config.camera.explore.maxStepSeconds,
      ariaLabel:
        'Khung nhìn 3D của phòng chiếu. Nhấn vào một ghế để chọn; với bàn phím hoặc trình đọc màn hình, dùng Sơ đồ ghế. Kéo để xoay hoặc nhìn quanh; ở chế độ Khám phá dùng W A S D hoặc phím mũi tên để đi.',
      onResize: (width, height) => this.handleResize(width / height),
      onFrame: (_time, dt) => this.renderFrame(dt),
      onStatus: (status) => callbacks.onStatus(status),
      onContextLost: () => this.handleContextLost(),
      onContextRestored: () => this.handleContextRestored(),
      textureProbe: () => this.content?.materials.wall,
    });
    const { renderer } = this.host;
    // Colour pipeline: sRGB textures decoded to linear, lit in linear, tone-mapped once in the
    // material shaders straight to the sRGB canvas (no post-processing pass, so no double mapping).
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = config.render.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    try {
      this.content = this.buildContent(options.quality);
      this.world = createCollisionWorld(layout);
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
    this.input = new ExploreInput(this.host.canvas, container, {
      lookPerPixel: config.camera.explore.lookPerPixel,
      onInput: this.host.requestRender,
    });

    const { signal } = this.listeners;
    this.rig.controls.addEventListener('change', this.host.requestRender);
    this.rig.controls.addEventListener('start', this.handleControlsStart);
    // Capture phase: runs before OrbitControls' and the explore input's own handlers on the canvas,
    // so a press that stops the tour is already handed to the controls when they see it. These
    // listeners only observe (tap detection, hover); they never capture or cancel a pointer.
    const canvas = this.host.canvas;
    canvas.addEventListener('pointerdown', this.handlePointerDown, { capture: true, signal });
    canvas.addEventListener('pointermove', this.handlePointerMove, { capture: true, passive: true, signal });
    canvas.addEventListener('pointerup', this.handlePointerUp, { capture: true, signal });
    canvas.addEventListener('pointercancel', (event) => this.taps.cancel(event.pointerId), { capture: true, signal });
    canvas.addEventListener('pointerleave', this.clearHover, { signal });
    canvas.addEventListener('wheel', this.handleWheel, { capture: true, passive: true, signal });
    // Every pointer on the page, so a finger on the stick or a second finger anywhere spoils a tap.
    window.addEventListener('pointerdown', (event) => this.taps.anyDown(event.pointerId), { capture: true, signal });
    for (const type of ['pointerup', 'pointercancel'] as const) {
      window.addEventListener(type, (event) => this.taps.anyUp(event.pointerId), { capture: true, signal });
    }
    window.addEventListener('blur', this.dropPointers, { signal });
    window.addEventListener('keydown', this.handleKeyDown, { capture: true, signal });
    document.addEventListener('visibilitychange', this.handleVisibility, { signal });
    this.unsubscribeSelection = this.selection.subscribe((change) => {
      if (this.content.highlighter.apply(this.selection, change.seats)) this.host.requestRender();
    });
    renderer.shadowMap.needsUpdate = true;
    this.host.start();
  }

  // ---------------------------------------------------------------- commands

  /** Moves to a preset, from wherever the camera is, around obstacles; ends the tour or exploring. */
  setPreset(id: CameraPresetId, animate: boolean): CameraPose {
    this.endActivities('command');
    const aspect = this.rig.camera.aspect;
    const pose = computePresetPose(id, this.layout, aspect);
    this.preset = id;
    this.pristine = false;
    this.rig.constraint = null;
    this.moveCamera(pose, animate, () => {
      // Resized on the way: frame for the new shape.
      if (this.rig.camera.aspect !== aspect) this.rig.moveTo(computePresetPose(id, this.layout, this.rig.camera.aspect), false);
      this.pristine = true;
      this.rig.constraint = presetInfo(id).space === 'experience' ? this.experienceConstraint : null;
      this.callbacks.onArrive();
    });
    return pose;
  }

  /**
   * Starts the guided tour from the overview (moving there first if needed). With reduced motion
   * it steps between the tour's stops instead (`tourStep`), without continuous movement.
   */
  startTour(): void {
    this.endActivities('command');
    this.preset = null;
    this.pristine = false;
    this.rig.constraint = null;
    const path = new TourPath(createTour(this.layout, computePresetPose('overview', this.layout, this.rig.camera.aspect)));
    const steps = this.reducedMotion;
    this.tour = { path, time: 0, steps, stopIndex: 0 };
    if (steps) {
      this.showTourStop(0);
      return;
    }
    const first = path.tour.stops[0];
    this.moveCamera({ position: first.position, lookAt: first.lookAt, mode: 'eye' }, true, () => {
      if (this.tour?.path !== path) return;
      this.callbacks.onArrive();
      this.rig.drive(this.tourDriver);
      this.reportTour();
    });
    this.reportTour();
  }

  /** Steps mode: shows the previous or next stop; past the last one, the tour ends at the overview. */
  tourStep(delta: number): void {
    if (!this.tour?.steps) return;
    const next = this.tour.stopIndex + delta;
    if (next >= this.tour.path.tour.stops.length) {
      this.finishTour();
      return;
    }
    this.showTourStop(Math.max(0, next));
  }

  stopTour(reason: TourEndReason = 'command'): void {
    if (!this.tour) return;
    this.tour = null;
    this.rig.hold('eye');
    this.callbacks.onTour(null, reason);
    this.requestFrame();
  }

  /**
   * Starts walking. From a spot where a person could stand below the camera, the camera comes down
   * to standing eye height there; otherwise it moves (visibly, around obstacles) to the nearest
   * start point in an aisle, at the front or on the back landing.
   */
  startExplore(): void {
    this.endActivities('command');
    this.preset = null;
    this.pristine = false;
    this.rig.constraint = null;
    const settings = this.layout.config.camera.explore;
    const start = chooseWalkStart(this.world, settings, this.rig.camera.position, this.rig.orientation, this.startPoints());
    this.walker = start.state;
    this.exploring = true;
    this.input.setActive(true, this.touchStick);
    const { state } = start;
    const position = { x: state.x, y: state.eyeY, z: state.z };
    const lookAt = {
      x: state.x - Math.sin(state.yaw) * Math.cos(state.pitch),
      y: state.eyeY + Math.sin(state.pitch),
      z: state.z - Math.cos(state.yaw) * Math.cos(state.pitch),
    };
    this.moveCamera({ position, lookAt, mode: 'eye' }, true, () => {
      if (!this.exploring) return;
      this.rig.drive(this.exploreDriver);
      this.callbacks.onArrive();
      this.callbacks.onExploreStart(start.relocatedTo);
    });
  }

  /**
   * Moves to the eye of `seatId` (seatViewPose), around obstacles, ending the tour or exploring.
   * Dragging then turns the head; the eye stays put. Selection is untouched.
   */
  viewFromSeat(seatId: string): CameraPose {
    this.endActivities('command');
    this.preset = null;
    this.pristine = false;
    this.rig.constraint = null;
    const pose = seatViewPose(this.layout, this.layout.seatById.get(seatId)!);
    this.seatView = seatId;
    this.moveCamera(pose, true, () => this.callbacks.onArrive());
    return pose;
  }

  /** Stops walking where the camera is; dragging then looks around from there. */
  stopExplore(): void {
    if (!this.exploring) return;
    this.exploring = false;
    this.walker = null;
    this.input.setActive(false, false);
    this.rig.hold('eye');
    this.requestFrame();
  }

  /** Reduced motion turned on or off while running: a playing tour switches to steps at its current stop. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.tour && !this.tour.steps) {
      this.tour.steps = true;
      this.showTourStop(this.tour.stopIndex);
    }
  }

  /** Shows or hides a shell part with everything fixed to it, including its lights and shadows. */
  setPartVisible(part: ToggleablePart, visible: boolean): void {
    if (visible) this.hiddenParts.delete(part);
    else this.hiddenParts.add(part);
    this.content.architecture.toggleable[part].visible = visible;
    this.content.lighting.setPartVisible(part, visible);
    this.invalidateShadows();
  }

  /**
   * Switches quality: rebuilds the seats at that level of detail and changes the pixel-ratio cap
   * and shadow map size. Camera, tour, exploring, visibility and everything else stay as they are.
   */
  setQuality(level: QualityLevel): void {
    if (level === this.quality || this.disposed) return;
    this.quality = level;
    const settings = this.layout.config.quality[level];
    const content = this.content;
    this.scene.remove(content.seatInstances.group);
    content.seatInstances.dispose();
    content.seatModel.dispose();
    [content.seatModel, content.seatInstances] = this.buildSeats(content.seatMaterials, level);
    this.scene.add(content.seatInstances.group);
    // Same seats, same state: repaint the new instances from the selection, new proxies for picking.
    content.highlighter.attach(content.seatInstances, content.seatModel);
    content.highlighter.apply(this.selection);
    content.picker = new SeatPicker(this.layout.seats, content.seatModel);
    content.lighting.setShadowQuality(settings.shadowMapSize, settings.shadowRadius);
    this.host.setMaxPixelRatio(settings.maxPixelRatio);
    this.invalidateShadows();
  }

  // ---------------------------------------------------------------- development hooks

  /**
   * Development: puts the camera at an exact pose, e.g. for close-up checks. Orbit mode keeps the
   * camera above its target (it would be moved for upward views); 'eye' keeps it exactly in place.
   */
  debugSetCamera(position: Vec3, target: Vec3, mode: CameraMode = 'orbit'): void {
    this.endActivities('command');
    this.preset = null;
    this.pristine = false;
    this.rig.constraint = null;
    this.rig.moveTo({ position, lookAt: target, mode }, false);
    this.requestFrame();
  }

  /**
   * Development: a point on the page (client CSS px) where seat `seatId` can be clicked from the
   * current camera: the first of its backrest top, headrest, cushion and armrest centres that is
   * on screen and actually picks this seat (not hidden behind the seat in front, a wall…).
   * `visible` is false when none of them does.
   */
  debugSeatScreenPoint(seatId: string): { x: number; y: number; visible: boolean } {
    const seat = this.layout.seatById.get(seatId)!;
    const rect = this.host.canvas.getBoundingClientRect();
    const pivot = seatPivotMatrix(seat);
    const centre = (name: string, top = false) => {
      const box = this.content.seatModel.components.find((c) => c.name === name)!.bounds;
      return new Vector3((box.min.x + box.max.x) / 2, top ? box.max.y - 0.01 : (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    };
    let first: { x: number; y: number } | null = null;
    for (const local of [centre('backrest-shell', true), centre('headrest'), centre('cushion', true), centre('upper-back'), centre('armrest-right', true)]) {
      const ndc = local.applyMatrix4(pivot).project(this.rig.camera);
      if (Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98 || ndc.z > 1) continue;
      const point = { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
      first ??= point;
      if (this.pickAt(point.x, point.y)?.seat.id === seatId) return { ...point, visible: true };
    }
    return { ...(first ?? { x: 0, y: 0 }), visible: false };
  }

  /** Development: the colour factor and tag drawn on a seat. */
  debugSeatLook(seatId: string) {
    const index = this.layout.seatById.get(seatId)!.index;
    return { tint: this.content.highlighter.tintOf(index), shell: this.content.highlighter.tintOf(index, 'shell'), tag: this.content.highlighter.tagShown(index) };
  }

  /** Development: times `samples` picks spread over the canvas (proxies plus occluders), in ms. */
  measurePicking(samples = 200) {
    const rect = this.host.canvas.getBoundingClientRect();
    const times: number[] = [];
    let hits = 0;
    for (let i = 0; i < samples; i++) {
      const x = rect.left + (((i * 37) % samples) / samples) * rect.width;
      const y = rect.top + (((i * 61) % samples) / samples) * rect.height;
      const start = performance.now();
      if (this.pickAt(x, y)) hits++;
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const at = (q: number) => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] * 1000) / 1000;
    return { samples, hits, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
  }

  /** Development: places the camera at tour time `t` (seconds), for frame-by-frame review. */
  debugTourFrame(t: number): { stopIndex: number; holding: boolean } {
    const path = new TourPath(createTour(this.layout, computePresetPose('overview', this.layout, this.rig.camera.aspect)));
    this.debugSetCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 'eye');
    const sample = path.sample(t);
    this.rig.camera.position.copy(sample.position);
    this.rig.applyOrientation(sample.orientation);
    this.rig.hold('eye');
    this.requestFrame();
    return { stopIndex: sample.stopIndex, holding: sample.holding };
  }

  /** Development: shows the colliders and the tour path as lines. */
  debugShowPaths(on: boolean): void {
    if (this.debugOverlay) {
      this.scene.remove(this.debugOverlay);
      this.debugOverlay.traverse((object) => {
        const line = object as Line;
        if (line.isLine) {
          line.geometry.dispose();
          (line.material as LineBasicMaterial).dispose();
        }
      });
      this.debugOverlay = null;
    }
    if (on) {
      const group = new Group();
      for (const c of this.world.colliders) {
        group.add(new Box3Helper(new Box3(new Vector3(c.x.min, c.y.min, c.z.min), new Vector3(c.x.max, c.y.max, c.z.max)), new Color(0x4fd1ff)));
      }
      const path = new TourPath(createTour(this.layout, computePresetPose('overview', this.layout, this.rig.camera.aspect)));
      const points: Vector3[] = [];
      for (let t = 0; t <= path.tour.duration; t += 0.1) points.push(path.sample(t).position.clone());
      group.add(new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x7dff6a })));
      this.debugOverlay = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  /**
   * Development: renders the current view with seats, then the interior fit-out, hidden, and
   * reports how the main pass splits between seats, interior and room shell; then renders once
   * with a shadow update to isolate the shadow pass. (renderer.info resets per render() call, and
   * a shadow update is counted inside the call that draws it.)
   */
  measureCost() {
    const { renderer } = this.host;
    const { seatInstances, architecture, lighting } = this.content;
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
    architecture.group.traverse((object) => {
      if ((object as Mesh).isMesh && object.visible && INTERIOR_MATERIALS.has(object.userData.material)) interiorMeshes.push(object);
    });

    const total = frame();
    seatInstances.group.visible = false;
    const withoutSeats = frame();
    seatInstances.group.visible = true;
    for (const mesh of interiorMeshes) mesh.visible = false;
    const withoutInterior = frame();
    for (const mesh of interiorMeshes) mesh.visible = true;
    const shadowPass = minus(frame(true), total);
    this.shadowRenders++;
    frame();

    const seats = minus(total, withoutSeats);
    const interior = minus(total, withoutInterior);
    const mapSize = lighting.key.shadow.mapSize.x;
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
    const aspect = this.rig.camera.aspect;
    const pose = (id: CameraPresetId) => computePresetPose(id, this.layout, aspect);
    const keyframes = [
      pose('overview'),
      { position: { x: -4, y: 3.2, z: 3 }, lookAt: { x: 0, y: 2, z: -6 } },
      pose('seats'),
      pose('seatEye'),
      pose('overview'),
    ];
    return this.withSavedCamera(() => measureCameraPath(this.host.renderer, this.scene, this.rig.camera, keyframes, frames));
  }

  /** Development: times `frames` frames spread evenly along the whole tour path. */
  async measureTour(frames = 150) {
    const path = new TourPath(createTour(this.layout, computePresetPose('overview', this.layout, this.rig.camera.aspect)));
    const { camera } = this.rig;
    return this.withSavedCamera(() =>
      measurePlacedFrames(this.host.renderer, this.scene, camera, frames, (i) => {
        const sample = path.sample((i / Math.max(1, frames - 1)) * path.tour.duration);
        camera.position.copy(sample.position);
        this.rig.applyOrientation(sample.orientation);
      }),
    );
  }

  /** Snapshot for development tooling and automated checks. */
  getDebugState() {
    const { camera, controls } = this.rig;
    const shadow = this.content.lighting.key.shadow;
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    return {
      quality: this.quality,
      state: this.cameraState(),
      owner: this.rig.owner,
      controlsEnabled: controls.enabled,
      preset: this.preset,
      pristine: this.pristine,
      mode: this.rig.mode,
      transitioning: this.rig.isTransitioning,
      reducedMotion: this.reducedMotion,
      camera: {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        // Roll: how far the camera's right vector tilts out of the horizontal plane (0 = none).
        rollDeg: (Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI,
        upY: up.y,
      },
      tour: this.tour
        ? { steps: this.tour.steps, time: this.tour.time, stopIndex: this.tour.stopIndex, duration: this.tour.path.tour.duration }
        : null,
      seatView: this.seatView,
      lastPickMs: this.pickTimes.at(-1) ?? null,
      explore: this.exploring ? { walker: this.walker, input: this.input.debugState() } : null,
      lights: this.content.lighting.describe(),
      shadow: { mapSize: shadow.mapSize.x, radius: shadow.radius, renders: this.shadowRenders },
      ...this.host.getDebugInfo(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.abort();
    this.unsubscribeSelection();
    this.selection.setHovered(null);
    this.input.dispose();
    this.tour = null;
    this.rig.controls.removeEventListener('change', this.host.requestRender);
    this.rig.controls.removeEventListener('start', this.handleControlsStart);
    this.rig.dispose();
    this.debugShowPaths(false);
    this.scene.clear();
    this.scene.environment = null;
    this.disposeContent(this.content);
    this.host.dispose();
  }

  // ---------------------------------------------------------------- camera internals

  /** Moves with a planned path (around seats and the stage); cuts straight there if there is none. */
  private moveCamera(pose: CameraPose, animate: boolean, onArrive: () => void): void {
    const from = this.rig.camera.position.clone();
    const insideRoom = this.insideRoom(from) && this.insideRoom(pose.position);
    // Inspection views from outside fly in through the cut-away part, which stays hidden until arrival.
    const path = insideRoom ? planCameraPath(this.world, from, pose.position) : [from, pose.position];
    const smooth = animate && !this.reducedMotion && path !== null;
    this.rig.moveTo(pose, { animate: smooth, via: path ? path.slice(1, -1) : [], onArrive: () => this.afterMove(onArrive) });
    this.requestFrame();
  }

  private afterMove(onArrive: () => void): void {
    onArrive();
    this.reportState();
  }

  private readonly tourDriver: CameraDriver = {
    update: (camera: PerspectiveCamera, dt: number) => {
      const tour = this.tour;
      if (!tour || tour.steps) return false;
      tour.time += dt;
      const sample = tour.path.sample(tour.time, camera.position);
      this.rig.applyOrientation(sample.orientation);
      if (sample.stopIndex !== tour.stopIndex) {
        tour.stopIndex = sample.stopIndex;
      }
      this.reportTour();
      if (tour.time >= tour.path.tour.duration) {
        // Finish after this frame is drawn at the last pose.
        queueMicrotask(() => this.tour === tour && this.finishTour());
        return false;
      }
      return true;
    },
  };

  private readonly exploreDriver: CameraDriver = {
    update: (camera: PerspectiveCamera, dt: number) => {
      if (!this.walker) return false;
      const settings = this.layout.config.camera.explore;
      const look = this.input.consumeLook();
      let walker = turnWalker(settings, this.walker, look.yaw, look.pitch);
      const step = stepWalker(this.world, settings, walker, this.input.intent(), dt, this.reducedMotion);
      walker = step.state;
      this.walker = walker;
      camera.position.set(walker.x, walker.eyeY, walker.z);
      this.rig.applyOrientation({ yaw: walker.yaw, pitch: walker.pitch });
      return step.active;
    },
  };

  private showTourStop(index: number): void {
    const tour = this.tour;
    if (!tour) return;
    const stop = tour.path.tour.stops[index];
    tour.stopIndex = index;
    tour.time = tour.path.stopTimes()[index];
    this.rig.moveTo({ position: stop.position, lookAt: stop.lookAt, mode: 'eye' }, false);
    this.reportTour();
    this.requestFrame();
  }

  private finishTour(): void {
    const tour = this.tour;
    if (!tour) return;
    this.tour = null;
    // The tour ends exactly at the overview: hand it back as that preset.
    const pose = computePresetPose('overview', this.layout, this.rig.camera.aspect);
    this.preset = 'overview';
    this.rig.moveTo(pose, false);
    this.pristine = true;
    this.rig.constraint = this.experienceConstraint;
    this.callbacks.onTour(null, 'finished');
    this.requestFrame();
  }

  private reportTour(): void {
    const tour = this.tour;
    if (!tour) return;
    const stops = tour.path.tour.stops;
    this.callbacks.onTour({
      steps: tour.steps,
      stopIndex: tour.stopIndex,
      stopCount: stops.length,
      label: stops[tour.stopIndex].label,
      elapsed: tour.time,
      duration: tour.path.tour.duration,
    });
  }

  /** Ends the tour, exploring or a seat view before another command takes the camera. */
  private endActivities(reason: TourEndReason): void {
    this.seatView = null;
    this.selection.setHovered(null);
    if (this.tour) {
      this.tour = null;
      this.callbacks.onTour(null, reason);
    }
    if (this.exploring) {
      this.exploring = false;
      this.walker = null;
      this.input.setActive(false, false);
    }
  }

  private startPoints(): StartPoint[] {
    const { interior, stage, rows, config } = this.layout;
    const aisleX = interior.x.max - config.aisles.width / 2;
    const midRow = rows[Math.floor(rows.length / 2)];
    return [
      { id: 'aisle-right', label: 'lối đi bên phải', x: aisleX, z: midRow.treadZ.min + 0.3 },
      { id: 'aisle-left', label: 'lối đi bên trái', x: -aisleX, z: midRow.treadZ.min + 0.3 },
      { id: 'back', label: 'sàn phía sau', x: 0, z: interior.z.max - 0.7 },
      { id: 'front', label: 'khu trước màn', x: 0, z: stage.z.max + 2.2 },
    ];
  }

  private insideRoom(p: Vec3): boolean {
    const { interior } = this.layout;
    return p.x > interior.x.min && p.x < interior.x.max && p.z > interior.z.min && p.z < interior.z.max && p.y > interior.y.min && p.y < interior.y.max;
  }

  /**
   * Orbiting in the experience views: the camera stays inside the room, above the floor, below the
   * ceiling fixtures and above the seat backs and the stage; the target stays inside the room.
   */
  private readonly experienceConstraint = (position: Vector3, target: Vector3): boolean => {
    const { room } = this.world;
    const margin = this.layout.config.camera.roomMargin;
    const before = position.clone();
    const beforeTarget = target.clone();
    position.x = clamp(position.x, room.x.min + margin, room.x.max - margin);
    position.z = clamp(position.z, room.z.min + margin, room.z.max - margin);
    let floor = this.world.floorAt(position.x, position.z);
    for (const c of this.world.colliders) {
      if (position.x > c.x.min - margin && position.x < c.x.max + margin && position.z > c.z.min - margin && position.z < c.z.max + margin) {
        floor = Math.max(floor, c.y.max);
      }
    }
    // Ceiling beams hang 0.2 m below the ceiling.
    position.y = clamp(position.y, floor + margin, room.y.max - 0.2 - margin);
    target.x = clamp(target.x, room.x.min, room.x.max);
    target.y = clamp(target.y, room.y.min, room.y.max);
    target.z = clamp(target.z, room.z.min, room.z.max);
    return !position.equals(before) || !target.equals(beforeTarget);
  };

  private cameraState(): CameraState {
    if (this.rig.isTransitioning) return 'transition';
    if (this.tour) return 'tour';
    if (this.exploring) return 'explore';
    if (this.seatView) return 'seat';
    if (this.preset) return presetInfo(this.preset).space === 'inspection' ? 'inspection' : 'preset';
    return 'free';
  }

  private reportState(): void {
    const state = this.cameraState();
    if (state === this.reportedState) return;
    this.reportedState = state;
    this.callbacks.onCameraState(state);
  }

  private requestFrame(): void {
    this.reportState();
    this.host.requestRender();
  }

  // ---------------------------------------------------------------- input and lifecycle

  /**
   * A press on the canvas: stops a playing tour (that press is then used up and never selects a
   * seat), and starts tap tracking. The camera controls see the same event right after.
   */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    const stopsTour = Boolean(this.tour && !this.tour.steps);
    if (stopsTour) this.stopTour('input');
    this.taps.down(event.pointerId, event.pointerType, event.button, event.clientX, event.clientY, event.timeStamp, stopsTour);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.taps.move(event.pointerId, event.clientX, event.clientY);
    // Hover for mice and pens only, while no button is held and the camera is not moving by itself.
    if (event.pointerType === 'touch' || event.buttons !== 0 || this.taps.pressing) return;
    if (this.rig.isTransitioning || (this.tour && !this.tour.steps)) return;
    const hit = this.pickAt(event.clientX, event.clientY);
    const id = hit?.seat.id ?? null;
    this.selection.setHovered(id);
    this.host.canvas.style.cursor = id ? (this.selection.isReserved(id) ? 'not-allowed' : 'pointer') : '';
  };

  /** A press that ends as a tap selects (or deselects) the seat under it, if any. */
  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.taps.up(event.pointerId, event.clientX, event.clientY, event.timeStamp)) return;
    const hit = this.pickAt(event.clientX, event.clientY);
    if (hit) this.callbacks.onSeatTap(hit.seat.id);
  };

  /** Scrolling on the canvas stops a playing tour; it never selects. */
  private readonly handleWheel = (): void => {
    if (this.tour && !this.tour.steps) this.stopTour('input');
  };

  private readonly clearHover = (): void => {
    this.selection.setHovered(null);
    this.host.canvas.style.cursor = '';
  };

  /** Blur, hidden tab or lost context: nothing in progress may turn into a tap. */
  private readonly dropPointers = (): void => {
    this.taps.cancelAll();
    this.clearHover();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || keyBelongsToFocus(event)) return;
    if (this.tour && !this.tour.steps && isMovementKey(event)) this.stopTour('input');
  };

  /**
   * The seat under a client point, from what the camera shows: pointer → normalised device
   * coordinates from the canvas' current bounding rect (so panels, resizes and pixel ratio do not
   * matter), then proxies and visible occluders. Exploring limits the reach; the seat the camera sits
   * in (seat view, F06 preset) is skipped so it cannot block everything around it.
   */
  private pickAt(clientX: number, clientY: number): SeatHit | null {
    const rect = this.host.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const start = performance.now();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const { camera } = this.rig;
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, camera);
    const occupied = this.seatView ?? (this.preset === 'seatEye' ? resolveEyeSeat(this.layout).id : null);
    const hit = pickSeat(this.content.picker, this.raycaster.ray, {
      occluders: visibleMeshes(this.content.architecture.group),
      maxDistance: this.exploring ? this.layout.config.selection.exploreReach : Infinity,
      ignoreSeat: occupied ? this.layout.seatById.get(occupied)!.index : -1,
    });
    this.pickTimes.push(performance.now() - start);
    if (this.pickTimes.length > 50) this.pickTimes.shift();
    return hit;
  }

  private readonly handleControlsStart = (): void => {
    this.pristine = false;
    if (this.preset === null && !this.tour && !this.exploring) this.reportState();
    this.callbacks.onManualCamera();
  };

  /** A hidden tab ends the tour (it would otherwise finish unseen) and drops held input. */
  private readonly handleVisibility = (): void => {
    if (!document.hidden) return;
    if (this.tour && !this.tour.steps) this.stopTour('hidden');
    this.input.clear();
    this.dropPointers();
  };

  private handleResize(aspect: number): void {
    this.rig.setAspect(aspect);
    // A preset the user has not moved away from is framed again for the new shape; a free,
    // touring or walking camera keeps its position and direction.
    if (this.preset && this.pristine && this.rig.owner === 'controls') {
      this.rig.moveTo(computePresetPose(this.preset, this.layout, aspect), false);
    }
  }

  private renderFrame(dt: number): boolean {
    const needsAnotherFrame = this.rig.update(dt);
    const { renderer } = this.host;
    if (renderer.shadowMap.needsUpdate) this.shadowRenders++;
    renderer.render(this.scene, this.rig.camera);
    this.reportState();
    return needsAnotherFrame;
  }

  /** The context is gone: stop the tour and drop held input so nothing moves unseen. */
  private handleContextLost(): void {
    if (this.tour && !this.tour.steps) this.stopTour('context-lost');
    this.input.clear();
    this.dropPointers();
  }

  /**
   * Rebuilds every GPU resource after a lost context comes back, and drops the old ones without
   * disposing them. three.js (r186) re-creates its internal WebGL modules on restore, but objects
   * from before the loss keep dispose listeners from the old modules: disposing them later (a
   * quality switch, closing the page) makes those listeners delete handles from the dead context
   * ("object does not belong to this context"). New objects only ever meet the new modules; the old
   * GPU objects died with the old context, and the old JS objects are garbage-collected.
   */
  private handleContextRestored(): void {
    const old = this.content;
    this.scene.remove(old.architecture.group, old.seatInstances.group, old.lighting.group, old.highlighter.markers);
    this.content = this.buildContent(this.quality);
    for (const part of this.hiddenParts) {
      this.content.architecture.toggleable[part].visible = false;
      this.content.lighting.setPartVisible(part, false);
    }
    this.invalidateShadows();
  }

  // ---------------------------------------------------------------- scene content

  private buildContent(quality: QualityLevel): SceneContent {
    const { renderer } = this.host;
    const settings = this.layout.config.quality[quality];
    const materials = createBlockoutMaterials();
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Read at an angle from most seats.
    for (const texture of [materials.exitSign.map, materials.carpet.map]) if (texture) texture.anisotropy = anisotropy;
    const seatMaterials = createSeatMaterials();
    const architecture = buildArchitecture(this.layout, materials);
    configureShadows(architecture);
    const lighting = createRoomLighting(this.layout);
    lighting.setShadowQuality(settings.shadowMapSize, settings.shadowRadius);
    const environment = createInteriorEnvironment(renderer);
    const [seatModel, seatInstances] = this.buildSeats(seatMaterials, quality);
    // Seat states come from the selection, which outlives every rebuild: paint them straight away.
    const highlighter = new SeatHighlighter(this.layout.config.selection.maxSeats, this.layout.config.selection.highlight);
    highlighter.attach(seatInstances, seatModel);
    highlighter.apply(this.selection);
    const picker = new SeatPicker(this.layout.seats, seatModel);
    this.scene.environment = environment.texture;
    this.scene.add(architecture.group, seatInstances.group, lighting.group, highlighter.markers);
    return { materials, seatMaterials, architecture, lighting, environment, seatModel, seatInstances, highlighter, picker };
  }

  private disposeContent(content: SceneContent): void {
    // Each owner releases what it created; shared materials go last, after every user is gone.
    content.seatInstances.dispose();
    content.seatModel.dispose();
    content.architecture.dispose();
    content.lighting.dispose();
    content.environment.dispose();
    content.highlighter.dispose();
    disposeMaterials(content.materials);
    disposeMaterials(content.seatMaterials);
  }

  private buildSeats(materials: SeatMaterials, level: QualityLevel): [SeatModel, SeatInstances] {
    const model = createCinemaSeatModel(this.layout.config, materials, this.layout.config.quality[level].seat);
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

  private async withSavedCamera<T>(run: () => Promise<T>): Promise<T> {
    const { camera, controls } = this.rig;
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone() };
    try {
      return await run();
    } finally {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      controls.target.copy(saved.target);
      this.host.requestRender();
    }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

