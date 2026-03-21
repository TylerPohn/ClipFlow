# YouTube Integration Research — ClipFlow

## Goal

Allow users to link their YouTube channel so ClipFlow can automatically pull video metadata (title, description, tags, thumbnails) without manually pasting URLs. Detect new uploads automatically.

---

## Current State in ClipFlow

- **YouTube download** already works via `yt-dlp` (import by URL)
- **`YOUTUBE_SHORTS`** platform enum already exists in Prisma schema
- **TikTok OAuth link flow** exists and can be mirrored for YouTube (`/api/auth/tiktok/link` + `/callback`)
- **BullMQ worker** infrastructure supports adding new job types
- **Account model** already stores OAuth tokens (access_token, refresh_token, expires_at, scope)

---

## Authentication — Google OAuth 2.0

### Setup

1. Create project at https://console.cloud.google.com
2. Enable **YouTube Data API v3**
3. Create OAuth 2.0 credentials (Web application)
4. Add redirect URI: `https://clipflow.org/api/auth/youtube/callback`
5. Will need OAuth verification (sensitive scope: `youtube.readonly`)

### OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `youtube.readonly` | Read channel info, videos, playlists — **this is the only one needed for pulling metadata** |
| `youtube.upload` | Upload videos (future feature) |
| `youtube.force-ssl` | Read/write comments, captions (future) |

### Flow (mirror TikTok pattern)

**Authorization URL:**
```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id=CLIENT_ID&
  redirect_uri=https://clipflow.org/api/auth/youtube/callback&
  response_type=code&
  scope=https://www.googleapis.com/auth/youtube.readonly&
  access_type=offline&
  prompt=consent&
  state=CSRF_TOKEN
```

**Token exchange:**
```
POST https://oauth2.googleapis.com/token
  code=AUTH_CODE&client_id=...&client_secret=...&redirect_uri=...&grant_type=authorization_code
```

**Token refresh:**
```
POST https://oauth2.googleapis.com/token
  refresh_token=...&client_id=...&client_secret=...&grant_type=refresh_token
```

Important: Always request `access_type=offline` and `prompt=consent` to get a refresh token.

### Environment Variables Needed

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## Key API Endpoints

### 1. Get Authenticated User's Channel

```
GET https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true
Authorization: Bearer ACCESS_TOKEN
```

**Quota cost: 1 unit**

Returns channel ID, name, handle, thumbnails, and critically: `contentDetails.relatedPlaylists.uploads` — the uploads playlist ID needed to list all videos.

### 2. List Videos from Uploads Playlist

```
GET https://www.googleapis.com/youtube/v3/playlistItems
  ?part=snippet,contentDetails
  &playlistId=UU...  (uploads playlist ID from above)
  &maxResults=50
Authorization: Bearer ACCESS_TOKEN
```

**Quota cost: 1 unit** (paginated via `nextPageToken`)

Returns video IDs, titles, descriptions, thumbnails, publish dates. **Does NOT include tags** — need `videos.list` for that.

### 3. Get Full Video Details (title, description, tags, thumbnails, stats)

```
GET https://www.googleapis.com/youtube/v3/videos
  ?part=snippet,statistics,contentDetails
  &id=VIDEO_ID1,VIDEO_ID2,...  (up to 50 comma-separated)
Authorization: Bearer ACCESS_TOKEN
```

**Quota cost: 1 unit** (can batch 50 videos per request)

Returns everything: title, description, **tags**, category, thumbnails (default/medium/high/maxres), duration, view/like/comment counts.

### 4. Search (AVOID — expensive)

```
GET https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=UC...&type=video
```

**Quota cost: 100 units** — never use this when `playlistItems.list` costs 1 unit.

---

## Quota & Rate Limits

**Default daily quota: 10,000 units per project**

| Endpoint | Cost |
|----------|------|
| channels.list | 1 |
| playlistItems.list | 1 |
| videos.list | 1 |
| search.list | **100** |
| videos.insert (upload) | 100 |
| videos.update | 50 |

### Budget Math

A full sync of 50 videos costs ~3 units:
- 1 unit: `channels.list` (get uploads playlist ID)
- 1 unit: `playlistItems.list` (get video IDs)
- 1 unit: `videos.list` (batch 50 IDs for full details)

**10,000 units/day = ~3,300 full syncs/day**

Can request quota increase via Google Cloud Console (requires compliance audit).

---

## Detecting New Uploads

### Option A: YouTube PubSubHubbub (Push Notifications) — RECOMMENDED

Zero API quota cost. Near-real-time. Officially supported.

**Subscribe:**
```
POST https://pubsubhubbub.appspot.com/subscribe
Content-Type: application/x-www-form-urlencoded

hub.callback=https://clipflow.org/api/webhooks/youtube
hub.topic=https://www.youtube.com/feeds/videos.xml?channel_id=UC...
hub.verify=async
hub.mode=subscribe
hub.lease_seconds=432000   (5 days max)
```

**Verification:** Google sends a GET to your callback with `hub.challenge` query param — respond with the challenge string (200 OK).

**Notification:** Google POSTs Atom XML to your callback when a new video is uploaded or metadata changes:

```xml
<feed>
  <entry>
    <yt:videoId>VIDEO_ID</yt:videoId>
    <yt:channelId>CHANNEL_ID</yt:channelId>
    <title>New Video Title</title>
    <published>2026-03-21T10:00:00+00:00</published>
  </entry>
</feed>
```

After receiving the video ID, call `videos.list` for full metadata (1 quota unit).

**Must re-subscribe before lease expires** — use a BullMQ repeatable job every 4 days.

### Option B: Polling Uploads Playlist

Poll `playlistItems.list` on a cron schedule. Cost: 1 unit per poll per channel.

- Every 15 min × 100 channels = 9,600 units/day (too expensive)
- Every 1 hour × 100 channels = 2,400 units/day (feasible)

Use as fallback alongside PubSubHubbub.

### Option C: YouTube RSS Feed (Free, No Auth)

```
https://www.youtube.com/feeds/videos.xml?channel_id=UC...
```

- Free, no API key, no quota
- Only returns 15 most recent videos
- Limited metadata (title, video ID, published date, description — **no tags**)
- Good as a cheap polling backup to detect new video IDs, then call API for full details

### Recommended Strategy

1. **Primary:** PubSubHubbub push notifications (zero quota, near-real-time)
2. **Backup:** RSS feed polling every 30 min (zero quota, catches missed pushes)
3. **Enrichment:** `videos.list` API call only when new video detected (1 unit)

---

## Suggested Implementation Plan

### Phase 1 — YouTube Channel Linking

**New files:**
- `apps/web/src/app/api/auth/youtube/link/route.ts` — Initiates Google OAuth
- `apps/web/src/app/api/auth/youtube/callback/route.ts` — Exchanges code for tokens, stores in Account table
- `apps/web/src/app/api/accounts/youtube/route.ts` — Check YouTube connection status

**Schema changes:**
- Add `YOUTUBE` to `Platform` enum (or reuse `YOUTUBE_SHORTS`)
- Optionally add a `YouTubeChannel` model to store channel ID, uploads playlist ID, channel name

**Store in Account table:** `provider: "google-youtube"`, `providerAccountId: channelId`, access/refresh tokens.

### Phase 2 — Video Metadata Sync

**New files:**
- `apps/web/src/app/api/youtube/videos/route.ts` — List YouTube videos for linked channel
- `apps/web/src/app/api/youtube/sync/route.ts` — Trigger a manual sync
- `apps/worker/src/handlers/youtube-sync.ts` — BullMQ job to sync videos

**Flow:**
1. Read access_token from Account (refresh if expired)
2. `channels.list?mine=true` → get uploads playlist ID
3. `playlistItems.list?playlistId=UU...` → get video IDs
4. `videos.list?id=ID1,ID2,...` → get full metadata (title, description, tags, thumbnails)
5. Upsert Video records in database

**New JobType:** `YOUTUBE_SYNC`

### Phase 3 — Automatic New Upload Detection

**New files:**
- `apps/web/src/app/api/webhooks/youtube/route.ts` — PubSubHubbub callback (handles GET verification + POST notifications)
- `apps/worker/src/handlers/youtube-subscribe.ts` — Job to subscribe/renew PubSubHubbub

**Flow:**
1. On channel link → subscribe to PubSubHubbub
2. BullMQ repeatable job every 4 days → re-subscribe
3. On push notification → enqueue `YOUTUBE_SYNC` job for that video ID
4. Backup: BullMQ repeatable job every 30 min → poll RSS feed, enqueue sync for any new IDs

### Phase 4 — UI

- Dashboard page to browse synced YouTube videos
- "Import from YouTube" button that shows linked channel's videos instead of manual URL input
- Auto-populated title, description, tags, thumbnail when selecting a video
- Settings page to link/unlink YouTube channel

---

## Alternative Data Sources (No API Quota)

| Approach | Pros | Cons |
|----------|------|------|
| **YouTube Data API v3** | Full metadata, tags, stats, official | Quota limits, OAuth verification |
| **YouTube RSS feed** | Free, no auth, no quota | 15 videos max, no tags |
| **yt-dlp `--dump-json`** | Very detailed metadata, no quota, already installed | Can't discover new uploads, slower, unofficial |
| **YouTube oEmbed** | Simple, no auth | Title + thumbnail only |

**yt-dlp hybrid approach:** Use yt-dlp's `--dump-json` to get full metadata (including tags) for individual videos, avoiding API quota entirely for enrichment. Only use the API for listing/discovering videos.

```bash
yt-dlp --dump-json "https://youtube.com/watch?v=VIDEO_ID"
```

Returns: title, description, tags, thumbnails (multiple sizes), duration, upload_date, view_count, like_count, channel info, categories, and more.

---

## Key Risks & Considerations

1. **OAuth Verification:** `youtube.readonly` is a sensitive scope — Google requires app verification (privacy policy, homepage, demo video). Takes 2-6 weeks.
2. **Quota limits:** 10,000 units/day is generous for a small app but could become limiting at scale. PubSubHubbub + RSS polling minimizes quota usage.
3. **Token refresh:** Google access tokens expire in 1 hour. Must implement automatic refresh before API calls.
4. **PubSubHubbub reliability:** Occasionally misses notifications. RSS polling backup is essential.
5. **Lease renewal:** PubSubHubbub leases expire after 5 days max. Missing a renewal = no notifications until re-subscribed.
