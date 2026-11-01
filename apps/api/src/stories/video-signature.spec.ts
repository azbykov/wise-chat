import { SAMPLE_MP4, SAMPLE_WEBM } from '../../test/helpers/videos';
import { detectVideoType } from './video-signature';

describe('detectVideoType', () => {
  it('recognizes WebM by its EBML header and document type', () => {
    expect(detectVideoType(SAMPLE_WEBM)).toEqual({ mimeType: 'video/webm', extension: 'webm' });
  });

  it('recognizes MP4 by its ftyp box', () => {
    expect(detectVideoType(SAMPLE_MP4)).toEqual({ mimeType: 'video/mp4', extension: 'mp4' });
  });

  it('refuses Matroska that is not WebM, and anything else', () => {
    const mkv = Buffer.concat([
      SAMPLE_WEBM.subarray(0, 12),
      Buffer.from('matroska'),
      Buffer.alloc(60),
    ]);
    expect(detectVideoType(mkv)).toBeNull();
    expect(detectVideoType(Buffer.from('<html>not a video</html>'))).toBeNull();
    expect(detectVideoType(Buffer.alloc(0))).toBeNull();
  });
});
