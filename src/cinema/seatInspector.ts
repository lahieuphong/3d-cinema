import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  GridHelper,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  Scene,
  Sphere,
  Vector3,
} from 'three';
import { CameraRig } from './cameraRig.ts';
import { AUDITORIUM_CONFIG } from './config.ts';
import { createInteriorEnvironment, type InteriorEnvironment } from './environment.ts';
import { toRadians, type SeatData, type Vec3 } from './layout.ts';
import { createStudioLighting, type StudioLighting } from './lighting.ts';
import { createSeatMaterials, disposeMaterials, type SeatMaterials } from './materials.ts';
import { loadQuality, QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from './quality.ts';
import { prefersReducedMotion, RenderHost, WebGLUnavailableError, type ViewStatus } from './renderHost.ts';
import { computeSeatModelBounds, createCinemaSeatModel, createSeatInstances, type SeatInstances, type SeatModel } from './seats.ts';
import { el, group, renderStatus, switchControl } from './ui.ts';

/**
 * Development seat inspector (/cinema?inspect=seat): the auditorium's seat model on a neutral
 * floor, with fixed views, orbit, an optional three-seat cluster, footprint and measured dimensions,
 * at either quality level. It uses the same SeatModel, materials, instancing, tone mapping and
 * reflection environment as the auditorium, under neutral studio lighting, and replaces the
 * auditorium while open, so only one renderer ever exists.
 */

export type InspectorViewId = 'front' | 'side' | 'back' | 'top' | 'cup';

const VIEWS: ReadonlyArray<{ id: InspectorViewId; label: string }> = [
  { id: 'front', label: 'Trước 3/4' },
  { id: 'side', label: 'Bên' },
  { id: 'back', label: 'Sau 3/4' },
  { id: 'top', label: 'Từ trên' },
  { id: 'cup', label: 'Cận hốc cốc' },
];

const config = AUDITORIUM_CONFIG;
const inspector = config.inspector;

/** Seats laid out like one auditorium row, centre seat first so drawing one instance shows it alone. */
function createInspectorSeats(): SeatData[] {
  const offsets = [0];
  for (let k = 1; offsets.length < inspector.clusterSize; k++) offsets.push(-k, k);
  const centre = Math.floor(inspector.clusterSize / 2);
  return offsets.slice(0, inspector.clusterSize).map((offset, index) => ({
    id: `X${String(centre + offset + 1).padStart(2, '0')}`,
    index,
    rowIndex: 0,
    columnIndex: centre + offset,
    rowLabel: 'X',
    seatNumber: centre + offset + 1,
    position: { x: offset * config.seating.seatPitch, y: 0, z: 0 },
    yaw: 0,
    floorY: 0,
  }));
}

interface InspectorViewCallbacks {
  onStatus(status: ViewStatus): void;
  onTransitionChange(active: boolean): void;
}

class SeatInspectorView {
  private readonly host: RenderHost;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly callbacks: InspectorViewCallbacks;
  private readonly materials: SeatMaterials;
  private model: SeatModel;
  private readonly seats = createInspectorSeats();
  private instances: SeatInstances;
  private readonly lighting: StudioLighting;
  private environment: InteriorEnvironment;
  private modelBounds: Box3;
  private quality: QualityLevel;
  private readonly floor: Mesh<CircleGeometry, MeshStandardMaterial>;
  private readonly grid: GridHelper;
  private readonly footprint: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly boundsBox: LineSegments<BufferGeometry, LineBasicMaterial>;
  private cluster = false;
  private reportedTransition = false;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: InspectorViewCallbacks, quality: QualityLevel) {
    this.callbacks = callbacks;
    this.quality = quality;
    this.host = new RenderHost(container, {
      background: inspector.background,
      maxPixelRatio: config.quality[quality].maxPixelRatio,
      ariaLabel: 'Khung nhìn 3D của mẫu ghế. Kéo để xoay, cuộn hoặc chụm để thu phóng.',
      onResize: (width, height) => this.rig.setAspect(width / height),
      onFrame: (time) => this.renderFrame(time),
      onStatus: (status) => callbacks.onStatus(status),
      onContextRestored: () => this.handleContextRestored(),
    });
    const { renderer } = this.host;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = config.render.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    let environment: InteriorEnvironment | null = null;
    try {
      this.materials = createSeatMaterials();
      [this.model, this.instances] = this.buildSeats(quality);
      this.modelBounds = computeSeatModelBounds(this.model);
      this.lighting = createStudioLighting();
      this.lighting.setShadowQuality(config.quality[quality].shadowMapSize, config.quality[quality].shadowRadius);
      environment = createInteriorEnvironment(renderer);
      this.environment = environment;
      this.scene.environment = environment.texture;

      this.floor = new Mesh(
        new CircleGeometry(inspector.floorRadius, 64),
        // Pushed back in depth so the grid and footprint lines drawn at floor level stay on top.
        new MeshStandardMaterial({ color: 0x8b8e94, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      );
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.receiveShadow = true;
      this.grid = new GridHelper(inspector.gridSize, inspector.gridDivisions, 0x5b5f66, 0x71757c);
      this.footprint = new LineSegments(footprintGeometry(this.seats), new LineBasicMaterial({ color: 0xd8b65a }));
      this.boundsBox = new LineSegments(boxEdgesGeometry(this.modelBounds), new LineBasicMaterial({ color: 0x5ec8e5 }));
      this.footprint.visible = false;
      this.boundsBox.visible = false;
      this.scene.add(this.floor, this.grid, this.footprint, this.boundsBox, this.instances.group, this.lighting.group);

      this.rig = new CameraRig(inspector.camera, this.host.canvas, this.focusCentre());
    } catch (error) {
      environment?.dispose();
      this.host.dispose();
      throw error;
    }
    this.setCluster(false);
    renderer.shadowMap.needsUpdate = true;
    this.rig.controls.addEventListener('change', this.host.requestRender);
    this.host.start();
  }

  setView(id: InspectorViewId, animate: boolean): void {
    const camera = inspector.camera;
    const direction = new Vector3().copy(camera.views[id]).normalize();
    let target: Vector3;
    let distance: number;
    if (id === 'cup') {
      target = this.model.cupHolder.center.clone();
      distance = camera.cupDistance;
    } else {
      const sphere = this.visibleBounds().getBoundingSphere(new Sphere());
      target = sphere.center;
      // Fit the bounding sphere inside the narrower of the two fields of view.
      const vertical = toRadians(this.rig.camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.rig.camera.aspect);
      distance = (sphere.radius * camera.fitMargin) / Math.sin(Math.min(vertical, horizontal) / 2);
    }
    const position = target.clone().addScaledVector(direction, distance);
    this.rig.moveTo({ position, lookAt: target, mode: 'orbit' }, animate && !prefersReducedMotion());
    this.reportTransition();
    this.host.requestRender();
  }

  /** Shows the centre seat alone or the whole cluster at the auditorium's seat pitch. */
  setCluster(on: boolean): void {
    this.cluster = on;
    const count = on ? this.seats.length : 1;
    for (const mesh of this.instances.meshes) mesh.count = count;
    this.footprint.geometry.setDrawRange(0, 8 * count);
    this.invalidateShadows();
  }

  /** Rebuilds the seats at the other level of detail, keeping view, cluster and overlays. */
  setQuality(level: QualityLevel): void {
    if (level === this.quality || this.disposed) return;
    this.quality = level;
    this.scene.remove(this.instances.group);
    this.instances.dispose();
    this.model.dispose();
    [this.model, this.instances] = this.buildSeats(level);
    this.modelBounds = computeSeatModelBounds(this.model);
    this.boundsBox.geometry.dispose();
    this.boundsBox.geometry = boxEdgesGeometry(this.modelBounds);
    this.scene.add(this.instances.group);
    this.setCluster(this.cluster);
    this.lighting.setShadowQuality(config.quality[level].shadowMapSize, config.quality[level].shadowRadius);
    this.host.setMaxPixelRatio(config.quality[level].maxPixelRatio);
    this.invalidateShadows();
  }

  setFootprintVisible(visible: boolean): void {
    this.footprint.visible = visible;
    this.host.requestRender();
  }

  setBoundsVisible(visible: boolean): void {
    this.boundsBox.visible = visible;
    this.host.requestRender();
  }

  /** Dimensions measured from the built geometry, in metres. */
  measure() {
    const size = this.modelBounds.getSize(new Vector3());
    const component = (name: string) => this.model.components.find((c) => c.name === name)!.bounds;
    const cushion = component('cushion');
    const armrest = component('armrest-left');
    return {
      width: size.x,
      depth: size.z,
      height: size.y,
      seatHeight: cushion.max.y,
      cushionWidth: cushion.max.x - cushion.min.x,
      armrestHeight: armrest.max.y,
      gapToNeighbour: config.seating.seatPitch - size.x,
      footprint: { width: config.seat.footprintWidth, depth: config.seat.footprintDepth },
      reclineDeg: config.seat.model.backrest.reclineDeg,
    };
  }

  getDebugState() {
    const { camera, controls } = this.rig;
    return {
      cluster: this.cluster,
      footprint: this.footprint.visible,
      bounds: this.boundsBox.visible,
      transitioning: this.rig.isTransitioning,
      camera: { position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov, aspect: camera.aspect },
      seats: this.instances.meshes[0].count,
      quality: this.quality,
      trianglesPerSeat: this.model.parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? 0) / 3, 0),
      measured: this.measure(),
      ...this.host.getDebugInfo(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rig.controls.removeEventListener('change', this.host.requestRender);
    this.rig.dispose();
    this.scene.clear();
    this.scene.environment = null;
    this.instances.dispose();
    this.model.dispose();
    disposeMaterials(this.materials);
    this.lighting.dispose();
    this.environment.dispose();
    for (const object of [this.floor, this.footprint, this.boundsBox]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.grid.dispose();
    this.host.dispose();
  }

  private visibleBounds(): Box3 {
    const bounds = new Box3();
    const count = this.cluster ? this.seats.length : 1;
    for (const seat of this.seats.slice(0, count)) {
      bounds.union(this.modelBounds.clone().translate(new Vector3(seat.position.x, seat.position.y, seat.position.z)));
    }
    return bounds;
  }

  private focusCentre(): Vec3 {
    const centre = this.modelBounds.getCenter(new Vector3());
    return { x: centre.x, y: centre.y, z: centre.z };
  }

  private buildSeats(level: QualityLevel): [SeatModel, SeatInstances] {
    const model = createCinemaSeatModel(config, this.materials, config.quality[level].seat);
    const instances = createSeatInstances(model, this.seats);
    for (const mesh of instances.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return [model, instances];
  }

  /** Rebuilds the environment lost with the old context (see CinemaView.handleContextRestored). */
  private handleContextRestored(): void {
    this.environment = createInteriorEnvironment(this.host.renderer);
    this.scene.environment = this.environment.texture;
    this.invalidateShadows();
  }

  private invalidateShadows(): void {
    this.host.renderer.shadowMap.needsUpdate = true;
    this.host.requestRender();
  }

  private renderFrame(time: number): boolean {
    const needsAnotherFrame = this.rig.update(time);
    this.host.renderer.render(this.scene, this.rig.camera);
    this.reportTransition();
    return needsAnotherFrame;
  }

  private reportTransition(): void {
    const active = this.rig.isTransitioning;
    if (active === this.reportedTransition) return;
    this.reportedTransition = active;
    this.callbacks.onTransitionChange(active);
  }
}

/** One footprint rectangle per seat, just above the floor. */
function footprintGeometry(seats: SeatData[]): BufferGeometry {
  const halfW = config.seat.footprintWidth / 2;
  const halfD = config.seat.footprintDepth / 2;
  const y = 0.002;
  const positions: number[] = [];
  for (const { position: p } of seats) {
    const corners = [
      [p.x - halfW, p.z - halfD],
      [p.x + halfW, p.z - halfD],
      [p.x + halfW, p.z + halfD],
      [p.x - halfW, p.z + halfD],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      positions.push(ax, y, az, bx, y, bz);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function boxEdgesGeometry(box: Box3): BufferGeometry {
  const { min, max } = box;
  const c = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [min.x, min.y, max.z],
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
  ];
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(edges.flatMap((i) => c[i]), 3));
  return geometry;
}

const millimetreFormat = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const metres = (value: number) => `${millimetreFormat.format(value)} m`;

declare global {
  interface Window {
    /** Development-only inspection hook used by `npm run capture`. */
    __seatInspector?: { getState(): unknown };
  }
}

/** Mounts the seat inspector into `host`. Returns a function that tears everything down. */
export function mountSeatInspector(host: HTMLElement, { onClose }: { onClose(): void }): () => void {
  document.title = 'Duyệt mẫu ghế · Phòng chiếu 3D';
  const listeners = new AbortController();
  const { signal } = listeners;

  const root = el('div', 'cinema-app cinema-app--inspector');
  const header = el('header', 'cinema-header');
  const title = el('h1', 'cinema-title', 'Duyệt mẫu ghế');
  title.append(' ', el('span', 'cinema-badge', 'Chế độ phát triển'));
  const closeButton = el('button', 'cinema-button', 'Đóng');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.addEventListener('click', () => onClose(), { signal });
  header.append(title, closeButton);

  const toolbar = el('div', 'cinema-toolbar');
  const viewGroup = group('Góc nhìn mẫu ghế');
  const viewButtons = new Map<InspectorViewId, HTMLButtonElement>();
  for (const view of VIEWS) {
    const button = el('button', 'cinema-button', view.label);
    button.type = 'button';
    button.dataset.view = view.id;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectView(view.id, true), { signal });
    viewButtons.set(view.id, button);
    viewGroup.append(button);
  }
  const displayGroup = group('Hiển thị');
  const clusterSwitch = switchControl(`${inspector.clusterSize} ghế`, 'cluster', false, (on) => setCluster(on), signal);
  const footprintSwitch = switchControl('Footprint', 'footprint', false, (on) => setFootprint(on), signal);
  const dimensionsSwitch = switchControl('Kích thước', 'dimensions', false, (on) => setDimensions(on), signal);
  displayGroup.append(clusterSwitch.wrapper, footprintSwitch.wrapper, dimensionsSwitch.wrapper);
  const qualityGroup = group('Chất lượng mẫu ghế');
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const button = el('button', 'cinema-button cinema-button--compact', QUALITY_LABELS[level]);
    button.type = 'button';
    button.dataset.quality = level;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setQuality(level), { signal });
    qualityButtons.set(level, button);
    qualityGroup.append(button);
  }
  toolbar.append(viewGroup, displayGroup, qualityGroup);

  const stage = el('main', 'cinema-stage');
  const viewport = el('div', 'cinema-viewport');
  const dimensions = el('dl', 'cinema-dimensions');
  dimensions.hidden = true;
  const caption = el(
    'p',
    'cinema-caption',
    'Cùng mẫu ghế và vật liệu với 110 ghế trong khán phòng. Kéo để xoay, cuộn hoặc chụm để thu phóng. Esc để đóng.',
  );
  const status = el('div', 'cinema-status');
  stage.append(viewport, dimensions, caption, status);
  root.append(header, toolbar, stage);
  host.replaceChildren(root);

  const controls = [...viewButtons.values(), clusterSwitch.input, footprintSwitch.input, dimensionsSwitch.input, ...qualityButtons.values()];
  const setStatus = (next: Parameters<typeof renderStatus>[2]) => {
    renderStatus(root, status, next);
    if (next.kind === 'error') for (const control of controls) control.disabled = true;
  };
  setStatus({ kind: 'loading' });
  root.dataset.transitioning = 'false';

  let view: SeatInspectorView | null = null;
  const initialQuality = loadQuality().level;
  let activeView: InspectorViewId = 'front';

  function selectView(id: InspectorViewId, animate: boolean) {
    activeView = id;
    root.dataset.view = id;
    for (const [viewId, button] of viewButtons) button.setAttribute('aria-pressed', String(viewId === id));
    view?.setView(id, animate);
  }
  function setCluster(on: boolean) {
    root.dataset.cluster = String(on);
    view?.setCluster(on);
    // Re-frame so the whole cluster (or the single seat) fills the view.
    if (activeView !== 'cup') selectView(activeView, true);
  }
  function setFootprint(on: boolean) {
    root.dataset.footprint = String(on);
    view?.setFootprintVisible(on);
  }
  // Compares the two levels here; the auditorium's stored choice is left alone.
  function setQuality(level: QualityLevel) {
    root.dataset.quality = level;
    for (const [value, button] of qualityButtons) button.setAttribute('aria-pressed', String(value === level));
    view?.setQuality(level);
  }
  function setDimensions(on: boolean) {
    root.dataset.dimensions = String(on);
    dimensions.hidden = !on;
    view?.setBoundsVisible(on);
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') onClose();
    },
    { signal },
  );

  try {
    view = new SeatInspectorView(viewport, {
      onStatus: (next) => setStatus(next),
      onTransitionChange: (active) => (root.dataset.transitioning = String(active)),
    }, initialQuality);
    const m = view.measure();
    dimensions.replaceChildren(
      ...[
        ['Rộng × sâu × cao', `${metres(m.width)} × ${metres(m.depth)} × ${metres(m.height)}`],
        ['Footprint', `${metres(m.footprint.width)} × ${metres(m.footprint.depth)}`],
        ['Khe với ghế bên cạnh', metres(m.gapToNeighbour)],
        ['Mặt ngồi cao', metres(m.seatHeight)],
        ['Đệm ngồi rộng', metres(m.cushionWidth)],
        ['Tay vịn cao', metres(m.armrestHeight)],
        ['Tựa lưng ngả', `${m.reclineDeg}°`],
      ].flatMap(([term, value]) => [el('dt', '', term), el('dd', '', value)]),
    );
    // The view starts with one seat and no overlays; mirror that before the first frame.
    root.dataset.cluster = 'false';
    root.dataset.footprint = 'false';
    root.dataset.dimensions = 'false';
    setQuality(initialQuality);
    selectView(activeView, false);
  } catch (error) {
    console.error('[cinema] Could not start the seat inspector:', error);
    const message =
      error instanceof WebGLUnavailableError ? error.message : 'Đã xảy ra lỗi khi dựng cảnh. Xem chi tiết trong console.';
    setStatus({ kind: 'error', message });
  }

  if (import.meta.env.DEV) {
    window.__seatInspector = {
      getState: () => ({ view: activeView, canvasCount: document.querySelectorAll('canvas').length, inspector: view?.getDebugState() ?? null }),
    };
  }

  return () => {
    listeners.abort();
    view?.dispose();
    view = null;
    root.remove();
    if (import.meta.env.DEV) delete window.__seatInspector;
  };
}
