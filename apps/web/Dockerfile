# Built from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first: the dependency layer is reused until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web
COPY apps/web apps/web
RUN pnpm --filter web build \
 && pnpm --filter web deploy --prod --legacy /out \
 && cp -r apps/web/build /out/build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# Only what runs: the build, production dependencies and the manifest.
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/build ./build
USER node
EXPOSE 5173
# PUBLIC_API_URL is read when the server starts, so one image serves any API address.
CMD ["node", "build"]
