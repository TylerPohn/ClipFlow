# Rename Plan: ClipFlow → Cliptopus

## Codebase

### Package Names (`@clipflow/*` → `@cliptopus/*`)

| File | Current Value |
|------|---------------|
| `package.json` | `@clipflow/source` |
| `apps/web/package.json` | `@clipflow/web` |
| `apps/web-e2e/package.json` | `@clipflow/web-e2e` |
| `apps/worker/package.json` | `@clipflow/worker` |
| `libs/db/package.json` | `@clipflow/db` |
| `libs/shared/package.json` | `@clipflow/shared` |
| `libs/video-processing/package.json` | `@clipflow/video-processing` |

### TypeScript Path Aliases

| File | Aliases to Rename |
|------|-------------------|
| `tsconfig.base.json` | `@clipflow/shared`, `@clipflow/db`, `@clipflow/video-processing` |
| `libs/db/tsconfig.json` | `@clipflow/shared` |
| `libs/video-processing/tsconfig.json` | `@clipflow/shared` |
| `apps/worker/tsconfig.json` | `@clipflow/shared`, `@clipflow/db`, `@clipflow/video-processing` |

### Imports Across Source Files

All `import ... from '@clipflow/...'` statements:

- `apps/web/src/lib/queue.ts`
- `apps/web/src/lib/auth.ts`
- `apps/web/src/lib/youtube.ts`
- `apps/web/src/app/api/accounts/tiktok/route.ts`
- `apps/web/src/app/api/accounts/youtube/route.ts`
- `apps/web/src/app/api/auth/signup/route.ts`
- `apps/web/src/app/api/auth/tiktok/callback/route.ts`
- `apps/web/src/app/api/auth/youtube/callback/route.ts`
- `apps/web/src/app/api/videos/route.ts`
- `apps/web/src/app/api/videos/import/route.ts`
- `apps/web/src/app/api/videos/[id]/route.ts`
- `apps/web/src/app/api/videos/[id]/download/route.ts`
- `apps/web/src/app/api/videos/[id]/process/route.ts`
- `apps/web/src/app/api/videos/[id]/publish/route.ts`
- `apps/web/src/app/api/webhooks/youtube/route.ts`
- `apps/web/src/app/api/youtube/sync/route.ts`
- `apps/web/src/app/api/youtube/videos/route.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/handlers/download.ts`
- `apps/worker/src/handlers/process.ts`
- `apps/worker/src/handlers/transcribe.ts`
- `apps/worker/src/handlers/upload.ts`
- `apps/worker/src/handlers/youtube-subscribe.ts`
- `apps/worker/src/handlers/youtube-sync.ts`
- `libs/video-processing/src/transcriber.ts`
- `libs/video-processing/src/captions.ts`

### S3 Bucket Names

| File | Buckets |
|------|---------|
| `libs/shared/src/constants.ts` | `clipflow-raw`, `clipflow-processed`, `clipflow-thumbnails` |

### Temp Directory Prefixes

| File | Prefix |
|------|--------|
| `apps/worker/src/handlers/upload.ts` | `clipflow-upload-` |
| `apps/worker/src/handlers/download.ts` | `clipflow-dl-` |
| `apps/worker/src/handlers/process.ts` | `clipflow-proc-` |
| `apps/worker/src/handlers/transcribe.ts` | `clipflow-transcribe-` |

### Database Connection Strings

| File | Value |
|------|-------|
| `.env.example` | `postgresql://clipflow:clipflow@localhost:5432/clipflow` |
| `libs/db/src/index.ts` | `postgresql://clipflow:clipflow@localhost:5432/clipflow` |
| `libs/db/prisma/prisma.config.ts` | `postgresql://clipflow:clipflow@localhost:5432/clipflow` |

### Docker Compose

| Setting | Current |
|---------|---------|
| `POSTGRES_USER` | `clipflow` |
| `POSTGRES_PASSWORD` | `clipflow` |
| `POSTGRES_DB` | `clipflow` |
| `MINIO_ROOT_USER` | `clipflow` |
| `MINIO_ROOT_PASSWORD` | `clipflow123` |

### Jest Config

| File | Field |
|------|-------|
| `apps/web/jest.config.cts` | `displayName: '@clipflow/web'` |

### Playwright Config

| File | Reference |
|------|-----------|
| `apps/web-e2e/playwright.config.ts` | `npx nx run @clipflow/web:dev` |

### Subtitle Template

| File | Value |
|------|-------|
| `libs/video-processing/src/captions.ts` | `Title: ClipFlow Captions` |

---

## User-Facing Branding

| File | Text |
|------|------|
| `apps/web/src/app/layout.tsx` | `title: 'ClipFlow'` |
| `apps/web/src/components/NavBar.tsx` | `ClipFlow` |
| `apps/web/src/components/Footer.tsx` | `ClipFlow Studio` |
| `apps/web/src/app/login/page.tsx` | `Sign in to ClipFlow` |
| `apps/web/src/app/signup/page.tsx` | `start using ClipFlow` |
| `apps/web/src/app/privacy/page.tsx` | Multiple references to `ClipFlow Studio` |
| `apps/web/src/app/terms/page.tsx` | Multiple references to `ClipFlow Studio` |

---

## Documentation

| File | Notes |
|------|-------|
| `README.md` | Title |
| `docs/PRD.md` | Working name reference |
| `docs/TASKS.md` | Title |
| `docs/privacy-policy.md` | All `ClipFlow Studio` references |
| `docs/terms-of-service.md` | All `ClipFlow Studio` references |
| `docs/youtube-setup-guide.md` | OAuth app name, URLs, server paths |
| `docs/youtube-integration-research.md` | App name, callback URLs |
| `DEPLOY.local.md` | Title, PM2 names, repo path, domain references |
| `CLAUDE.md` | DB credentials, PM2 names, deployment paths, domain references |

> **Note:** `package-lock.json` contains many `@clipflow/*` references but will auto-regenerate on `npm install` — no manual changes needed.

---

## Infrastructure (Server-Side)

### Domain & DNS
- [ ] Register `cliptopus.org` (and/or `.com`)
- [ ] Create Cloudflare DNS zone for new domain
- [ ] Add CNAME pointing to existing tunnel (`e37195a3-85ae-4cb1-a6a6-58b8ffe5a588.cfargotunnel.com`)
- [ ] Update `/etc/cloudflared/config.yml` to route new domain
- [ ] Keep `clipflow.org` temporarily as a redirect

### Server Directory
- [ ] Rename `/home/tyler/apps/clipflow` → `/home/tyler/apps/cliptopus`
- [ ] Update any scripts or docs referencing the old path

### PM2 Process Names
- [ ] `clipflow-web` → `cliptopus-web`
- [ ] `clipflow-worker` → `cliptopus-worker`

### PostgreSQL
- [ ] Rename database `clipflow` → `cliptopus` (or leave as-is internally)
- [ ] Rename user `clipflow` → `cliptopus` (or leave as-is internally)

### S3 / MinIO Buckets
- [ ] `clipflow-raw` → `cliptopus-raw`
- [ ] `clipflow-processed` → `cliptopus-processed`
- [ ] `clipflow-thumbnails` → `cliptopus-thumbnails`

---

## Third-Party OAuth Apps

### TikTok
- [ ] Update app name in TikTok Developer Portal
- [ ] Update redirect URI to new domain
- [ ] Resubmit for approval under new name

### YouTube / Google
- [ ] Update OAuth consent screen app name to `Cliptopus`
- [ ] Update authorized redirect URI to `https://cliptopus.org/api/auth/youtube/callback`
- [ ] Re-verify if needed (privacy policy URL changes)

### NextAuth
- [ ] Update `NEXTAUTH_URL` env var on server to new domain

---

## Email Addresses

| Current | New |
|---------|-----|
| `privacy@clipflow.studio` | `privacy@cliptopus.org` (or chosen domain) |
| `legal@clipflow.studio` | `legal@cliptopus.org` (or chosen domain) |
