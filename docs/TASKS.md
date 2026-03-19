# ClipFlow — Implementation Tasks

Derived from [PRD.md](./PRD.md). Focused on Phase 1 MVP with forward-looking notes for Phase 2/3.

---

## Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

---

## 0. Project Setup

- [x] Initialize Nx workspace (`npx create-nx-workspace clipflow --preset=next`)
- [x] Create Next.js app: `apps/web` (frontend + API routes)
- [x] Create processing library: `libs/video-processing` (FFmpeg, yt-dlp logic)
- [x] Create shared library: `libs/shared` (types, constants, utilities)
- [x] Set up database (Postgres) with Prisma (in `libs/db`)
- [x] Set up object storage (S3 / Cloudflare R2) for video files
- [x] Set up BullMQ + Redis for job queue
- [x] Create worker app: `apps/worker` (processes video jobs from queue)
- [x] Configure Nx task pipeline (`build`, `lint`, `test` dependencies)
- [x] Configure CI/CD pipeline (leverage `nx affected` for incremental builds)
- [x] Set up dev environment (Docker Compose for local Postgres, Redis, S3-compatible storage)
- [x] Configure environment variables and secrets management (`.env.local` for Next.js, shared `.env` at root)

---

## 1. YouTube Import (Weeks 1–2)

### 1a. Video Download (`libs/video-processing`)

- [x] Integrate `yt-dlp` for video downloading
- [x] Accept YouTube URL input, validate format
- [x] Download video to temporary storage
- [x] Upload raw video to S3/R2
- [x] Handle errors: private videos, age-restricted, unavailable

### 1b. Metadata Extraction (`libs/db`)

- [x] Extract video metadata (title, description, duration, thumbnail)
- [x] Store metadata in Postgres
- [x] Create Prisma `Video` model (id, userId, sourceUrl, title, description, duration, status, createdAt, etc.)
- [x] Generate and run initial migration

---

## 2. Video Processing Pipeline (Weeks 1–2)

### 2a. FFmpeg Integration (`libs/video-processing` + `apps/worker`)

- [x] Set up BullMQ worker in `apps/worker` to consume video processing jobs
- [x] Implement video transcoding to 1080x1920 (9:16 vertical) in `libs/video-processing`
- [x] Implement center crop for landscape → vertical conversion
- [x] Support trim/segment selection (start time, end time)
- [x] Output processed video to S3/R2
- [x] Track processing status (queued → processing → done → failed) via Prisma

### 2b. Optional: Face Tracking / Smart Crop

- [ ] Research face detection options (FFmpeg cropdetect, ML-based)
- [ ] Implement auto-center on subject (stretch goal for MVP)

---

## 3. Caption Generation (Week 3)

### 3a. Transcription (`libs/video-processing`)

- [x] Integrate Whisper (OpenAI API or self-hosted) for audio → text
- [x] Generate word-level timestamps
- [x] Store transcript in database via Prisma (Transcript model linked to Video)

### 3b. Caption Rendering (`libs/video-processing`)

- [x] Burn captions into video via FFmpeg (ASS/SRT subtitle overlay)
- [x] Implement caption style: white text + black outline (default)
- [x] Implement caption style: keyword highlighting
- [x] Allow user to toggle captions on/off
- [x] Allow user to choose caption style

---

## 4. Frontend / Dashboard — `apps/web` (Week 3)

### 4a. Auth

- [x] Implement user authentication via NextAuth.js (sign up, log in, sessions)
- [x] Set up Next.js middleware for protected routes

### 4b. API Routes (`apps/web/app/api/`)

- [x] `POST /api/videos/import` — accept YouTube URL, enqueue download job
- [x] `GET /api/videos` — list user's videos
- [x] `GET /api/videos/[id]` — video detail + status
- [x] `POST /api/videos/[id]/process` — enqueue processing job (trim, captions)
- [x] `POST /api/videos/[id]/publish` — trigger TikTok upload

### 4c. Import Flow (Pages)

- [x] "Import from YouTube" page — URL input
- [x] Display fetched video metadata (title, thumbnail, duration)
- [x] Segment selector UI (start/end time picker or full video toggle)
- [x] Trigger processing and show progress (poll or SSE for status)

### 4d. Edit Flow (Lightweight)

- [x] Trim start/end controls
- [x] Caption toggle + style selector
- [x] Title/caption text input for TikTok post

### 4e. Dashboard

- [x] List of user's videos
- [x] Status indicators: Draft / Processing / Posted
- [x] Click into video detail/edit view

---

## 5. TikTok Integration (Week 4)

### 5a. OAuth (`apps/web` + `libs/shared`)

- [ ] Register as TikTok developer, apply for Content Posting API access
- [x] Implement TikTok OAuth flow via NextAuth.js provider (connect account)
- [x] Store and refresh access tokens securely (Prisma `Account` model)

### 5b. Upload & Post (`libs/video-processing` + `apps/worker`)

- [x] Upload video via TikTok Content Posting API
- [x] Support setting caption + hashtags on post
- [x] Track post status (uploading → posted → failed)
- [x] Handle API errors and rate limits

### 5c. Fallback Upload Flow (`apps/web`)

- [x] Design manual upload fallback UX (download file + instructions)
- [x] Implement signed URL download for processed videos
- [x] **NOTE:** TikTok API access is a critical risk — fallback is essential for launch

---

## 6. Scheduling (MVP+ / Optional)

- [ ] Allow user to choose a future post time
- [ ] Implement scheduling queue (cron or delayed job)
- [ ] Display scheduled posts on dashboard

---

## 7. Pricing & Usage Limits

- [ ] Track exports per user per month
- [ ] Enforce free tier limits (3 exports/month)
- [ ] Add watermark to free tier exports
- [ ] Integrate payment provider (Stripe) for paid tiers ($15/mo, $30/mo)
- [ ] Gate features by tier (no watermark, higher export limits, unlimited)

---

## 8. Launch Prep (Week 4)

- [ ] End-to-end test: paste URL → process → post to TikTok
- [ ] Performance: ensure "time to first post" < 5 minutes
- [x] Error handling and user-facing error messages
- [ ] Basic logging and monitoring
- [x] Landing page / marketing site
- [ ] Product Hunt listing draft
- [ ] "Built this for myself" launch narrative (Twitter/X, Reddit)

---

## Phase 2 Tasks (Post-MVP)

> Not in scope for initial build. Listed for planning visibility.

- [ ] AI auto-clip detection (identify best segments from long-form video)
- [ ] Hook detection (find strong opening moments)
- [ ] Format optimization (auto emoji, pacing adjustments)
- [ ] Multi-platform support (Instagram Reels, YouTube Shorts, X)
- [ ] SEO content pages ("clip youtube videos for tiktok", etc.)

## Phase 3 Tasks (Future)

- [ ] Auto-post workflows (rules-based or scheduled pipelines)
- [ ] Performance analytics dashboard (views, engagement per clip)
- [ ] Content suggestions based on performance data
- [ ] A/B testing clips (post variations, compare metrics)
- [ ] Agency tier ($99–$299/mo) with multi-creator management
- [ ] Viral loop features (watermark branding, shareable clip pages)
