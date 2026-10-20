FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000 CACHE_DIR=/cache
EXPOSE 3000
VOLUME ["/cache"]
CMD ["node", "server.js"]
