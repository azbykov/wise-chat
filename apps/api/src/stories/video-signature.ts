export interface VideoType {
  mimeType: 'video/webm' | 'video/mp4';
  extension: 'webm' | 'mp4';
}

const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/**
 * What the file is, judged by its first bytes, not by the name or type the client sent.
 * Only the two formats browsers record: WebM (Chrome, Firefox) and MP4 (Safari).
 */
export function detectVideoType(data: Buffer): VideoType | null {
  // WebM is EBML with the document type "webm", declared within the first few dozen bytes.
  if (data.subarray(0, 4).equals(EBML_MAGIC) && data.subarray(0, 64).includes('webm')) {
    return { mimeType: 'video/webm', extension: 'webm' };
  }
  // MP4 (ISO base media) starts with a box of type "ftyp" at offset 4.
  if (data.length >= 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') {
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  return null;
}
