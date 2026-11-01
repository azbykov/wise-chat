import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { RealtimeService } from '../src/realtime/realtime.service';
import { StoriesCleanupJob } from '../src/stories/stories-cleanup.job';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type TestUser } from './helpers/users';
import { SAMPLE_MP4, SAMPLE_WEBM } from './helpers/videos';

describe('stories', () => {
  let t: TestApp;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    [alice, bob, carol] = await Promise.all([
      registerUser(t.http, 'alice'),
      registerUser(t.http, 'bob'),
      registerUser(t.http, 'carol'),
    ]);
  });

  afterAll(async () => {
    await t.close();
  });

  const db = () => t.app.get<Connection>(getConnectionToken());
  const files = () => readdirSync(process.env.UPLOADS_DIR!);

  function upload(user: TestUser, video: Buffer | null, durationMs: number | string = 5000) {
    const req = request(t.http).post('/api/stories').set(user.auth);
    if (video)
      req.attach('video', video, { filename: 'clip.bin', contentType: 'application/octet-stream' });
    return req.field('durationMs', String(durationMs));
  }

  const feed = async (user: TestUser) =>
    (await request(t.http).get('/api/stories/feed').set(user.auth).expect(200)).body as {
      author: { id: string; username: string };
      stories: { id: string; mimeType: string; seen: boolean }[];
    }[];

  async function expire(storyId: string) {
    await db()
      .collection('stories')
      .updateOne(
        { _id: new Types.ObjectId(storyId) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
  }

  /** The playback link of a story, made for `user`. */
  const playback = async (user: TestUser, storyId: string) =>
    (await request(t.http).get(`/api/stories/${storyId}/playback`).set(user.auth).expect(200))
      .body as { videoUrl: string; expiresAt: string };

  const collect = (response: request.Response, done: (e: Error | null, b: Buffer) => void) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => done(null, Buffer.concat(chunks)));
  };

  const watch = (url: string, headers: Record<string, string> = {}) =>
    request(t.http).get(url).set(headers).buffer(true).parse(collect);

  describe('upload', () => {
    it('stores a WebM story for 24 hours and tells everyone', async () => {
      const emit = jest.spyOn(t.app.get(RealtimeService), 'emitToAll');
      const res = await upload(alice, SAMPLE_WEBM, 14_900).expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        authorId: alice.id,
        mimeType: 'video/webm',
        durationMs: 14_900,
        sizeBytes: SAMPLE_WEBM.length,
      });
      const lifetime = Date.parse(res.body.expiresAt) - Date.parse(res.body.createdAt);
      expect(lifetime).toBe(24 * 60 * 60 * 1000);
      expect(files()).toContain(`${res.body.id}.webm`);
      // The whole story and its author, so clients add it without reloading the feed.
      expect(emit).toHaveBeenCalledWith(
        'story:created',
        expect.objectContaining({
          story: expect.objectContaining({ id: res.body.id, authorId: alice.id }),
          author: expect.objectContaining({ id: alice.id, username: 'alice' }),
        }),
      );
      emit.mockRestore();
    });

    it('takes MP4 from Safari too, whatever the client called the file', async () => {
      const res = await upload(bob, SAMPLE_MP4).expect(201);
      expect(res.body.mimeType).toBe('video/mp4');
    });

    it('judges the type by the bytes, not by the name', async () => {
      const res = await request(t.http)
        .post('/api/stories')
        .set(carol.auth)
        .attach('video', Buffer.from('<script>alert(1)</script>'), {
          filename: 'clip.webm',
          contentType: 'video/webm',
        })
        .field('durationMs', '5000')
        .expect(415);
      expect(res.body.error).toBe('Unsupported Media Type');
    });

    it.each([
      ['no video', null, 5000, 400],
      ['a story longer than 15 seconds', SAMPLE_WEBM, 16_000, 400],
      ['a zero duration', SAMPLE_WEBM, 0, 400],
      ['a duration that is not a number', SAMPLE_WEBM, 'long', 400],
    ])('refuses %s', async (_case, video, durationMs, status) => {
      await upload(carol, video, durationMs).expect(status);
    });

    it('refuses a file over 20 MB', async () => {
      const huge = Buffer.concat([SAMPLE_WEBM, Buffer.alloc(20 * 1024 * 1024)]);
      const res = await upload(carol, huge).expect(413);
      expect(res.body.statusCode).toBe(413);
    });

    it('leaves nothing behind in the incoming directory, whatever the outcome', async () => {
      await upload(carol, SAMPLE_WEBM, 16_000).expect(400); // refused after the file arrived
      await upload(carol, Buffer.from('not a video')).expect(415);
      await upload(carol, Buffer.concat([SAMPLE_WEBM, Buffer.alloc(20 * 1024 * 1024)])).expect(413);
      await upload(carol, SAMPLE_WEBM).expect(201);
      expect(readdirSync(join(process.env.UPLOADS_DIR!, '.incoming'))).toEqual([]);
    });

    it('sweeps incoming files that nobody took over, and only the old ones', async () => {
      const dir = join(process.env.UPLOADS_DIR!, '.incoming');
      const stale = join(dir, 'stale');
      const fresh = join(dir, 'fresh');
      writeFileSync(stale, 'x');
      writeFileSync(fresh, 'x');
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(stale, old, old);

      await t.app.get(StoriesCleanupJob).run();

      expect(readdirSync(dir)).toEqual(['fresh']);
      rmSync(fresh);
    });

    it('needs a signed-in user', async () => {
      await request(t.http)
        .post('/api/stories')
        .attach('video', SAMPLE_WEBM, 'clip.webm')
        .field('durationMs', '5000')
        .expect(401);
    });
  });

  describe('feed and video', () => {
    it('lists authors with live stories, the viewer first, then by the newest story', async () => {
      const [dave, erin] = await Promise.all([
        registerUser(t.http, 'dave'),
        registerUser(t.http, 'erin'),
      ]);
      const first = await upload(dave, SAMPLE_WEBM).expect(201);
      const second = await upload(dave, SAMPLE_MP4).expect(201);
      await upload(erin, SAMPLE_WEBM).expect(201);

      const items = await feed(dave);
      expect(items[0]!.author.username).toBe('dave');
      // Stories of one author are ordered from the earliest to the latest.
      expect(items[0]!.stories.map((s) => s.id)).toEqual([first.body.id, second.body.id]);
      // Erin posted last, so she comes right after the viewer.
      expect(items[1]!.author.username).toBe('erin');

      const fromErinsSide = await feed(erin);
      expect(fromErinsSide[0]!.author.username).toBe('erin');
    });

    it('marks a story seen for the viewer once they watch it, not for others', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const seenBy = async (user: TestUser) =>
        (await feed(user)).flatMap((item) => item.stories).find((s) => s.id === story.body.id)!
          .seen;
      expect(await seenBy(alice)).toBe(true);
      expect(await seenBy(bob)).toBe(false);

      await request(t.http).post(`/api/stories/${story.body.id}/view`).set(bob.auth).expect(204);
      // Again: nothing changes, nothing breaks.
      await request(t.http).post(`/api/stories/${story.body.id}/view`).set(bob.auth).expect(204);
      expect(await seenBy(bob)).toBe(true);
      expect(await seenBy(carol)).toBe(false);
    });

    it('serves the video by a playback link to any signed-in user, with no token in the header', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const { videoUrl, expiresAt } = await playback(bob, story.body.id);
      expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

      const res = await watch(videoUrl).expect(200);
      expect(res.headers['content-type']).toBe('video/webm');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(Buffer.compare(res.body as Buffer, SAMPLE_WEBM)).toBe(0);
    });

    it('serves byte ranges with 206, and 416 outside the file', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const { videoUrl } = await playback(bob, story.body.id);
      const size = SAMPLE_WEBM.length;

      const head = await watch(videoUrl, { Range: 'bytes=0-9' }).expect(206);
      expect(head.headers['content-range']).toBe(`bytes 0-9/${size}`);
      expect(head.headers['content-length']).toBe('10');
      expect(Buffer.compare(head.body as Buffer, SAMPLE_WEBM.subarray(0, 10))).toBe(0);

      const tail = await watch(videoUrl, { Range: 'bytes=-5' }).expect(206);
      expect(Buffer.compare(tail.body as Buffer, SAMPLE_WEBM.subarray(size - 5))).toBe(0);

      const open = await watch(videoUrl, { Range: 'bytes=10-' }).expect(206);
      expect(open.headers['content-range']).toBe(`bytes 10-${size - 1}/${size}`);

      const beyond = await watch(videoUrl, { Range: `bytes=${size}-` }).expect(416);
      expect(beyond.headers['content-range']).toBe(`bytes */${size}`);
    });

    it('answers a repeat visit with 304, and ignores Range when If-Range is stale', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const { videoUrl } = await playback(bob, story.body.id);
      const first = await watch(videoUrl).expect(200);
      const etag = first.headers.etag as string;

      await watch(videoUrl, { 'If-None-Match': etag }).expect(304);
      const stale = await watch(videoUrl, { Range: 'bytes=0-9', 'If-Range': '"other"' }).expect(
        200,
      );
      expect((stale.body as Buffer).length).toBe(SAMPLE_WEBM.length);
      await watch(videoUrl, { Range: 'bytes=0-9', 'If-Range': etag }).expect(206);
    });

    it('refuses the video without a valid link, and the link of another story', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const other = await upload(alice, SAMPLE_WEBM).expect(201);
      await request(t.http).get(`/api/stories/${story.body.id}/video`).expect(401);
      await request(t.http).get(`/api/stories/${story.body.id}/video?token=garbage`).expect(401);
      // A Bearer token is not a playback link.
      await request(t.http).get(`/api/stories/${story.body.id}/video`).set(bob.auth).expect(401);

      const { videoUrl } = await playback(bob, other.body.id);
      const token = new URL(videoUrl, 'http://x').searchParams.get('token')!;
      await request(t.http)
        .get(`/api/stories/${story.body.id}/video?token=${encodeURIComponent(token)}`)
        .expect(401);

      await request(t.http)
        .get(`/api/stories/${new Types.ObjectId().toString()}/playback`)
        .set(bob.auth)
        .expect(404);
      await request(t.http).get(`/api/stories/${story.body.id}/playback`).expect(401);
    });

    it('hides an expired story at once, before the cleanup runs', async () => {
      const story = await upload(carol, SAMPLE_WEBM).expect(201);
      const { videoUrl } = await playback(bob, story.body.id);
      await expire(story.body.id);
      const ids = (await feed(bob)).flatMap((item) => item.stories.map((s) => s.id));
      expect(ids).not.toContain(story.body.id);
      // Even a link that is still valid stops working with the story.
      await request(t.http).get(videoUrl).expect(404);
      await request(t.http).get(`/api/stories/${story.body.id}/playback`).set(bob.auth).expect(404);
    });
  });

  describe('removal', () => {
    it('lets the author delete a story, with its file', async () => {
      const story = await upload(alice, SAMPLE_WEBM).expect(201);
      const { videoUrl } = await playback(bob, story.body.id);
      await request(t.http).delete(`/api/stories/${story.body.id}`).set(bob.auth).expect(403);
      await request(t.http).delete(`/api/stories/${story.body.id}`).set(alice.auth).expect(204);
      expect(files()).not.toContain(`${story.body.id}.webm`);
      await request(t.http).get(videoUrl).expect(404);
    });

    it('cleans up expired stories and their videos, and leaves live ones', async () => {
      const old = await upload(bob, SAMPLE_WEBM).expect(201);
      const live = await upload(bob, SAMPLE_MP4).expect(201);
      await expire(old.body.id);

      await t.app.get(StoriesCleanupJob).run();

      expect(existsSync(join(process.env.UPLOADS_DIR!, `${old.body.id}.webm`))).toBe(false);
      expect(
        await db()
          .collection('stories')
          .countDocuments({ _id: new Types.ObjectId(old.body.id) }),
      ).toBe(0);
      expect(files()).toContain(`${live.body.id}.mp4`);

      // Running again finds nothing to do and breaks nothing.
      await t.app.get(StoriesCleanupJob).run();
      expect(files()).toContain(`${live.body.id}.mp4`);
    });
  });
});
