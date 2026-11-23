FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SMARTCART_DB=/data/smartcart.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
