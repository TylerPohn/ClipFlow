# YouTube Integration Setup Guide

## 1. Google Cloud Console

1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one)
3. Navigate to **APIs & Services > Library**
4. Search for **YouTube Data API v3** and enable it
5. Navigate to **APIs & Services > Credentials**
6. Click **Create Credentials > OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: `ClipFlow`
   - Authorized redirect URIs: `https://clipflow.org/api/auth/youtube/callback`
   - For local dev, also add: `http://localhost:3100/api/auth/youtube/callback`
7. Copy the **Client ID** and **Client Secret**

## 2. OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. Choose **External** user type
3. Fill in required fields:
   - App name: `ClipFlow`
   - User support email: your email
   - Developer contact email: your email
4. Add scope: `https://www.googleapis.com/auth/youtube.readonly`
5. Add your Google account as a **test user** (required while in testing mode)
6. Submit — you can use it immediately in testing mode with up to 100 test users

> **Note:** To remove the "unverified app" warning and allow any Google user to connect, you'll need to submit for Google verification. This requires a privacy policy (https://clipflow.org/privacy), homepage, and a demo video. Takes 2–6 weeks.

## 3. Environment Variables

Add to your `.env` (local) and on the server:

```
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

### On the server

```bash
ssh -i ~/.ssh/id_ed25519 tyler@192.168.2.112
cd /home/tyler/apps/clipflow

# Edit the .env file used by PM2
nano .env

# Add the two variables above, save
```

## 4. Database Migration

Run the Prisma migration to create the `YouTubeChannel` table and add `YOUTUBE` to the Platform enum:

```bash
# Local
npx prisma db push --config=libs/db/prisma/prisma.config.ts

# Server
ssh -i ~/.ssh/id_ed25519 tyler@192.168.2.112
cd /home/tyler/apps/clipflow
npx prisma db push --config=libs/db/prisma/prisma.config.ts
```

## 5. Deploy

```bash
ssh -i ~/.ssh/id_ed25519 tyler@192.168.2.112
cd /home/tyler/apps/clipflow
git pull
npm install
npx prisma db push --config=libs/db/prisma/prisma.config.ts
npx nx build web
pm2 restart clipflow-web clipflow-worker
```

## 6. PubSubHubbub Re-subscription (Optional Recurring Job)

PubSubHubbub leases expire after 5 days. The system auto-subscribes when a channel is linked, but you should set up a recurring job to re-subscribe all channels every 4 days.

You can do this by adding a BullMQ repeatable job on worker startup, or via a cron job:

```bash
# Example cron (runs every 4 days at 3am)
0 3 */4 * * curl -s -X POST https://clipflow.org/api/youtube/resubscribe > /dev/null
```

Or the worker can self-register the repeatable job — this is not wired up yet and can be added later.

## 7. Verify It Works

1. Go to https://clipflow.org (or localhost:3100)
2. Open any video detail page
3. In the right sidebar, you should see a **YouTube Channel** card
4. Click **Connect YouTube**
5. Sign in with Google, grant `youtube.readonly` permission
6. You'll be redirected back — the card should now show your channel name
7. Click **Sync Videos** to pull your uploads into ClipFlow

## Quota Notes

- Default quota: 10,000 units/day
- A full sync of 50 videos costs ~3 units
- PubSubHubbub push notifications cost 0 units (only the enrichment `videos.list` call costs 1 unit per notification)
- If you need more quota, request an increase at https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas
