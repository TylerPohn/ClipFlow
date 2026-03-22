# Scheduled Cross-Platform Migration

## Overview

Add the ability to schedule future posts with default settings so users can migrate an entire video library from one platform to another over time. For example, migrating YouTube Shorts to TikTok at 1-3 videos per day on autopilot.

## Current State

- `Post.scheduledAt` and `PostStatus.SCHEDULED` already exist in the Prisma schema but are unused
- Single-video, immediate publishing works for TikTok (direct post endpoint)
- Platform accounts, OAuth tokens, and BullMQ job infrastructure are all in place
- Videos can be imported/synced from YouTube with processed files stored in S3

## User Flow

### 1. Create a Migration Plan

From a new **Migrations** page in the dashboard:

1. Select **source platform** (e.g., YouTube Shorts) — shows synced videos
2. Select **destination platform** (e.g., TikTok) — must have linked account
3. Choose videos to migrate (select all, filter by date range, or pick individually)
4. Configure **default post settings**:
   - Caption template (e.g., reuse original title, prepend/append text)
   - Hashtag defaults (copy from source or set custom)
   - Visibility (public/private/friends)
5. Set **schedule cadence**:
   - Videos per day (1-3)
   - Time slots (e.g., 9am, 2pm, 7pm)
   - Start date
   - Skip weekends (optional)
6. Preview the schedule — a calendar/list view showing which video posts on which day
7. Confirm — creates all `Post` records with `status: SCHEDULED` and `scheduledAt` timestamps

### 2. Monitor & Manage

- Dashboard shows active migrations with progress (e.g., "12 of 47 posted")
- Each scheduled post can be individually edited, rescheduled, or cancelled
- Pause/resume the entire migration
- Failed posts surface with retry option

## Data Model Changes

### New: `Migration` model

```prisma
model Migration {
  id              String           @id @default(cuid())
  userId          String
  user            User             @relation(fields: [userId], references: [id])
  name            String?
  sourcePlatform  Platform
  destPlatform    Platform
  status          MigrationStatus  @default(ACTIVE)
  cadence         Json             // { videosPerDay: 2, timeSlots: ["09:00", "19:00"], skipWeekends: false }
  defaultCaption  String?          // Template: "{{originalTitle}}" or custom
  defaultHashtags String[]
  defaultSettings Json?            // Platform-specific defaults (visibility, etc.)
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  posts           Post[]

  @@index([userId])
}

enum MigrationStatus {
  ACTIVE
  PAUSED
  COMPLETED
  CANCELLED
}
```

### Updated: `Post` model

Add a relation to Migration:

```prisma
model Post {
  // ... existing fields ...
  migrationId  String?
  migration    Migration? @relation(fields: [migrationId], references: [id])
}
```

### Updated: `JobType` enum

```typescript
enum JobType {
  // ... existing ...
  SCHEDULE_CHECK,  // Cron job that finds due scheduled posts and enqueues UPLOAD jobs
}
```

## Backend Implementation

### 1. Scheduler Worker Job

A new **repeatable BullMQ job** (`SCHEDULE_CHECK`) that runs every 5 minutes:

```
1. Query posts WHERE status = SCHEDULED AND scheduledAt <= now()
2. For each due post:
   a. Verify the destination platform account token is still valid (refresh if needed)
   b. Verify the processed video file exists in S3
   c. Set status to UPLOADING
   d. Enqueue an UPLOAD job (existing handler)
3. Log results
```

This reuses the existing `UPLOAD` job handler — no changes needed to the actual posting logic.

### 2. API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/migrations` | Create migration + generate scheduled posts |
| `GET` | `/api/migrations` | List user's migrations with progress stats |
| `GET` | `/api/migrations/[id]` | Migration detail with all scheduled posts |
| `PATCH` | `/api/migrations/[id]` | Update status (pause/resume/cancel) |
| `DELETE` | `/api/migrations/[id]` | Cancel migration and all pending posts |
| `PATCH` | `/api/migrations/[id]/posts/[postId]` | Edit individual scheduled post |
| `GET` | `/api/migrations/[id]/preview` | Preview schedule before confirming |

### 3. Migration Creation Logic

```
POST /api/migrations
{
  sourcePlatform: "YOUTUBE_SHORTS",
  destPlatform: "TIKTOK",
  videoIds: ["vid_1", "vid_2", ...],
  cadence: { videosPerDay: 2, timeSlots: ["09:00", "19:00"], skipWeekends: false },
  startDate: "2026-03-23",
  defaultCaption: "{{originalTitle}}",
  defaultHashtags: ["#shorts", "#fyp"],
  defaultSettings: { visibility: "public" }
}
```

Server-side:
1. Validate all videos exist, are READY status, and have processed files
2. Validate destination platform account is linked
3. Generate schedule: distribute `videoIds` across future dates using cadence rules
4. Create `Migration` record
5. Create `Post` records in bulk with `status: SCHEDULED`, `scheduledAt` set per schedule
6. Register the `SCHEDULE_CHECK` repeatable job if not already running

### 4. Video Processing for Migration

Some source videos may not have been processed yet (e.g., imported from YouTube but not clipped for TikTok format). The migration creation step should:

1. Check each video for a processed file compatible with the destination platform
2. If missing, enqueue `PROCESS` jobs with platform-appropriate settings (duration limits, aspect ratio)
3. Mark those posts as `SCHEDULED` — the scheduler will skip them if the video isn't READY when `scheduledAt` arrives and retry next cycle

## Frontend Implementation

### New Pages

#### `/dashboard/migrations` — Migration List

- Card per migration showing: source → dest, progress bar, status badge, created date
- Quick actions: pause, resume, cancel
- "New Migration" button

#### `/dashboard/migrations/new` — Migration Wizard

Step-by-step form:
1. **Source & Destination** — platform selectors with connected account indicators
2. **Select Videos** — searchable/filterable grid of source platform videos with select all, shows which are already posted to destination
3. **Default Settings** — caption template, hashtags, visibility
4. **Schedule** — cadence picker (videos/day, time slots, start date)
5. **Review** — calendar preview of the full schedule, total count, estimated completion date

#### `/dashboard/migrations/[id]` — Migration Detail

- Header: status, progress, source → dest
- Timeline/calendar view of all posts (past = posted/failed, future = scheduled)
- Click any post to edit caption/hashtags/scheduled time
- Bulk actions: pause all, cancel remaining

### Components

- `MigrationWizard` — multi-step form
- `SchedulePreview` — calendar/list showing planned posts
- `MigrationCard` — summary card for list view
- `MigrationTimeline` — detailed post timeline

## Implementation Plan

### Phase 1: Scheduler Foundation
1. Add `Migration` model to Prisma schema, update `Post` with `migrationId`
2. Run migration: `npx prisma db push`
3. Add `SCHEDULE_CHECK` job type to shared types
4. Implement scheduler worker handler (query due posts, enqueue uploads)
5. Register repeatable job on worker startup

### Phase 2: Migration API
6. `POST /api/migrations` — create migration + bulk scheduled posts
7. `GET /api/migrations` — list with progress stats
8. `GET /api/migrations/[id]` — detail with posts
9. `PATCH /api/migrations/[id]` — pause/resume/cancel
10. Individual post editing endpoint

### Phase 3: Frontend — Migration Wizard
11. Migration list page (`/dashboard/migrations`)
12. Source/destination selection step
13. Video selection grid with filters
14. Default settings form
15. Schedule cadence picker
16. Schedule preview component
17. Confirm and create

### Phase 4: Frontend — Monitoring
18. Migration detail page with timeline
19. Individual post editing modal
20. Pause/resume/cancel controls
21. Failed post retry UI

### Phase 5: Polish
22. Notification when migration completes or post fails
23. Handle token expiration mid-migration (auto-refresh or alert)
24. Skip videos already posted to destination platform
25. E2E tests for the full flow

## Edge Cases

- **Token expiration**: Migrations span days/weeks. The scheduler must refresh OAuth tokens before each upload attempt. If refresh fails, pause the migration and notify the user.
- **Rate limits**: TikTok and other platforms have daily upload limits. Respect these — if a platform returns a rate limit error, back off and retry in the next scheduler cycle.
- **Video not ready**: If a video hasn't been processed when its scheduled time arrives, skip it and retry next cycle. After 3 retries, mark as FAILED.
- **Duplicate detection**: Before creating posts, check if the video already has a POSTED post on the destination platform. Skip or warn.
- **Platform downtime**: If uploads fail due to platform API errors (not auth errors), retry with exponential backoff up to 3 attempts before marking FAILED.
- **Cancelled mid-flight**: When cancelling a migration, only cancel SCHEDULED posts. Leave UPLOADING/POSTED/FAILED as-is.
