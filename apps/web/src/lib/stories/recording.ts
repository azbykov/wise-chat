/** Longest story the recorder makes; the server allows a little slack on top. */
export const MAX_STORY_MS = 15_000;

/**
 * Formats in order of preference. H.264 with AAC in MP4 plays in every browser and comes
 * with its duration; Chrome and Safari both record it. WebM is for Firefox, which records
 * nothing else, and gets fixed up before upload (see recordedWebm.ts).
 */
const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** The first format this browser can record, or null when it cannot record at all. */
export function pickRecordingType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string | null {
  return CANDIDATES.find((type) => isTypeSupported(type)) ?? null;
}

/** What to tell the user when the camera does not start. */
export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow it in the browser’s site settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is busy in another app or tab.';
  }
  return 'The camera could not be started.';
}
