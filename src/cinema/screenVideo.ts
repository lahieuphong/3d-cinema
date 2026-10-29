import {
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  VideoTexture,
} from 'three';
import type { AuditoriumLayout } from './layout.ts';
import type { MediaSnapshot } from './mediaController.ts';

/** Width and height of a picture of aspect `aspect` fitted inside `width × height` (contain). */
export function containSize(aspect: number, width: number, height: number): { width: number; height: number } {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return { width, height };
  return aspect >= width / height ? { width, height: width / aspect } : { width: height * aspect, height };
}

/** What the screen shows: the poster until a video frame exists and playback has begun. */
export type ScreenContent = 'blank' | 'poster' | 'video';

export function screenContent(snapshot: MediaSnapshot, posterReady: boolean): ScreenContent {
  if (snapshot.started && snapshot.hasFrame && snapshot.state !== 'error') return 'video';
  return posterReady ? 'poster' : 'blank';
}

/** The poster image is decoded and has a size (a failed load never does). */
export function imageReady(image: HTMLImageElement | null): boolean {
  return image !== null && image.complete && image.naturalWidth > 0;
}

function posterTexture(image: HTMLImageElement): Texture {
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The film on the screen, in front of the room's screen surface (which is left untouched):
 * - a black matte over the whole picture area (2 mm in front), so letterbox and pillarbox bars are
 *   black and nothing of the lit blank screen shows around a film of another shape;
 * - the picture itself (4 mm in front), scaled to fit inside the 16:9 picture area without
 *   stretching or cropping, recomputed when the video's size is known or changes.
 * Both sit behind the face of the screen frame (it stands 3 cm proud), far enough apart for the
 * depth buffer at any viewing distance, so nothing flickers.
 *
 * Unlit and not tone-mapped, like the blank screen before: the video's sRGB colours are decoded
 * once by the texture and written out once by the renderer, so they match the same video shown by
 * the browser. The room's lighting is unchanged (the screen's area light keeps its fixed colour).
 * Until the first video frame (and after an error) the poster shows; until the poster has loaded,
 * the original blank screen does.
 *
 * GPU resources only: rebuilt with the rest of the scene after a lost context. The video element
 * and the poster image belong to the page and outlive it.
 */
export class ScreenVideo {
  readonly group = new Group();
  private readonly layout: AuditoriumLayout;
  private readonly picture: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly matte: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly videoTexture: VideoTexture;
  private readonly poster: HTMLImageElement | null;
  private posterTexture: Texture | null = null;
  private content: ScreenContent = 'blank';
  private aspect = 0;
  private disposed = false;

  constructor(layout: AuditoriumLayout, video: HTMLVideoElement, poster: HTMLImageElement | null) {
    this.layout = layout;
    this.poster = poster;
    this.group.name = 'screen-video';
    const { screen } = layout;
    const material = (color: number) => new MeshBasicMaterial({ color, toneMapped: false });
    this.matte = new Mesh(new PlaneGeometry(screen.width, screen.height), material(0x000000));
    this.matte.name = 'screen-video-matte';
    this.matte.position.set(screen.center.x, screen.center.y, screen.center.z + 0.002);
    this.picture = new Mesh(new PlaneGeometry(1, 1), material(0xffffff));
    this.picture.name = 'screen-video-picture';
    this.picture.position.set(screen.center.x, screen.center.y, screen.center.z + 0.004);
    for (const mesh of [this.matte, this.picture]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.matte.updateMatrix();

    // three r186: VideoTexture asks the element for every presented frame (requestVideoFrameCallback)
    // and marks itself for upload; it never asks for a render, the view's frame clock does that.
    this.videoTexture = new VideoTexture(video);
    this.videoTexture.colorSpace = SRGBColorSpace;
    this.videoTexture.minFilter = LinearFilter;
    this.videoTexture.magFilter = LinearFilter;
  }

  /** Shows poster or video for this media state; returns true if what is drawn changed. */
  update(snapshot: MediaSnapshot): boolean {
    if (this.disposed) return false;
    // Once a poster has been up, it stays while the next film's is loading (the image still holds
    // the last picture until the new one is decoded; a failed one leaves it empty).
    const posterReady = imageReady(this.poster) || (this.posterTexture !== null && this.poster!.naturalWidth > 0);
    const content = screenContent(snapshot, posterReady);
    const aspect =
      content === 'video' && snapshot.videoWidth > 0 && snapshot.videoHeight > 0
        ? snapshot.videoWidth / snapshot.videoHeight
        : content === 'poster'
          ? this.poster!.naturalWidth / this.poster!.naturalHeight
          : 16 / 9;
    if (content === this.content && aspect === this.aspect) return false;
    const material = this.picture.material;
    if (content === 'poster' && !this.posterTexture) this.posterTexture = posterTexture(this.poster!);
    // Upload the current frame now: the texture may not have had a frame callback yet.
    if (content === 'video' && this.content !== 'video') this.videoTexture.needsUpdate = true;
    this.content = content;
    this.aspect = aspect;
    const visible = content !== 'blank';
    this.matte.visible = visible;
    this.picture.visible = visible;
    material.map = content === 'video' ? this.videoTexture : content === 'poster' ? this.posterTexture : null;
    material.needsUpdate = true;
    const { width, height } = containSize(aspect, this.layout.screen.width, this.layout.screen.height);
    this.picture.scale.set(width, height, 1);
    this.picture.updateMatrix();
    return true;
  }

  /**
   * The poster image has (re)loaded — another film was chosen: its picture goes up in a new texture
   * (it may not be the size of the last one; the view then updates the shape). Returns true when the
   * poster is what the screen shows (the view then draws again).
   */
  refreshPoster(): boolean {
    if (this.disposed || !this.posterTexture) return false;
    this.posterTexture.dispose();
    this.posterTexture = posterTexture(this.poster!);
    if (this.content !== 'poster') return false;
    this.picture.material.map = this.posterTexture;
    this.picture.material.needsUpdate = true;
    return true;
  }

  /**
   * The element shows another frame without playing (seek or load while paused): upload it. While
   * playing the texture's own frame callback does this.
   */
  refreshFrame(snapshot: MediaSnapshot): boolean {
    if (this.disposed || this.content !== 'video' || !snapshot.hasFrame) return false;
    this.videoTexture.needsUpdate = true;
    return true;
  }

  /** Development/tests: what is shown, the picture size in metres and the screen's. */
  describe() {
    return {
      content: this.content,
      width: this.picture.scale.x,
      height: this.picture.scale.y,
      aspect: this.aspect,
      screen: { width: this.layout.screen.width, height: this.layout.screen.height },
      textureVersion: this.videoTexture.version,
    };
  }

  /** Releases what this player owns on the GPU (and the texture's frame callback). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.videoTexture.dispose();
    this.posterTexture?.dispose();
    for (const mesh of [this.matte, this.picture]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
