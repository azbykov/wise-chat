import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { requestId } from './common/request-id';
import type { Env } from './config/env';
import { ChatIoAdapter } from './realtime/chat-io.adapter';

/**
 * What main.ts applies on top of AppModule, shared with the e2e tests so they run the same app.
 * Pipes, filters and guards live in the modules as APP_* providers.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });

  // Behind a reverse proxy the client address comes from X-Forwarded-For; the sign-in rate limit
  // counts by it. Off unless TRUST_PROXY says how many proxies to believe.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  app.use(requestId);
  // Story videos are played by the web app from another origin, so they must stay embeddable.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api');
  // The refresh cookie travels with cross-origin calls from the web app.
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.useWebSocketAdapter(new ChatIoAdapter(app, corsOrigin));
  app.enableShutdownHooks();
}
