# Instagram Integration Setup Guide

Step-by-step instructions for setting up Instagram API access so ClipFlow can publish Reels and sync content.

---

## Prerequisites

- A Facebook account
- An Instagram account switched to **Business** or **Creator** account type (Personal accounts cannot use the Content Publishing API)

---

## Step 1: Switch Instagram to a Business or Creator Account

1. Open the Instagram app on your phone
2. Go to your profile → tap the hamburger menu (☰) → **Settings and privacy**
3. Scroll down to **Account type and tools** → **Switch to professional account**
4. Choose either **Creator** or **Business** (both work for API access)
5. Follow the prompts to select a category and complete the switch
6. **Link your Instagram account to a Facebook Page:**
   - Go to **Settings and privacy** → **Account Center** → **Accounts**
   - Make sure your Instagram account and Facebook account are both added
   - In your Facebook Page settings, go to **Linked Accounts** and connect your Instagram professional account

> **Important:** The Instagram Content Publishing API only works with Business or Creator accounts that are linked to a Facebook Page.

---

## Step 2: Create a Meta (Facebook) Developer Account

1. Go to [developers.facebook.com](https://developers.facebook.com/)
2. Click **Get Started** or **Log In** with your Facebook account
3. Accept the Meta Platform Terms and Developer Policies
4. Verify your account (email or phone verification may be required)
5. You should land on the Meta Developer Dashboard

---

## Step 3: Create a Meta App

1. From the Developer Dashboard, click **Create App**
2. Select **Other** for the use case (or **Business** if prompted)
3. Select app type: **Business**
4. Fill in:
   - **App Name:** `ClipFlow` (or your preferred name)
   - **App Contact Email:** your email
   - **Business Portfolio:** select yours or create one
5. Click **Create App**

---

## Step 4: Add Instagram Product to the App

1. In your app's dashboard, find **Add Products** in the left sidebar
2. Find **Instagram** and click **Set Up**
3. This adds the Instagram Graph API product to your app

---

## Step 5: Configure Instagram API Settings

1. In the left sidebar, go to **Instagram** → **Basic Display** (or **API Setup**)
2. Note your **Instagram App ID** and **Instagram App Secret**
3. Under **OAuth Settings**, add your redirect URI:
   ```
   https://clipflow.org/api/auth/instagram/callback
   ```
   For local development also add:
   ```
   http://localhost:3100/api/auth/instagram/callback
   ```
4. Under **Deauthorize Callback URL**, add:
   ```
   https://clipflow.org/api/auth/instagram/deauthorize
   ```
5. Under **Data Deletion Request URL**, add:
   ```
   https://clipflow.org/api/auth/instagram/data-deletion
   ```

---

## Step 6: Configure Facebook Login

1. In the left sidebar, go to **Facebook Login** → **Settings**
   - If Facebook Login isn't added yet, go to **Add Products** and add it
2. Under **Valid OAuth Redirect URIs**, add:
   ```
   https://clipflow.org/api/auth/instagram/callback
   http://localhost:3100/api/auth/instagram/callback
   ```
3. Make sure **Client OAuth Login** and **Web OAuth Login** are enabled

---

## Step 7: Set Required Permissions

The following permissions are needed. Request them under **App Review** → **Permissions and Features**:

| Permission | Purpose | Review Required? |
|-----------|---------|-----------------|
| `instagram_basic` | Read profile info and media | Yes (for production) |
| `instagram_content_publish` | Publish Reels to Instagram | Yes (for production) |
| `pages_show_list` | List Facebook Pages (needed for IG business account lookup) | Yes (for production) |
| `pages_read_engagement` | Read Page data linked to IG | Yes (for production) |

> **Note:** During development, you can test with your own account without going through App Review. Add yourself as a test user under **Roles** → **Test Users**, or just use the app while it's in Development mode (only works for accounts with a role on the app).

---

## Step 8: App Review (for Production)

To use the API with accounts other than your own, you must submit for App Review:

1. Go to **App Review** → **Requests**
2. For each permission listed above, click **Request** and provide:
   - A description of how ClipFlow uses the permission
   - A screencast/video walkthrough demonstrating the feature
   - Step-by-step instructions for the reviewer to test it
3. Submit for review — this can take several business days to weeks
4. Once approved, switch the app from **Development** to **Live** mode under **App Settings** → **Basic** → **App Mode**

---

## Step 9: Add Credentials to ClipFlow

Add the following to your `.env` file:

```env
INSTAGRAM_CLIENT_ID=your_facebook_app_id
INSTAGRAM_CLIENT_SECRET=your_facebook_app_secret
```

> **Note:** The "client ID" for Instagram API is actually your **Facebook App ID**, and the "client secret" is your **Facebook App Secret**. You can find these under **App Settings** → **Basic** in the Meta Developer Dashboard.

---

## Step 10: Verify the Setup

1. Start ClipFlow locally
2. Go to `/dashboard/accounts`
3. Click **Connect** next to Instagram
4. You should be redirected to Facebook Login
5. Authorize the app and grant the requested permissions
6. You should be redirected back to ClipFlow with your Instagram account connected

---

## API Flow Reference

### OAuth Flow (Facebook Login for Instagram)

```
1. Redirect user to:
   https://www.facebook.com/v21.0/dialog/oauth
     ?client_id={app_id}
     &redirect_uri={callback_url}
     &scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement
     &response_type=code

2. User authorizes → redirected to callback with ?code=...

3. Exchange code for short-lived token:
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?client_id={app_id}
     &client_secret={app_secret}
     &redirect_uri={callback_url}
     &code={code}

4. Exchange for long-lived token (60-day expiry):
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app_id}
     &client_secret={app_secret}
     &fb_exchange_token={short_lived_token}

5. Get Facebook Pages:
   GET https://graph.facebook.com/v21.0/me/accounts
     ?access_token={long_lived_token}

6. Get Instagram Business Account ID from Page:
   GET https://graph.facebook.com/v21.0/{page_id}
     ?fields=instagram_business_account
     &access_token={page_access_token}
```

### Publishing Reels

```
1. Create media container:
   POST https://graph.facebook.com/v21.0/{ig_user_id}/media
     ?media_type=REELS
     &video_url={public_video_url}
     &caption={caption_with_hashtags}
     &access_token={token}

2. Poll container status:
   GET https://graph.facebook.com/v21.0/{container_id}
     ?fields=status_code
     &access_token={token}
   (Wait for status_code = "FINISHED")

3. Publish:
   POST https://graph.facebook.com/v21.0/{ig_user_id}/media_publish
     ?creation_id={container_id}
     &access_token={token}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Instagram account is not a Business or Creator account" | Switch account type in Instagram app settings (Step 1) |
| "No Instagram business account linked to Page" | Link your IG account to a Facebook Page via Account Center |
| Permissions stuck in review | Make sure screencasts clearly demonstrate the feature; follow Meta's review guidelines |
| Token expired | Long-lived tokens last 60 days; implement token refresh before expiry |
| "Media type not supported" | Only Reels (video ≤60s) are supported via Content Publishing API |
| Upload fails with "video processing" | Video must be publicly accessible via URL for container creation; ensure the URL is reachable |
