/**
 * Fixes two gaps in the WebM browsers record, so every browser plays and seeks it:
 *
 * - No duration: players show no length. It is added to the Info element.
 * - Firefox leaves the keyframe flag off its audio blocks. Opus frames all stand alone, and
 *   Chrome looks for that flag when it seeks in a file without an index: it fails with
 *   "demuxer seek failed", which it also hits when resuming a paused video it had put to
 *   sleep. The flag is set on every audio block.
 *
 * Everything else stays byte for byte, the "unknown" Segment and Cluster sizes of a streamed
 * recording included.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const AUDIO_TRACK = 2;
const CLUSTER = 0x1f43b675;
const SIMPLE_BLOCK = 0xa3;
const KEYFRAME = 0x80;

interface Element {
  id: number;
  start: number;
  /** Where the size field starts; the data follows it. */
  sizeStart: number;
  dataStart: number;
  /** null for an unknown size. */
  size: number | null;
}

/** An EBML variable-length integer; `marker` keeps the length bits, as element IDs do. */
function readVint(bytes: Uint8Array, offset: number, marker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (offset + length > bytes.length) return null;
  const mask = 0xff >> length;
  let value = marker ? first : first & mask;
  let allOnes = (first & mask) === mask;
  for (let i = 1; i < length; i++) {
    const byte = bytes[offset + i]!;
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  return { length, value, allOnes };
}

function readElement(bytes: Uint8Array, start: number): Element | null {
  const id = readVint(bytes, start, true);
  if (!id) return null;
  const sizeStart = start + id.length;
  const size = readVint(bytes, sizeStart, false);
  if (!size) return null;
  return {
    id: id.value,
    start,
    sizeStart,
    dataStart: sizeStart + size.length,
    size: size.allOnes ? null : size.value,
  };
}

function readUint(bytes: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[start + i]!;
  return value;
}

/** The children of an element with a known size; null if any of them is malformed. */
function childrenOf(bytes: Uint8Array, parent: Element): Element[] | null {
  if (parent.size === null) return null;
  const end = parent.dataStart + parent.size;
  if (end > bytes.length) return null;
  const children: Element[] = [];
  for (let offset = parent.dataStart; offset < end;) {
    const child = readElement(bytes, offset);
    if (!child || child.size === null || child.dataStart + child.size > end) return null;
    children.push(child);
    offset = child.dataStart + child.size;
  }
  return children;
}

/** The Segment and its elements up to the first cluster: Info, Tracks and the like. */
function readHead(bytes: Uint8Array) {
  const header = readElement(bytes, 0);
  if (header?.id !== EBML || header.size === null) return null;
  const segment = readElement(bytes, header.dataStart + header.size);
  if (segment?.id !== SEGMENT) return null;
  const elements: Element[] = [];
  let offset = segment.dataStart;
  while (offset < bytes.length) {
    const element = readElement(bytes, offset);
    if (!element) return null;
    if (element.id === CLUSTER) break;
    if (element.size === null) return null;
    elements.push(element);
    offset = element.dataStart + element.size;
  }
  return { segment, elements, firstCluster: offset };
}

/** A size field 8 bytes long, so it fits any value. */
function encodeSize(size: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, rest = size; i > 0; i--, rest = Math.floor(rest / 256)) out[i] = rest % 256;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The same WebM with its duration set. Returns the input untouched when it already has one
 * or does not look like the WebM a browser records.
 */
export function setWebmDuration(input: Uint8Array, durationMs: number): Uint8Array {
  const head = readHead(input);
  const info = head?.elements.find((element) => element.id === INFO);
  const fields = info && childrenOf(input, info);
  if (!head || !info || info.size === null || !fields) return input;
  const { segment } = head;
  const infoEnd = info.dataStart + info.size;

  let timecodeScale = 1_000_000;
  const kept: Uint8Array[] = [];
  for (const field of fields) {
    const size = field.size!;
    if (field.id === DURATION) {
      const view = new DataView(input.buffer, input.byteOffset + field.dataStart, size);
      const existing = size === 8 ? view.getFloat64(0) : view.getFloat32(0);
      if (existing > 0) return input;
      continue;
    }
    if (field.id === TIMECODE_SCALE) {
      timecodeScale = readUint(input, field.dataStart, size) || timecodeScale;
    }
    kept.push(input.subarray(field.start, field.dataStart + size));
  }

  // Duration is a float in timecode-scale units (nanoseconds each).
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / timecodeScale);
  const infoBody = concat([...kept, duration]);
  const newInfo = concat([
    input.subarray(info.start, info.sizeStart),
    encodeSize(infoBody.length),
    infoBody,
  ]);

  // An unknown Segment size stays unknown; a known one grows with Info.
  const segmentHeader =
    segment.size === null
      ? input.subarray(segment.start, segment.dataStart)
      : concat([
          input.subarray(segment.start, segment.sizeStart),
          encodeSize(segment.size + newInfo.length - (infoEnd - info.start)),
        ]);

  return concat([
    input.subarray(0, segment.start),
    segmentHeader,
    input.subarray(segment.dataStart, info.start),
    newInfo,
    input.subarray(infoEnd),
  ]);
}

/** Track numbers of the audio tracks. */
function audioTracks(bytes: Uint8Array, tracks: Element): Set<number> {
  const numbers = new Set<number>();
  for (const entry of childrenOf(bytes, tracks) ?? []) {
    if (entry.id !== TRACK_ENTRY) continue;
    const fields = childrenOf(bytes, entry) ?? [];
    const field = (id: number) => {
      const found = fields.find((f) => f.id === id);
      return found ? readUint(bytes, found.dataStart, found.size!) : null;
    };
    const number = field(TRACK_NUMBER);
    if (number !== null && field(TRACK_TYPE) === AUDIO_TRACK) numbers.add(number);
  }
  return numbers;
}

/**
 * The same WebM with every audio block marked as a keyframe. Returns the input untouched
 * when there is nothing to mark or it does not look like the WebM a browser records.
 */
export function markAudioKeyframes(input: Uint8Array): Uint8Array {
  const head = readHead(input);
  const tracks = head?.elements.find((element) => element.id === TRACKS);
  if (!head || !tracks) return input;
  const audio = audioTracks(input, tracks);
  if (audio.size === 0) return input;

  let out: Uint8Array | null = null;
  // Clusters hold only blocks, so one flat pass steps into each cluster, whatever its size.
  for (let offset = head.firstCluster; offset < input.length;) {
    const element = readElement(input, offset);
    if (!element) break;
    if (element.id === CLUSTER) {
      offset = element.dataStart;
      continue;
    }
    if (element.size === null) break;
    if (element.id === SIMPLE_BLOCK) {
      // Track number, a 2-byte timecode, then the flags.
      const track = readVint(input, element.dataStart, false);
      const flagsAt = element.dataStart + (track?.length ?? 0) + 2;
      const flags = input[flagsAt];
      if (track && flags !== undefined && audio.has(track.value) && !(flags & KEYFRAME)) {
        out ??= input.slice();
        out[flagsAt] = flags | KEYFRAME;
      }
    }
    offset = element.dataStart + element.size;
  }
  return out ?? input;
}

/** A recorded WebM blob that every browser plays and seeks. */
export async function fixRecordedWebm(blob: Blob, durationMs: number): Promise<Blob> {
  const bytes = setWebmDuration(
    markAudioKeyframes(new Uint8Array(await blob.arrayBuffer())),
    durationMs,
  );
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: blob.type });
}
