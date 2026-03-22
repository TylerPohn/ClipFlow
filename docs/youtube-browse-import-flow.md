# YouTube Browse & Import Flow

## Problem

Currently, YouTube connection UI only appears inside a video detail page sidebar. But the user needs to connect YouTube **first**, then browse their channel's videos to select which ones to import into ClipFlow for repurposing to TikTok.

The current flow is backwards — you need a video before you can connect YouTube, but you need YouTube connected to discover videos.

## Desired Flow

1. User goes to a **YouTube** page/tab in the dashboard
2. If not connected: sees "Connect YouTube" button
3. After connecting: sees a grid/list of their YouTube channel's videos (pulled via API sync)
4. User clicks a video to import it into ClipFlow
5. Video goes through the existing DOWNLOAD → PROCESS pipeline
6. User then publishes to TikTok from the video detail page

## Implementation

### 1. Dashboard YouTube Page

**New file:** `apps/web/src/app/dashboard/youtube/page.tsx`

- If YouTube not connected: show connect button (links to `/api/auth/youtube/link`)
- If connected: show channel info + grid of synced videos
- "Sync Now" button to pull latest videos from channel
- Each video card shows: thumbnail, title, duration, publish date
- "Import" button on each card → creates a ClipFlow Video record and starts the download pipeline

### 2. Import API Endpoint

**New file:** `apps/web/src/app/api/youtube/import/route.ts`

- Accepts a YouTube video ID
- Creates a Video record with `sourceUrl: https://www.youtube.com/watch?v=VIDEO_ID`
- Pre-populates title, description, thumbnail from the synced metadata
- Enqueues a DOWNLOAD job (same as manual URL import)

### 3. Dashboard Navigation

- Add "YouTube" link to the dashboard nav/sidebar
- Route: `/dashboard/youtube`

### 4. Move Connect Button

- Remove YouTube connect section from video detail page sidebar (or keep as secondary)
- Primary connection flow lives on `/dashboard/youtube`

## Data Flow

```
/dashboard/youtube
  ├── Not connected → "Connect YouTube" → OAuth flow → redirect back
  ├── Connected, no videos → "Sync Now" → BullMQ YOUTUBE_SYNC → videos appear
  └── Connected, videos synced → Grid of videos
        └── Click "Import" → POST /api/youtube/import
              ├── Creates Video record (pre-filled metadata)
              ├── Enqueues DOWNLOAD job
              └── Redirects to /dashboard/videos/[id]
                    └── Process → Publish to TikTok
```

## UI Wireframe

```
┌─────────────────────────────────────────────────┐
│  YouTube Videos            [Sync Now] [⚙ Channel] │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ ▓▓▓▓▓▓▓▓ │  │ ▓▓▓▓▓▓▓▓ │  │ ▓▓▓▓▓▓▓▓ │       │
│  │ ▓▓▓▓▓▓▓▓ │  │ ▓▓▓▓▓▓▓▓ │  │ ▓▓▓▓▓▓▓▓ │       │
│  │          │  │          │  │          │       │
│  │ Title... │  │ Title... │  │ Title... │       │
│  │ 5:32     │  │ 12:01    │  │ 3:45     │       │
│  │ [Import] │  │ [Import] │  │ [Import] │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ ...      │  │ ...      │  │ ...      │       │
│  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────┘
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/web/src/app/dashboard/youtube/page.tsx` | Create — main YouTube browse page |
| `apps/web/src/app/dashboard/youtube/page.module.css` | Create — styles |
| `apps/web/src/app/api/youtube/import/route.ts` | Create — import a YouTube video by ID |
| `apps/web/src/components/NavBar.tsx` | Modify — add YouTube nav link |
| `apps/web/src/app/dashboard/videos/[id]/page.tsx` | Modify — optional, keep or remove YouTube sidebar card |
