# Built from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first: the dependency layer is reused until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter api
COPY apps/api apps/api
RUN pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# Only what runs: the build, production dependencies and the manifest.
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Story videos; a volume in Compose. Owned by node, so a fresh volume inherits the owner.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
