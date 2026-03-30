# TikTok Sync Feature

Sync existing TikTok videos into ClipFlow with engagement stats (views, likes, comments, shares).

---

## Overview

When a user connects their TikTok account, they should be able to sync their existing content into ClipFlow. This uses the TikTok Content Posting API / Video Query API.

---

## API Endpoints Used

### Fetch User Videos

```
POST https://open.tiktokapis.com/v2/video/list/
  ?fields=id,title,video_description,duration,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count

Headers:
  Authorization: Bearer {access_token}
  Content-Type: application/json

Body:
  { "max_count": 20 }
```

- Returns paginated list of user's videos
- Supports cursor-based pagination via `cursor` in request body
- Max 20 videos per request

### Response Fields

| Field | Description |
|-------|-------------|
| `id` | TikTok video ID |
| `title` | Video title |
| `video_description` | Full description/caption |
| `duration` | Video duration in seconds |
| `cover_image_url` | Thumbnail URL |
| `share_url` | Permanent link to the video |
| `create_time` | Unix timestamp of publish time |
| `like_count` | Number of likes |
| `comment_count` | Number of comments |
| `share_count` | Number of shares |
| `view_count` | Number of views |

---

## Required Scopes

The following scopes are needed (already requested in the OAuth flow):

| Scope | Purpose |
|-------|---------|
| `user.info.basic` | Read profile info |
| `video.list` | **Required for sync** — list user's videos with stats |
| `video.publish` | Publish videos (already have) |
| `video.upload` | Upload videos (already have) |

**Important:** The `video.list` scope is not currently requested in the OAuth flow. It must be added to enable sync.

---

## Implementation Plan

### 1. Add `video.list` Scope to OAuth Flow

Update `apps/web/src/app/api/auth/tiktok/link/route.ts`:
- Add `video.list` to the scope parameter
- Users will need to re-authorize to grant this new scope

### 2. Add TikTok Sync Handler in Worker

Create `apps/worker/src/handlers/tiktok-sync.ts`:

- Accept `platformAccountId` and `userId` from the job
- Fetch the PlatformAccount to get `accessToken`
- Paginate through `/v2/video/list/` to get all videos
- For each video:
  - Check if already imported (by `sourceUrl` containing the share_url)
  - Create a `Video` record with title, description, thumbnail, duration
  - Store engagement stats (views, likes, comments, shares)

### 3. Add TIKTOK to Sync Route

Update `apps/web/src/app/api/platforms/[platform]/sync/route.ts`:

- Add `'TIKTOK'` to `SYNC_PLATFORMS` array
- Add TikTok case that queues a `PLATFORM_SYNC` job with platform info

### 4. Store Engagement Stats

Same schema changes as the Instagram sync feature — add stats columns to the Video model:

```prisma
model Video {
  // ... existing fields
  viewCount       Int?
  likeCount       Int?
  commentCount    Int?
  shareCount      Int?
  platform        String?
  platformMediaId String?
}
```

### 5. UI: Display Stats

Update video cards and detail pages to show engagement stats.

---

## Limitations & Considerations

- **Video download:** TikTok API does not provide a direct download URL for the video file. The `share_url` is a web link. To actually download the video, you'd need to use yt-dlp or a similar tool with the share URL
- **Rate limits:** TikTok API has rate limits. Implement pagination delays for large accounts
- **Scope re-authorization:** Existing connected accounts will need to disconnect and reconnect to grant the `video.list` scope
- **Cover image expiration:** TikTok cover image URLs may expire. Download and store in R2 during sync
- **Token refresh:** TikTok access tokens expire. The refresh token flow should be used to keep tokens valid
- **App review:** The `video.list` scope may require additional app review approval from TikTok before production use
