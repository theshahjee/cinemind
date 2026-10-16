FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/mcp ./apps/mcp
RUN pnpm install --frozen-lockfile --filter @cinemind/mcp... \
 && pnpm --filter @cinemind/mcp... build \
 && pnpm deploy --filter @cinemind/mcp --prod --legacy /out

FROM node:22-alpine
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
COPY --from=build /out ./
USER node
EXPOSE 4200
CMD ["node", "dist/http.js"]
