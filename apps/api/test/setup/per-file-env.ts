import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before every test file, ahead of its imports: the config module reads the environment
// once, when the app module is imported. Each file gets a database of its own.
const uri = new URL(process.env.MONGO_TEST_URI!);
uri.pathname = `/test_${randomUUID().replaceAll('-', '')}`;
process.env.MONGO_URI = uri.toString();
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters';
// Test files register many users; the one that checks the limit sets its own.
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '1000';
// Story videos of each file go to a directory of its own under the system temp directory.
process.env.UPLOADS_DIR = join(tmpdir(), `wisebits-test-uploads-${randomUUID()}`);
