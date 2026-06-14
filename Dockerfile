# Backend image for Railway. Runs the NAV-oracle + executor service via tsx
# (the @gmx-io/sdk ESM build needs tsx, not `node dist`).
FROM node:22-slim

RUN corepack enable
WORKDIR /app

# Copy the whole workspace (node_modules/.next/.env excluded via .dockerignore),
# then install only the backend and its workspace deps (@etesia/shared) — skips the
# web app's Next.js toolchain. devDependencies are needed at runtime (tsx).
COPY . .
RUN pnpm install --filter "@etesia/backend..." --frozen-lockfile

ENV NODE_ENV=production
# Railway injects $PORT; the service reads it (config PORT default 8080).
EXPOSE 8080

CMD ["pnpm", "--filter", "@etesia/backend", "start"]
