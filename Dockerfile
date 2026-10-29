# Plain Dockerfile (no BuildKit-only syntax) so it builds with whatever
# `docker build` the Unraid host ships.
FROM node:26-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26-trixie-slim
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=127.0.0.1 \
    DATA_DIR=/data \
    TZ=Europe/Bratislava \
    PUID=99 \
    PGID=100
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY ferment-entrypoint.sh /usr/local/bin/ferment-entrypoint.sh
VOLUME /data
# No EXPOSE: the app is reached only through Tailscale Serve inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Unraid's Tailscale hook records ENTRYPOINT/CMD when the container is created.
# Keep this line stable; change behaviour inside the script instead.
ENTRYPOINT ["/usr/local/bin/ferment-entrypoint.sh"]
