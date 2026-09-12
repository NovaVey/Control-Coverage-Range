# attenuated-delegation-chain/services/mint ships no Dockerfile of its own
# (confirmed — see taxonomy/gaps/adc.yaml's graph-events-invisible-by-default
# row's sibling finding and ARCHITECTURE.md). This is this range's own,
# built from that project's real, unmodified source (build context is the
# whole npm-workspaces monorepo — services/mint depends on @adc/core,
# @adc/graph, @adc/revocation as workspace packages, so all four have to be
# installed/built together, exactly as `npm run build --workspaces` at the
# monorepo root already does for local development).
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci
RUN npm run build --workspaces --if-present

FROM node:20-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services ./services
COPY --from=build /repo/node_modules ./node_modules
WORKDIR /repo/services/mint
EXPOSE 3001
CMD ["node", "dist/src/index.js"]
