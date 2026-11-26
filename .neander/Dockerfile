FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS tooling
RUN npm install --global pnpm@11.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM tooling AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN --network=none pnpm build

FROM tooling AS production-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
# BlockNote's browser-only emoji picker declares a compiler peer. The bundled
# client and Node's built-in TypeScript stripping do not use that build tool.
RUN rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@typescript+typescript-*@*

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /opt/yarn* /usr/local/bin/yarn*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node .neander/entrypoint.sh .neander/load-environment.mjs ./.neander/
USER node
EXPOSE 8080
ENTRYPOINT ["sh", ".neander/entrypoint.sh"]
CMD ["server/start.ts"]
