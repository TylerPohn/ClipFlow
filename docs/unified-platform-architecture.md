# Unified Platform Architecture

**Goal:** Treat all social platforms (YouTube, TikTok, Instagram, X) uniformly so every platform supports syncing, posting, and browsing — with the same UI components adapted to each platform's nuances.

---

## Current State

| Capability | YouTube | TikTok | Instagram | X |
|------------|---------|--------|-----------|---|
| OAuth / Link Account | Yes | Yes | No | No |
| Sync / Import Content | Yes (PubSubHubbub + manual) | No | No | No |
| Post / Publish | No | Yes (direct post API) | No | No |
| Dedicated Browse Page | Yes (`/dashboard/youtube`) | No | No | No |
| Account Metadata | Rich (`YouTubeChannel` model) | Minimal (connected boolean) | N/A | N/A |
| Nav Link | Yes | No | No | No |

### Key Architectural Issues

1. **YouTube has a dedicated `YouTubeChannel` model** — TikTok has nothing equivalent. Need a generic `PlatformAccount` model.
2. **Upload handler is hardcoded to TikTok** — needs platform dispatch.
3. **YouTube sync is its own job type** — needs to become a generic `PLATFORM_SYNC` job.
4. **UI components are duplicated/split** — YouTube has a browse page, TikTok only lives in the video detail sidebar.
5. **No centralized account management page** — linking is scattered across individual feature pages.

---

## Target State

| Capability | YouTube | TikTok | Instagram | X |
|------------|---------|--------|-----------|---|
| OAuth / Link Account | Yes | Yes | Yes | Yes |
| Sync / Import Content | Yes | Yes (if API allows) | Yes | Yes |
| Post / Publish | Yes (Shorts) | Yes | Yes (Reels) | Yes |
| Browse Page | Yes (shared component) | Yes (shared component) | Yes (shared component) | Yes (shared component) |
| Account Metadata | Unified `PlatformAccount` | Unified `PlatformAccount` | Unified `PlatformAccount` | Unified `PlatformAccount` |

---

## Phase 1: Unified Data Model

### 1.1 New `PlatformAccount` Model

Replace `YouTubeChannel` and the ad-hoc TikTok account checks with a single model:

```prisma
model PlatformAccount {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  platform        Platform
  platformUserId  String    // channel ID, TikTok open_id, IG user ID, X user ID
  displayName     String?   // channel name, TikTok username, etc.
  handle          String?   // @handle
  avatarUrl       String?
  accessToken     String
  refreshToken    String?
  tokenExpiresAt  DateTime?
  metadata        Json?     // platform-specific extras (uploadsPlaylistId, etc.)
  lastSyncedAt    DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([userId, platform, platformUserId])
}
```

- **`metadata` (Json)** stores platform-specific fields:
  - YouTube: `{ uploadsPlaylistId, subscribedToPush, pushExpiresAt }`
  - TikTok: `{ creatorLevel }` (if needed)
  - Instagram: `{ igBusinessAccountId }`
  - X: `{ }` (OAuth 2.0 PKCE, minimal extra state)

### 1.2 Extend Platform Enum

```prisma
enum Platform {
  TIKTOK
  INSTAGRAM
  YOUTUBE
  YOUTUBE_SHORTS
  X
}
```

### 1.3 Migration Path

- Write a migration that creates `PlatformAccount`.
- Backfill from `YouTubeChannel` + `Account` (where provider = 'tiktok').
- Move token storage from NextAuth `Account` table into `PlatformAccount`.
- Drop `YouTubeChannel` model after migration verified.

---

## Phase 2: Unified OAuth & Account Management

### 2.1 Centralized Accounts Page (`/dashboard/accounts`)

Single page showing all connected platforms with:
- Platform icon + name
- Connected account info (avatar, display name, handle) or "Connect" button
- "Disconnect" action
- Last synced timestamp (if applicable)

### 2.2 Generalized OAuth Routes

Refactor from per-platform route files to a pattern:

```
/api/auth/[platform]/link    → initiates OAuth for the given platform
/api/auth/[platform]/callback → handles OAuth callback, upserts PlatformAccount
```

Each platform has a config object:

```ts
// lib/platforms/registry.ts
export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  YOUTUBE: {
    displayName: 'YouTube',
    icon: YoutubeIcon,
    oauthScopes: ['youtube.readonly', 'youtube.upload'],
    supportsSync: true,
    supportsPost: true,
    postFields: { title: true, description: true, tags: true, visibility: true },
  },
  TIKTOK: {
    displayName: 'TikTok',
    icon: TikTokIcon,
    oauthScopes: ['user.info.basic', 'video.publish', 'video.upload'],
    supportsSync: false, // for now
    supportsPost: true,
    postFields: { title: true, description: false, tags: true, visibility: true },
  },
  INSTAGRAM: {
    displayName: 'Instagram',
    icon: InstagramIcon,
    oauthScopes: ['instagram_basic', 'instagram_content_publish'],
    supportsSync: true,
    supportsPost: true,
    postFields: { title: false, description: true, tags: true, visibility: false },
  },
  X: {
    displayName: 'X',
    icon: XIcon,
    oauthScopes: ['tweet.read', 'tweet.write', 'users.read', 'media.upload'],
    supportsSync: false,
    supportsPost: true,
    postFields: { title: false, description: true, tags: true, visibility: false },
  },
};
```

### 2.3 Upload Page Prompt

If a user selects a platform in the publish flow but hasn't linked that account:
- Show inline prompt: "Connect your {platform} account to publish" with a link/button.
- After connecting (via popup or redirect), return to the same page with the account now linked.

---

## Phase 3: Unified Sync / Import

### 3.1 Generic Sync Job

Replace `YOUTUBE_SYNC` with `PLATFORM_SYNC`:

```ts
// worker/handlers/platform-sync.ts
export async function handlePlatformSync(job: Job<{ platformAccountId: string, specificVideoId?: string }>) {
  const account = await getPlatformAccount(job.data.platformAccountId);
  const syncer = getSyncer(account.platform); // returns YouTubeSyncer, TikTokSyncer, etc.
  await syncer.sync(account, job.data.specificVideoId);
}
```

Each syncer implements:

```ts
interface PlatformSyncer {
  sync(account: PlatformAccount, specificVideoId?: string): Promise<void>;
  listVideos(account: PlatformAccount, cursor?: string): Promise<PlatformVideo[]>;
  getVideoDetails(account: PlatformAccount, videoId: string): Promise<PlatformVideo>;
}
```

### 3.2 Generic Webhook Handler

```
/api/webhooks/[platform] → dispatches to platform-specific parser, enqueues PLATFORM_SYNC
```

YouTube keeps PubSubHubbub. Other platforms use their own notification mechanisms (or polling).

### 3.3 Generic Browse/Import API

```
GET  /api/platforms/[platform]/videos   → list synced videos from that platform
POST /api/platforms/[platform]/import   → import a specific video into ClipFlow
POST /api/platforms/[platform]/sync     → trigger manual sync
```

---

## Phase 4: Unified Publish / Post

### 4.1 Generic Upload Handler

Replace the TikTok-only upload handler with platform dispatch:

```ts
// worker/handlers/upload.ts
export async function handleUpload(job: Job<UploadJobData>) {
  const post = await getPost(job.data.postId);
  const account = await getPlatformAccount(post.userId, post.platform);
  const uploader = getUploader(post.platform); // TikTokUploader, YouTubeUploader, etc.
  await uploader.upload(account, post, job.data);
}
```

Each uploader implements:

```ts
interface PlatformUploader {
  upload(account: PlatformAccount, post: Post, data: UploadJobData): Promise<UploadResult>;
  checkStatus?(account: PlatformAccount, publishId: string): Promise<PublishStatus>;
}
```

### 4.2 Platform-Specific Post Fields

The publish UI adapts based on `PLATFORM_CONFIG[platform].postFields`:

| Field | YouTube | TikTok | Instagram | X |
|-------|---------|--------|-----------|---|
| Title | Yes | Yes (as caption) | No | No |
| Description | Yes | No | Yes (caption) | Yes (tweet text) |
| Tags/Hashtags | Yes | Yes | Yes | Yes (inline) |
| Visibility | Yes (public/private/unlisted) | Yes (self_only/public) | No | No |
| Thumbnail | Yes (custom upload) | No (auto-generated) | Yes (cover frame) | No |

### 4.3 Multi-Platform Publish

The video detail page publish section becomes a list of platform cards. Each card:
- Shows platform icon + connected account name
- Has platform-appropriate form fields
- Shows post status (draft / posting / posted / failed)
- Supports retry on failure

Users can publish to multiple platforms from the same page.

---

## Phase 5: Unified UI Components

### 5.1 Shared Browse Page (`/dashboard/platforms/[platform]`)

One page component that works for any platform:
- Account connection status header (with sync button if `supportsSync`)
- Video grid with platform-appropriate metadata
- Import buttons for un-imported videos
- Platform-specific badges (view count formatting, duration display, etc.)

### 5.2 Shared Account Card Component

```tsx
<PlatformAccountCard
  platform="YOUTUBE"
  account={account}         // null if not connected
  onConnect={() => ...}
  onDisconnect={() => ...}
  onSync={() => ...}        // only if supportsSync
/>
```

### 5.3 Shared Publish Card Component

```tsx
<PublishCard
  platform="TIKTOK"
  video={video}
  account={account}         // null → shows connect prompt
  existingPost={post}       // null → shows publish form, else shows status
  onPublish={(fields) => ...}
  onRetry={() => ...}
/>
```

### 5.4 Navigation

Replace the single "YouTube" nav link with a "Platforms" dropdown or section:
- YouTube
- TikTok
- Instagram
- X
- "Manage Accounts" link at bottom

---

## Phase 6: Add Instagram & X

### 6.1 Instagram (Reels via Meta Graph API)

- **OAuth:** Facebook Login → exchange for long-lived page token → get IG business account
- **Sync:** `GET /{ig-user-id}/media` — pull published Reels
- **Post:** Container-based upload flow:
  1. `POST /{ig-user-id}/media` with `media_type=REELS` + video URL → container ID
  2. Poll container status
  3. `POST /{ig-user-id}/media_publish` with container ID
- **Nuances:** Must be a Business or Creator account. 60s max for Reels. Caption but no separate title.

### 6.2 X (via X API v2)

- **OAuth:** OAuth 2.0 PKCE flow
- **Sync:** `GET /2/users/{id}/tweets` with `media.fields` — pull tweets with video
- **Post:** Two-step:
  1. Upload media via chunked upload (`POST /2/media/upload`)
  2. Create tweet referencing media ID (`POST /2/tweets`)
- **Nuances:** 140s max video. Tweet text serves as description. No separate title field. Hashtags are inline in tweet text.

---

## Implementation Order

1. **Data model** — `PlatformAccount` model + migration + backfill
2. **Platform registry** — `PLATFORM_CONFIG` with capabilities/fields per platform
3. **Refactor YouTube** — move from `YouTubeChannel` to `PlatformAccount`, update sync handler
4. **Refactor TikTok** — move token storage to `PlatformAccount`, update upload handler
5. **Accounts page** — centralized `/dashboard/accounts`
6. **Unified browse component** — replace `/dashboard/youtube` with `/dashboard/platforms/[platform]`
7. **Unified publish component** — replace sidebar TikTok section with multi-platform cards
8. **Upload page prompt** — inline "connect account" prompt when platform not linked
9. **Add Instagram** — OAuth + publish + sync
10. **Add X** — OAuth + publish + sync

---

## Platform Nuances to Track

| Nuance | Where It Matters |
|--------|-----------------|
| TikTok has no description field | Publish form: hide description, use title as caption |
| YouTube has visibility levels (public/private/unlisted) | Publish form: show visibility dropdown |
| Instagram requires Business/Creator account | Account linking: validate account type |
| X hashtags are inline in tweet text | Publish form: merge hashtags into description |
| YouTube PubSubHubbub needs re-subscription | Background job: keep `PLATFORM_SUBSCRIBE` for YouTube |
| TikTok direct post starts as SELF_ONLY | Post-publish note: remind user to change visibility on TikTok |
| Instagram Reels max 60s | Clip settings: warn if clip > 60s when Instagram selected |
| X video max 140s | Clip settings: warn if clip > 140s when X selected |
| YouTube Shorts max 60s | Clip settings: warn if clip > 60s when YouTube Shorts selected |
