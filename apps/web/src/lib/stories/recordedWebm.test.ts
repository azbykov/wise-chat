import { describe, expect, it } from 'vitest';
import { fixRecordedWebm, markAudioKeyframes, setWebmDuration } from './recordedWebm';

const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** An element with a one-byte size. */
const el = (id: number[], ...data: number[][]) => [
  ...id,
  0x80 | data.flat().length,
  ...data.flat(),
];
/** An element with an unknown size, as browsers stream the Segment and each Cluster. */
const open = (id: number[], ...data: number[][]) => [...id, ...UNKNOWN, ...data.flat()];

const HEADER = el(
  [0x1a, 0x45, 0xdf, 0xa3],
  el(
    [0x42, 0x82],
    [...'webm'].map((c) => c.charCodeAt(0)),
  ),
);
const SEGMENT = [0x18, 0x53, 0x80, 0x67];
const INFO = [0x15, 0x49, 0xa9, 0x66];
const TIMECODE_SCALE = el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]);
const MUXING_APP = el([0x4d, 0x80], [0x43, 0x68]);
const track = (number: number, type: number) =>
  el([0xae], el([0xd7], [number]), el([0x83], [type]));
/** Video on track 1, audio on track 2. */
const TRACKS = el([0x16, 0x54, 0xae, 0x6b], track(1, 1), track(2, 2));
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
/** A SimpleBlock: track, a 2-byte timecode, flags, then the frame. */
const block = (trackNumber: number, flags: number) =>
  el([0xa3], [0x80 | trackNumber, 0, 0, flags, 0xaa, 0xbb]);
const KEY = 0x80;

/** What Firefox records: no duration, unknown sizes, audio blocks without the key flag. */
const CLUSTERS = [
  ...open(CLUSTER, el([0xe7], [0]), block(1, KEY), block(2, 0)),
  ...open(CLUSTER, el([0xe7], [0x10]), block(2, 0), block(1, 0)),
];
const recording = () =>
  new Uint8Array([
    ...HEADER,
    ...open(SEGMENT, el(INFO, TIMECODE_SCALE, MUXING_APP), TRACKS, CLUSTERS),
  ]);

function durationOf(bytes: Uint8Array): number | null {
  for (let i = 0; i + 11 <= bytes.length; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) {
      return new DataView(bytes.buffer, bytes.byteOffset + i + 3, 8).getFloat64(0);
    }
  }
  return null;
}

/** Track and keyframe flag of every SimpleBlock, in order. */
function blocksOf(bytes: Uint8Array) {
  const blocks: string[] = [];
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === 0xa3 && bytes[i + 1] === 0x86) {
      blocks.push(`${bytes[i + 2]! & 0x7f}${bytes[i + 5]! & KEY ? ' key' : ''}`);
      i += 7;
    }
  }
  return blocks;
}

const endsWith = (bytes: Uint8Array, tail: number[]) =>
  Array.from(bytes.subarray(bytes.length - tail.length)).every((b, i) => b === tail[i]);

describe('setWebmDuration', () => {
  it('adds the duration in milliseconds at the default timecode scale', () => {
    expect(durationOf(setWebmDuration(recording(), 9526))).toBe(9526);
  });

  it('keeps the unknown sizes and every byte after Info as they were', () => {
    const fixed = setWebmDuration(recording(), 3000);
    const segmentAt = HEADER.length;
    expect(Array.from(fixed.subarray(segmentAt, segmentAt + 12))).toEqual([...SEGMENT, ...UNKNOWN]);
    expect(endsWith(fixed, [...TRACKS, ...CLUSTERS])).toBe(true);
  });

  it('keeps the other Info fields', () => {
    const text = Array.from(setWebmDuration(recording(), 3000)).join(',');
    expect(text).toContain(TIMECODE_SCALE.join(','));
    expect(text).toContain(MUXING_APP.join(','));
  });

  it('converts to the file’s own timecode scale', () => {
    const microseconds = el([0x2a, 0xd7, 0xb1], [0x03, 0xe8]); // 1000 ns
    const file = new Uint8Array([...HEADER, ...open(SEGMENT, el(INFO, microseconds), CLUSTERS)]);
    expect(durationOf(setWebmDuration(file, 2000))).toBe(2_000_000);
  });

  it('grows a known Segment size along with Info', () => {
    const body = [...el(INFO, TIMECODE_SCALE), ...TRACKS];
    const file = new Uint8Array([...HEADER, ...SEGMENT, 0x80 | body.length, ...body]);
    const fixed = setWebmDuration(file, 1000);
    const sizeField = fixed.subarray(HEADER.length + 4, HEADER.length + 12);
    const size = Array.from(sizeField.subarray(1)).reduce((total, b) => total * 256 + b, 0);
    expect(sizeField[0]).toBe(0x01);
    expect(HEADER.length + 12 + size).toBe(fixed.length);
  });

  it('leaves a file that already has a duration alone', () => {
    const fixed = setWebmDuration(recording(), 3000);
    expect(setWebmDuration(fixed, 5000)).toBe(fixed);
  });

  it('replaces a zero duration', () => {
    const zero = el([0x44, 0x89], [0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new Uint8Array([
      ...HEADER,
      ...open(SEGMENT, el(INFO, TIMECODE_SCALE, zero), CLUSTERS),
    ]);
    expect(durationOf(setWebmDuration(file, 4000))).toBe(4000);
  });

  it.each([
    ['an MP4', new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])],
    ['an empty file', new Uint8Array()],
    ['a cut-off header', recording().subarray(0, 20)],
    ['no Info before the first cluster', new Uint8Array([...HEADER, ...open(SEGMENT, CLUSTERS)])],
  ])('returns %s unchanged', (_case, input) => {
    expect(setWebmDuration(input, 1000)).toBe(input);
  });
});

describe('markAudioKeyframes', () => {
  it('marks every audio block as a keyframe and leaves video as it was', () => {
    expect(blocksOf(recording())).toEqual(['1 key', '2', '2', '1']);
    expect(blocksOf(markAudioKeyframes(recording()))).toEqual(['1 key', '2 key', '2 key', '1']);
  });

  it('changes nothing but the flags', () => {
    const input = recording();
    const fixed = markAudioKeyframes(input);
    expect(fixed.length).toBe(input.length);
    const changed = Array.from(fixed).filter((b, i) => b !== input[i]);
    expect(changed).toHaveLength(2);
    expect(input).toEqual(recording());
  });

  it('works through clusters with known sizes too', () => {
    const clusters = [
      ...el(CLUSTER, el([0xe7], [0]), block(2, 0)),
      ...el(CLUSTER, el([0xe7], [0x10]), block(2, 0)),
    ];
    const file = new Uint8Array([...HEADER, ...open(SEGMENT, TRACKS, clusters)]);
    expect(blocksOf(markAudioKeyframes(file))).toEqual(['2 key', '2 key']);
  });

  it('returns a file that needs nothing as it is', () => {
    const chrome = new Uint8Array([
      ...HEADER,
      ...open(SEGMENT, TRACKS, open(CLUSTER, el([0xe7], [0]), block(1, KEY), block(2, KEY))),
    ]);
    expect(markAudioKeyframes(chrome)).toBe(chrome);
    const silent = new Uint8Array([
      ...HEADER,
      ...open(SEGMENT, el([0x16, 0x54, 0xae, 0x6b], track(1, 1)), CLUSTERS),
    ]);
    expect(markAudioKeyframes(silent)).toBe(silent);
  });

  it.each([
    ['an MP4', new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])],
    ['no Tracks', new Uint8Array([...HEADER, ...open(SEGMENT, CLUSTERS)])],
    ['a cut-off file', recording().subarray(0, 60)],
  ])('returns %s unchanged', (_case, input) => {
    expect(markAudioKeyframes(input)).toBe(input);
  });
});

describe('fixRecordedWebm', () => {
  it('sets the duration, marks audio keyframes and keeps the blob type', async () => {
    const blob = new Blob([recording()], { type: 'video/webm;codecs=vp8,opus' });
    const fixed = await fixRecordedWebm(blob, 1500);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    expect(fixed.type).toBe('video/webm;codecs=vp8,opus');
    expect(durationOf(bytes)).toBe(1500);
    expect(blocksOf(bytes)).toEqual(['1 key', '2 key', '2 key', '1']);
  });
});
