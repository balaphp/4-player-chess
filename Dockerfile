# build stage: install everything and build the web app
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/player-web/package.json apps/player-web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --cwd apps/player-web build

# runtime stage: bun runs the server's TS directly, web app served statically
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/player-web/dist ./apps/server/public
ENV NODE_ENV=production
EXPOSE 4000
CMD ["bun", "apps/server/src/server.ts"]
