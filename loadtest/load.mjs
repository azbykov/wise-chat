// Load test for the chat: sign-up, pairs of users chatting over sockets, plus REST reads.
// Usage: node loadtest/load.mjs [--users 200] [--duration 60] [--rate 2] [--rest 1]
//   --users     virtual users (even number, they are paired up)
//   --duration  seconds of the chatting phase
//   --rate      messages per second per user (the server allows 10)
//   --rest      REST reads per second per user (conversations list + user search)
// Env: API_URL (default http://localhost:3000)
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { io } = require('socket.io-client');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const API = process.env.API_URL ?? 'http://localhost:3000';
const USERS = Math.max(2, arg('users', 200) & ~1);
const DURATION = arg('duration', 60);
const RATE = arg('rate', 2);
const REST = arg('rest', 1);
const RUN = Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = () => ({ lat: [], err: 0, ok: 0 });
const m = {
  register: stats(),
  connect: stats(),
  ack: stats(),
  deliver: stats(),
  conversations: stats(),
  search: stats(),
};
const errorKinds = new Map();
const noteError = (kind, e) => {
  m[kind].err++;
  const key = `${kind}: ${e?.message ?? e?.error?.message ?? e?.error ?? e}`;
  errorKinds.set(key, (errorKinds.get(key) ?? 0) + 1);
};
const record = (kind, ms) => {
  m[kind].ok++;
  m[kind].lat.push(ms);
};

async function http(method, path, token, body) {
  const res = await fetch(API + '/api' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${json.message ?? ''}`), { json });
  return json;
}

async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const pct = (arr, p) => {
  if (!arr.length) return '-';
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
};
const row = (name, s, secs) =>
  `${name.padEnd(14)} ok=${String(s.ok).padStart(7)} err=${String(s.err).padStart(5)} ` +
  `rps=${(s.ok / secs).toFixed(1).padStart(7)}  p50=${pct(s.lat, 50).padStart(7)} ` +
  `p95=${pct(s.lat, 95).padStart(7)} p99=${pct(s.lat, 99).padStart(7)} max=${pct(s.lat, 100).padStart(7)} ms`;

// 1. Sign-up -------------------------------------------------------------------------------
console.log(`target ${API}, ${USERS} users, ${DURATION}s, ${RATE} msg/s/user, ${REST} rest/s/user`);
const users = Array.from({ length: USERS }, (_, i) => ({
  email: `load-${RUN}-${i}@example.com`,
  username: `ld${RUN}${i}`,
  password: 'Passw0rd!load',
}));
const t0 = performance.now();
await pool(users, 20, async (u) => {
  const s = performance.now();
  try {
    const r = await http('POST', '/auth/register', null, u);
    u.token = r.accessToken;
    u.id = r.user.id;
    record('register', performance.now() - s);
  } catch (e) {
    noteError('register', e);
  }
});
const alive = users.filter((u) => u.token);
console.log(
  `registered ${alive.length}/${USERS} in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
if (alive.length < 2) {
  console.log(row('register', m.register, 1));
  console.log([...errorKinds].map(([k, v]) => `  ${v}x ${k}`).join('\n'));
  console.log(
    'Hint: sign-up is rate limited; start the API with AUTH_RATE_LIMIT_PER_MINUTE=100000',
  );
  process.exit(1);
}

// 2. Pair up, open conversations, connect sockets -------------------------------------------
const pairs = [];
for (let i = 0; i + 1 < alive.length; i += 2) pairs.push([alive[i], alive[i + 1]]);
await pool(pairs, 20, async ([a, b]) => {
  const c = await http('POST', '/conversations', a.token, { userId: b.id });
  a.conv = b.conv = c.id;
  a.peer = b;
  b.peer = a;
});

const sentAt = new Map(); // clientMessageId -> t0, for end-to-end delivery latency
let received = 0;
let sent = 0;
let dropped = 0;

await pool(
  alive.filter((u) => u.conv),
  50,
  (u) =>
    new Promise((resolve) => {
      const s = performance.now();
      u.socket = io(API, {
        auth: { token: u.token },
        transports: ['websocket'],
        reconnection: false,
      });
      u.socket.on('connect', () => {
        record('connect', performance.now() - s);
        resolve();
      });
      u.socket.on('connect_error', (e) => {
        noteError('connect', e);
        resolve();
      });
      u.socket.on('message:new', ({ message }) => {
        if (message.senderId === u.id) return; // own echo
        received++;
        const t = sentAt.get(message.clientMessageId);
        if (t) record('deliver', performance.now() - t);
      });
      u.socket.on('disconnect', () => (u.dropped = true));
    }),
);
const connected = alive.filter((u) => u.socket?.connected);
console.log(`connected ${connected.length} sockets, ${pairs.length} conversations`);

// 3. Chatting + REST reads -----------------------------------------------------------------
const stopAt = performance.now() + DURATION * 1000;
const phaseStart = performance.now();

function chat(u) {
  return (async () => {
    await sleep((Math.random() * 1000) / RATE); // spread the start
    while (performance.now() < stopAt && u.socket.connected) {
      const id = randomUUID();
      const s = performance.now();
      sentAt.set(id, s);
      sent++;
      u.socket
        .timeout(10_000)
        .emit(
          'message:send',
          { conversationId: u.conv, text: `hello ${id}`, clientMessageId: id },
          (err, res) => {
            if (err || !res?.ok) {
              noteError('ack', err ?? res);
              dropped++;
            } else record('ack', performance.now() - s);
          },
        );
      await sleep(1000 / RATE);
    }
  })();
}

function rest(u) {
  return (async () => {
    if (!REST) return;
    await sleep((Math.random() * 1000) / REST);
    let n = 0;
    while (performance.now() < stopAt) {
      const kind = n++ % 2 ? 'search' : 'conversations';
      const path = kind === 'search' ? `/users?search=ld${RUN}&limit=20` : '/conversations';
      const s = performance.now();
      try {
        await http('GET', path, u.token);
        record(kind, performance.now() - s);
      } catch (e) {
        noteError(kind, e);
      }
      await sleep(1000 / REST);
    }
  })();
}

await Promise.all(connected.flatMap((u) => [chat(u), rest(u)]));
await sleep(3000); // let in-flight messages land
const secs = (performance.now() - phaseStart) / 1000;

// 4. Report --------------------------------------------------------------------------------
const lostSockets = connected.filter((u) => u.dropped).length;
connected.forEach((u) => u.socket.close());

console.log(`\n=== results over ${secs.toFixed(0)}s ===`);
for (const k of Object.keys(m))
  console.log(row(k, m[k], k === 'register' || k === 'connect' ? 1 : secs));
console.log(
  `\nmessages sent=${sent} acked=${m.ack.ok} delivered=${received} ` +
    `(expected ~${m.ack.ok}) lost=${Math.max(0, m.ack.ok - received)} ack-failures=${dropped}`,
);
console.log(`sockets dropped mid-test: ${lostSockets}`);
if (errorKinds.size) {
  console.log('\nerrors:');
  for (const [k, v] of [...errorKinds].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`  ${v}x ${k}`);
}
