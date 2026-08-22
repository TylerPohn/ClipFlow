# Meta App Review — Instagram Permissions

Reference sheet for the Cliptopus Instagram app review submission. Everything
here is configuration/documentation only — it does not submit the review.

## App under review

| Field | Value |
|---|---|
| Product name | Cliptopus |
| App URL | https://cliptopus.com |
| Privacy policy | https://cliptopus.com/privacy |
| Terms of service | https://cliptopus.com/terms |
| Deauthorize callback | https://cliptopus.com/api/auth/instagram/deauthorize |
| Data deletion request | https://cliptopus.com/api/auth/instagram/data-deletion |

## Permissions requested

Only the two permissions the product actually calls are requested. Nothing else
is enabled.

| Permission | Where it is used |
|---|---|
| `instagram_business_basic` | Reads the connected professional account's user id and username (`GET /me?fields=user_id,username`) to display the linked account on the Platforms screen and to address publish calls. |
| `instagram_business_content_publish` | Publishes a processed video to the connected account as a Reel via `POST /{ig-user-id}/media` (`media_type=REELS`) then `POST /{ig-user-id}/media_publish`. |

Both strings are requested verbatim at authorization time
(`apps/web/src/app/api/auth/instagram/link/route.ts`).

## Reviewer test account

A dedicated Cliptopus account exists so the reviewer never needs the owner's
personal credentials.

| Field | Value |
|---|---|
| Sign-in URL | https://cliptopus.com/login |
| Email | `meta-review@cliptopus.com` |
| Password | See `docs/meta-app-review-credentials.local.md` (gitignored) |

This repository is public, so the reviewer password is kept out of version
control. Paste it into the App Review "Test user credentials" field from the
local file above.

The account is preloaded with one processed video ("When your package is
arriving Thursday", 12s) already in `READY` state, so the reviewer can go
straight to publishing without waiting on a download/transcode.

## Testing instructions (paste into App Review)

1. Go to https://cliptopus.com/login and sign in with the email and password
   above.
2. You land on the dashboard. One video, "When your package is arriving
   Thursday", is already processed and ready to publish.
3. Open **Platforms** in the left navigation, then choose **Instagram**.
4. Click **Connect**. You are redirected to Instagram's authorization screen,
   which requests `instagram_business_basic` and
   `instagram_business_content_publish`. Approve with any Instagram
   professional (Business or Creator) account.
5. After the redirect back, the Platforms screen shows the account as
   **Connected** along with its Instagram username — this is
   `instagram_business_basic` in use.
6. Return to the dashboard and click the video to open it.
7. In the **Instagram** card on the right-hand side of the video page, enter a
   caption and click **Post to Instagram**.
8. Cliptopus creates a Reels media container and publishes it — this is
   `instagram_business_content_publish` in use. The button shows
   "Publishing..." while the job runs, and **Post Status** changes to
   **POSTED** when it finishes. A **View on Instagram** link appears next to
   the status and opens the published Reel.
9. To verify revocation, go back to Platforms → Instagram and click
   **Disconnect**. The stored token and account record are deleted.

Note for the reviewer: an Instagram **professional** account (Business or
Creator) is required. The Content Publishing API rejects personal accounts.

## Outstanding blocker

The two permissions cannot be added to the review request in the App Dashboard
until **Brass Ridge** completes Meta **business verification**. Both permission
buttons render but stay disabled until that finishes. Business verification
needs the company's exact legal name, address and registration documents, so it
has to be completed by the business owner in Meta Business Manager.

Everything else on the Cliptopus side — website metadata, reviewer account,
preloaded test video, and both permission integrations — is implemented and
live.
