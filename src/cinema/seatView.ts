import type { CameraPose } from './cameraPresets.ts';
import { seatEyePosition, type AuditoriumLayout, type SeatData } from './layout.ts';

/**
 * Camera pose for viewing from `seat`: at the seated eye (`seatEyePosition`: `viewer.eyeHeight`
 * above the seat's own floor, set back towards the backrest, turned with the seat's yaw), looking
 * at the centre of the picture, in look-around mode (dragging turns the head, the eye never moves).
 *
 * It depends only on SeatData and config, so it is the same at both quality levels; tests check the
 * eye stays clear of the seat's cushion, backrest and headrest at both levels and sees the screen
 * over the row in front. Used for F06 now and for any selected seat in Prompt 06.
 */
export function seatViewPose(layout: AuditoriumLayout, seat: SeatData): CameraPose {
  return { position: seatEyePosition(layout, seat), lookAt: { ...layout.screen.center }, mode: 'eye' };
}
