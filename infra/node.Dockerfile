# Shared image for the API, the Node capture worker and the web app (select with --target).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY workers/capture/package.json workers/capture/
RUN npm ci --ignore-scripts

FROM deps AS api
COPY tsconfig.json ./
COPY packages packages
COPY apps/api apps/api
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "apps/api/src/server.ts"]

FROM deps AS web-build
COPY apps/web apps/web
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm --workspace apps/web run build

FROM web-build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "--workspace", "apps/web", "next", "start", "-p", "3000"]

# Capture worker: Playwright's Chromium image plus the Arabic fonts (CE-8).
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS capture
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl fontconfig && rm -rf /var/lib/apt/lists/*
COPY scripts/install-fonts.sh scripts/
RUN scripts/install-fonts.sh
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.json ./
COPY packages packages
COPY workers/capture workers/capture
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/capture/src/main.ts"]
