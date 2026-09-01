# TikTok Direct Post Audit — Submission Pack

**Status as of 2026-08-31:** app review PASSED (Cliptopus is Live in Production since Jul 29, 2026, client key `awz73j356v53h9i7`, with Login Kit + Content Posting API + Webhooks and all six scopes granted). The **Direct Post audit is a separate gate and has not been applied for** — the portal still shows an enabled **Apply** button under Content Posting API → Direct Post.

Until that audit passes, every Direct Post is capped at `SELF_ONLY`; anything else returns:

```
403 unaudited_client_can_only_post_to_private_accounts
```

This doc is the pack for that application. (`tiktok-audit-demo-script.md` is the older app-review script and is now stale — it assumes the sandbox app and a not-yet-approved app.)

---

## 1. Usage description (paste into the Apply form)

> Cliptopus is a multi-platform video publishing dashboard. Creators import a video once — from a file or a YouTube URL — trim and caption it, then publish it to their connected accounts (TikTok, Instagram, YouTube) from a single composer.
>
> We use Direct Post so a creator can publish a finished video to their own TikTok profile without leaving the dashboard, rather than posting a draft and having to reopen the TikTok app to complete it. Direct Post is only ever invoked against the creator's own authorized account, only from an explicit click on the "Publish to TikTok" button, and only after the creator has filled in the composer described below. We never post on a creator's behalf on a schedule they did not set, never post to any account other than the one authorized via Login Kit, and never modify the creator's selections.
>
> Compliance with the Direct Post guidelines is implemented as follows. Before the composer is usable we call `/v2/post/publish/creator_info/query/` and drive the entire UI from that live response — we do not hardcode or cache any of it. The privacy selector is populated only from `privacy_level_options` and has **no default selection**: the creator must actively pick a visibility, and the publish button stays disabled until they do. The Comment / Duet / Stitch toggles are disabled when `comment_disabled` / `duet_disabled` / `stitch_disabled` are true. We show the creator's `max_video_post_duration_sec` and block publishing if the trimmed clip exceeds it. The commercial-content disclosure is off by default; turning it on requires the creator to specify "Your brand", "Branded content", or both, and we surface the resulting "Promotional content" / "Paid partnership" label. Branded content cannot be combined with "Only me" visibility — this is enforced in the UI, in the publish API, and again in the client library immediately before the init call. The Music Usage Confirmation link is displayed on every Direct Post, with the Branded Content Policy added when the post is declared as branded content.

Trim to fit the character limit if the form is shorter than this; the privacy-selector, disclosure, and Music Usage Confirmation sentences are the ones reviewers look for, so keep those.

---

## 2. Where each requirement is implemented

| Requirement | Implementation |
|---|---|
| `creator_info` queried before composer renders | `apps/web/src/app/api/accounts/tiktok/creator-info/route.ts`; fetched at `page.tsx:471` when Direct Post mode is entered |
| Privacy options from `privacy_level_options`, no default | `page.tsx:1207-1223` (`value={form.tiktokPrivacy ?? ''}`, initialised to `''`) |
| Publish blocked until privacy chosen | `tiktokDirectInvalid`, `page.tsx:927` |
| Interaction toggles reflect creator_info | `page.tsx:1246` |
| Max duration respected | `tiktokTooLong`, `page.tsx:923` — gates on the **trimmed** clip length, with an inline error |
| Commercial disclosure, off by default | `page.tsx` disclosure block; requires brandOrganic or brandedContent when on |
| Branded content never private | UI `brandedPrivateConflict`; API `apps/web/src/app/api/videos/[id]/publish/route.ts:76`; library `libs/video-processing/src/tiktok.ts:241` |
| Music Usage Confirmation shown every post | `page.tsx:1447` — rendered for all Direct Posts, Branded Content Policy added when branded |

---

## 3. Demo video

Target 2–3 minutes. The app is approved now, so **record against production `https://cliptopus.com`** — no sandbox, no Target User setup.

### Critical constraint

The audit has not passed *while you are recording it*, so a public Direct Post will still 403. Record the demo choosing **"Only me"** visibility, which succeeds pre-audit and still exercises the full Direct Post path (`/v2/post/publish/video/init/` → chunked upload → status poll → the post appearing on the profile as private).

Put this on screen so the reviewer isn't confused:

> *"Direct Post is pending audit, so this demo posts with 'Only me' visibility — the only level an unaudited client may use. The composer offers every level returned by creator_info; the restriction is TikTok's, not the app's."*

### Shot list

1. **(0:00–0:10)** Landing page at cliptopus.com, then log in. On-screen: *"Cliptopus — multi-platform video publishing."*
2. **(0:10–0:25)** Dashboard → open a READY video. Show the trim/caption panel briefly so it's clear the video is the creator's own content prepared in-app.
3. **(0:25–0:40)** Scroll to the TikTok card. Select **Direct Post**. Narrate: *"Entering Direct Post triggers a creator_info query — everything below is populated from that response."* Show the avatar/nickname appearing.
4. **(0:40–1:00)** **Privacy selector.** Open it. Show it reads "Select who can view this video" with nothing preselected, and that the options match creator_info. Narrate: *"There is no default. The creator must choose."* Show the publish button greyed out until a choice is made. **This is the single most important beat — hold on it.**
5. **(1:00–1:20)** **Interaction toggles + duration.** Show Comment/Duet/Stitch and the "Max video length" line. If you have a too-long clip handy, show the blocking error; otherwise just narrate that it's enforced.
6. **(1:20–1:50)** **Commercial disclosure.** Toggle it on. Show the "you need to indicate…" error with neither sub-option picked. Tick **Branded content** → show the "Paid partnership" label and that "Only me" becomes unselectable with the explanatory message. Then untick back to a non-commercial post. Narrate each.
7. **(1:50–2:00)** Show the **Music Usage Confirmation** line present on the plain, non-commercial post.
8. **(2:00–2:30)** Pick **"Only me"**, click Publish. Show the status going to published, then **open TikTok and show the video on the profile** marked private. This is the proof-of-delivery beat — do not skip it.

### Checklist before submitting

- [ ] Domain shown in the video is `cliptopus.com`, matching the app's Web/Desktop URL
- [ ] Privacy selector shown with no preselection, and the disabled publish button
- [ ] Disclosure validation error shown on camera
- [ ] Branded-content + "Only me" conflict shown on camera
- [ ] Music Usage Confirmation visible on a non-commercial post
- [ ] Final TikTok profile shot proving the post landed
- [ ] On-screen note explaining the "Only me" pre-audit constraint
- [ ] Uploaded unlisted to YouTube or Drive with link-viewing on — not login-gated
