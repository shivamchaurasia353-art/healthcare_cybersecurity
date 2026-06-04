FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies (includes native build for better-sqlite3)
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev

# Production image
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeuser

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY package.json ./

RUN mkdir -p logs/app logs/audit /app/data && chown -R nodeuser:nodejs logs /app/data
USER nodeuser

EXPOSE 5000
CMD ["node", "src/server.js"]
