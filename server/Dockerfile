# ZELab — backend API image
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies (prisma CLI is needed at runtime for migrate/db push).
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Generate the Prisma client against the schema.
COPY prisma ./prisma
RUN npx prisma generate

# Application source.
COPY . .
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 4000

# Lightweight healthcheck against the liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["./docker-entrypoint.sh"]
