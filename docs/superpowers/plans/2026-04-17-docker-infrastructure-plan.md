# Docker Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all containerization and reverse proxy files so the funnel-analyzer API can be deployed on a VPS Ubuntu via Docker Compose + Caddy.

**Architecture:** Single Docker Compose stack with two services: `app` (Node.js API on internal port 3000) and `proxy` (Caddy reverse proxy on ports 80/443). The app service reads `.env` at runtime and persists cache to a named volume. Caddy handles TLS termination automatically.

**Tech Stack:** Docker, Docker Compose, Caddy 2, Node.js 22 Alpine

**Reference:** `docs/vps-secure-deployment-handoff.md` sections 4.1, 5.2, 5.3, 8.2–8.5

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `Dockerfile` | Multi-stage Node.js build: install deps, copy source, run as non-root |
| Create | `.dockerignore` | Exclude dev files, .env, node_modules, tests from image |
| Create | `compose.yaml` | Define `app` + `proxy` services, volumes, network |
| Create | `Caddyfile` | Reverse proxy config with automatic HTTPS |
| Modify | `.env.example` | Add `DOMAIN` variable for Caddy |

---

### Task 1: Create `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create the `.dockerignore` file**

```
node_modules
npm-debug.log*
.env
.env.*
.git
.gitignore
cache
coverage
tests
docs
.claude
.worktrees
*.md
.vscode
.idea
Thumbs.db
.DS_Store
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore"
```

---

### Task 2: Create `Dockerfile`

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the `Dockerfile`**

```dockerfile
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
```

Key decisions:
- `node:22-alpine` — lightweight, Node 22 LTS (meets the Node 18+ requirement)
- `npm ci --omit=dev` — reproducible install, no devDependencies in production
- Non-root user `appuser` — security best practice
- `/app/cache` owned by appuser — for the cache volume mount
- Only `src/` is copied — no tests, docs, or config in the image

- [ ] **Step 2: Build the image locally to verify it works**

Run:
```bash
docker build -t funnel-analyzer:test .
```
Expected: Build completes successfully with no errors.

- [ ] **Step 3: Run the container to verify it starts**

Run:
```bash
docker run --rm --env-file .env -p 3000:3000 funnel-analyzer:test &
sleep 3
curl http://localhost:3000/health
docker stop $(docker ps -q --filter ancestor=funnel-analyzer:test)
```
Expected: Health endpoint returns `{"status":"ok"}` or similar success response.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "chore: add Dockerfile for production deployment"
```

---

### Task 3: Create `Caddyfile`

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Create the `Caddyfile`**

```caddyfile
{$DOMAIN:localhost} {
    reverse_proxy app:3000
}
```

This config:
- Uses the `DOMAIN` environment variable (defaults to `localhost` for local dev)
- Caddy automatically provisions HTTPS certificates when `DOMAIN` is a real domain
- Proxies all traffic to the `app` service on port 3000 via Docker Compose networking

- [ ] **Step 2: Commit**

```bash
git add Caddyfile
git commit -m "chore: add Caddyfile for reverse proxy"
```

---

### Task 4: Create `compose.yaml`

**Files:**
- Create: `compose.yaml`

- [ ] **Step 1: Create the `compose.yaml`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      - CACHE_DIR=/app/cache
    volumes:
      - cache_data:/app/cache
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      - DOMAIN=${DOMAIN:-localhost}
    depends_on:
      app:
        condition: service_healthy

volumes:
  cache_data:
  caddy_data:
  caddy_config:
```

Key decisions:
- `app` does NOT publish ports to the host — only accessible via the `proxy` service (section 8.2 requirement)
- `restart: unless-stopped` — survives host reboots (section 9.3)
- `env_file: .env` — secrets stay outside the image (section 4.1)
- `CACHE_DIR=/app/cache` — overrides any local dev value
- `cache_data` named volume — cache persists between container restarts (section 4.1)
- `caddy_data` volume — stores TLS certificates
- `caddy_config` volume — stores Caddy internal config
- Health check uses `wget` (available in Alpine) instead of `curl`
- `proxy` waits for `app` to be healthy before starting

- [ ] **Step 2: Start the full stack locally to verify**

Run:
```bash
docker compose up --build -d
sleep 5
curl http://localhost/health
docker compose down
```
Expected: Health endpoint responds through the Caddy proxy on port 80.

- [ ] **Step 3: Verify port 3000 is NOT accessible from host**

Run:
```bash
curl http://localhost:3000/health
```
Expected: Connection refused — port 3000 is not published to the host.

- [ ] **Step 4: Commit**

```bash
git add compose.yaml
git commit -m "chore: add Docker Compose with app and Caddy proxy"
```

---

### Task 5: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add `DOMAIN` variable to `.env.example`**

Add at the end of the file:

```
DOMAIN=localhost
```

This variable is used by the Caddyfile. In production, set to the actual domain (e.g., `api.example.com`).

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add DOMAIN to .env.example for Caddy config"
```

---

### Task 6: Final Integration Verification

- [ ] **Step 1: Clean build and full stack test**

Run:
```bash
docker compose down -v
docker compose up --build -d
sleep 5
```

- [ ] **Step 2: Verify health through proxy**

Run:
```bash
curl -s http://localhost/health
```
Expected: Returns health check response.

- [ ] **Step 3: Verify auth is enforced through proxy**

Run:
```bash
curl -s -w "\n%{http_code}" http://localhost/configs/test
```
Expected: Returns `401` status code.

- [ ] **Step 4: Verify authenticated request works through proxy**

Run (replace with actual token from `.env`):
```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost/cache
```
Expected: Returns `200` with cache data (or empty array).

- [ ] **Step 5: Teardown**

```bash
docker compose down
```

- [ ] **Step 6: Final commit if any adjustments were needed**

Only if something required fixing during verification.
