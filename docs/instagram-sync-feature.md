# Instagram Sync Feature

Sync existing Instagram Reels/posts into ClipFlow with engagement stats (views, likes, comments).

---

## Overview

When a user connects their Instagram account, they should be able to sync their existing content into ClipFlow. This mirrors the existing YouTube sync functionality but uses the Instagram Graph API.

---

## API Endpoints Used

### Fetch User Media

```
GET https://graph.facebook.com/v21.0/{ig_user_id}/media
  ?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp
  &access_token={page_access_token}
```

- Returns paginated list of media (Reels, images, carousels, videos)
- Supports cursor-based pagination via `after` param
- Filter for `media_type=VIDEO` to get only Reels/videos

### Fetch Media Insights (Engagement Stats)

```
GET https://graph.facebook.com/v21.0/{media_id}/insights
  ?metric=plays,likes,comments,shares,reach,saved
  &access_token={page_access_token}
```

**Available metrics for Reels:**
| Metric | Description |
|--------|-------------|
| `plays` | Total number of plays (includes replays) |
| `likes` | Number of likes |
| `comments` | Number of comments |
| `shares` | Number of shares |
| `reach` | Number of unique accounts that saw the reel |
| `saved` | Number of saves |

**Note:** Insights are only available for media owned by the authenticated user and require `instagram_basic` permission.

### Fetch Individual Media Details

```
GET https://graph.facebook.com/v21.0/{media_id}
  ?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count
  &access_token={page_access_token}
```

- `like_count` and `comments_count` are available directly on the media object
- `media_url` provides the video/image URL (expires after a period)

---

## Implementation Plan

### 1. Add Instagram Sync Handler in Worker

Create `apps/worker/src/handlers/instagram-sync.ts`:

- Accept `platformAccountId` and `userId` from the job
- Fetch the PlatformAccount to get `platformUserId` (IG user ID) and `accessToken`
- Paginate through `/{ig_user_id}/media` to get all media
- Filter for video content (`media_type === 'VIDEO'`)
- For each video:
  - Check if already imported (by `sourceUrl` containing the media permalink)
  - Create a `Video` record with title from caption, thumbnail, duration
  - Fetch insights for engagement stats
  - Store stats in `Video.metadata` or a new stats field

### 2. Add INSTAGRAM to Sync Route

Update `apps/web/src/app/api/platforms/[platform]/sync/route.ts`:

- Add `'INSTAGRAM'` to `SYNC_PLATFORMS` array
- Add Instagram case that queues a `PLATFORM_SYNC` job with platform info

### 3. Store Engagement Stats

**Option A:** Use the existing `Video` model's fields + metadata JSON:
- `title` ← caption (first line or truncated)
- `description` ← full caption
- `thumbnailUrl` ← thumbnail_url from API
- `sourceUrl` ← permalink
- Store stats (views, likes, comments, shares) in a JSON metadata field

**Option B:** Add dedicated stats columns to Video model:
```prisma
model Video {
  // ... existing fields
  viewCount     Int?
  likeCount     Int?
  commentCount  Int?
  shareCount    Int?
  platform      String?    // 'INSTAGRAM', 'YOUTUBE', etc.
  platformMediaId String?  // original platform ID for re-syncing stats
}
```

Option B is preferred — it enables sorting/filtering by stats across platforms and avoids JSON querying overhead.

### 4. UI: Display Stats on Video Cards

Update the platform browse page and video detail page to show engagement stats when available.

---

## Limitations & Considerations

- **Media URL expiration:** Instagram media URLs are temporary. Store the permalink (permanent) as `sourceUrl` and the media URL only for initial download
- **Rate limits:** Instagram Graph API has rate limits (200 calls/user/hour). Implement pagination delays for large accounts
- **Insights availability:** Insights may not be available for very old posts or posts with very low engagement
- **Media types:** Only VIDEO and REEL types should be synced (skip IMAGE and CAROUSEL_ALBUM unless needed)
- **Token refresh:** Page access tokens from the long-lived user token don't expire, but the user token itself expires in 60 days — will need a refresh mechanism
