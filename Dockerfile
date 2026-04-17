FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN mkdir -p /app/cache && chown -R appuser:appgroup /app/cache

USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]
