'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import StatusBadge from '@/components/StatusBadge';
import { PLATFORM_CONFIG, type PlatformConfig } from '@clipflow/shared/src/platforms';
import styles from './page.module.css';

interface Post {
  id: string;
  platform: string;
  status: 'DRAFT' | 'UPLOADING' | 'POSTED' | 'FAILED' | 'SCHEDULED';
  caption?: string;
}

interface Video {
  id: string;
  title: string;
  description?: string;
  youtubeUrl: string;
  thumbnailUrl?: string | null;
  duration?: number;
  status: 'PENDING' | 'DOWNLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  errorMessage?: string;
  createdAt: string;
  posts?: Post[];
}

interface AccountInfo {
  connected: boolean;
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
  lastSyncedAt?: string;
}

interface PlatformFormState {
  title: string;
  description: string;
  tags: string;
  visibility: string;
  postMode?: 'inbox' | 'direct';
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  // TikTok Direct Post: privacy chosen from creator_info options (no default),
  // plus commercial-content disclosure state.
  tiktokPrivacy?: string;
  commercialContent?: boolean;
  brandOrganic?: boolean;
  brandedContent?: boolean;
}

// Live creator capabilities returned by TikTok's creator_info/query endpoint.
interface TikTokCreatorInfo {
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

// TikTok's display labels for each privacy_level enum value.
const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Public',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

const TIKTOK_MUSIC_CONFIRMATION_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const TIKTOK_BRANDED_CONTENT_POLICY_URL =
  'https://www.tiktok.com/legal/page/global/bc-policy/en';

const PUBLISH_PLATFORMS = Object.entries(PLATFORM_CONFIG).filter(
  ([, cfg]) => (cfg as PlatformConfig).supportsPost
) as [string, PlatformConfig][];

// Map platform keys to their auth route name (some share auth flows)
const PLATFORM_AUTH_ROUTE: Record<string, string> = {
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  YOUTUBE_SHORTS: 'youtube',
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
}

function parseMMSS(value: string): number | null {
  // Support MM:SS:mm (with milliseconds) or MM:SS
  const match = value.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const mins = parseInt(match[1], 10) * 60;
  const secs = parseInt(match[2], 10);
  const ms = match[3] ? parseInt(match[3], 10) / 100 : 0;
  return mins + secs + ms;
}

function TrimTimeline({
  duration,
  startSeconds,
  endSeconds,
  currentTime,
  onStartChange,
  onEndChange,
  onSeek,
}: {
  duration: number;
  startSeconds: number;
  endSeconds: number;
  currentTime: number;
  onStartChange: (s: number) => void;
  onEndChange: (s: number) => void;
  onSeek: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  const pctStart = (startSeconds / duration) * 100;
  const pctEnd = (endSeconds / duration) * 100;
  const pctPlayhead = (currentTime / duration) * 100;

  function getSecondsFromX(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * duration * 100) / 100;
  }

  function handlePointerDown(handle: 'start' | 'end') {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = handle;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const sec = getSecondsFromX(e.clientX);
    if (draggingRef.current === 'start') {
      onStartChange(Math.min(sec, endSeconds - 1));
    } else {
      onEndChange(Math.max(sec, startSeconds + 1));
    }
  }

  function handlePointerUp() {
    draggingRef.current = null;
  }

  function handleTrackClick(e: React.MouseEvent) {
    if (draggingRef.current) return;
    const sec = getSecondsFromX(e.clientX);
    onSeek(sec);
  }

  return (
    <div className={styles.trimTimeline}>
      <div className={styles.trimTimeLabels}>
        <span>{formatDuration(startSeconds)}</span>
        <span>{formatDuration(endSeconds)}</span>
      </div>
      <div
        ref={trackRef}
        className={styles.trimTrack}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleTrackClick}
      >
        {/* Dimmed regions outside trim */}
        <div className={styles.trimDimmed} style={{ left: 0, width: `${pctStart}%` }} />
        <div className={styles.trimDimmed} style={{ left: `${pctEnd}%`, width: `${100 - pctEnd}%` }} />

        {/* Selected region */}
        <div
          className={styles.trimSelected}
          style={{ left: `${pctStart}%`, width: `${pctEnd - pctStart}%` }}
        />

        {/* Playhead */}
        <div
          className={styles.trimPlayhead}
          style={{ left: `${pctPlayhead}%` }}
        />

        {/* Start handle */}
        <div
          className={styles.trimHandle}
          style={{ left: `${pctStart}%` }}
          onPointerDown={handlePointerDown('start')}
        >
          <div className={styles.trimHandleBar} />
        </div>

        {/* End handle */}
        <div
          className={styles.trimHandle}
          style={{ left: `${pctEnd}%` }}
          onPointerDown={handlePointerDown('end')}
        >
          <div className={styles.trimHandleBar} />
        </div>
      </div>
      <div className={styles.trimDurationLabel}>
        Selected: {formatDuration(endSeconds - startSeconds)}
      </div>
    </div>
  );
}

function extractDefaults(video: Video): { caption: string; tags: string } {
  const caption = video.title || '';
  let tags = '';
  if (video.description) {
    const desc = video.description.trim();
    const hashtagMatches = desc.match(/#(\w+)/g);
    if (hashtagMatches && hashtagMatches.length >= 2) {
      tags = hashtagMatches.map((t) => t.replace(/^#/, '')).slice(0, 4).join(', ');
    } else {
      const lines = desc.split('\n');
      const lastLine = lines[lines.length - 1].trim();
      const parts = lastLine.split(',').map((t) => t.trim());
      if (parts.length >= 2 && parts.every((p) => /^[\w][\w\s]*$/.test(p))) {
        tags = parts.slice(0, 4).join(', ');
      }
    }
  }
  return { caption, tags };
}

export default function VideoDetailPage() {
  useSession();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Process options
  const [startTime, setStartTime] = useState('0:00:00');
  const [endTime, setEndTime] = useState('');
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionStyle, setCaptionStyle] = useState('white_outline');
  const [processing, setProcessing] = useState(false);

  // Video playback
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Account status for all platforms
  const [accounts, setAccounts] = useState<Record<string, AccountInfo>>({});
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Per-platform form state and publishing state
  const [platformForms, setPlatformForms] = useState<Record<string, PlatformFormState>>({});
  const [scheduledAtForms, setScheduledAtForms] = useState<Record<string, string>>({});
  const [publishingPlatforms, setPublishingPlatforms] = useState<Set<string>>(new Set());
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});

  // TikTok creator_info — fetched live when the user enters Direct Post mode.
  const [creatorInfo, setCreatorInfo] = useState<TikTokCreatorInfo | null>(null);
  const [creatorInfoLoading, setCreatorInfoLoading] = useState(false);
  const [creatorInfoError, setCreatorInfoError] = useState('');

  const defaultsAppliedRef = useRef(false);

  const fetchVideo = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${id}`);
      if (!res.ok) throw new Error('Failed to load video');
      const data: Video = await res.json();
      setVideo(data);

      // Apply defaults once
      if (!defaultsAppliedRef.current && data.title) {
        const defaults = extractDefaults(data);
        const initialForms: Record<string, PlatformFormState> = {};
        for (const [key] of PUBLISH_PLATFORMS) {
          initialForms[key] = {
            title: defaults.caption,
            description: defaults.caption,
            tags: defaults.tags,
            visibility: 'public',
            ...(key === 'TIKTOK'
              ? {
                  postMode: 'inbox',
                  disableComment: false,
                  disableDuet: false,
                  disableStitch: false,
                  tiktokPrivacy: '',
                  commercialContent: false,
                  brandOrganic: false,
                  brandedContent: false,
                }
              : {}),
          };
        }
        setPlatformForms(initialForms);
        defaultsAppliedRef.current = true;
      }
      if (data.duration && !endTime) {
        setEndTime(formatDuration(data.duration));
      }
      return data;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id, endTime]);

  // Initial fetch
  useEffect(() => {
    fetchVideo();
  }, [fetchVideo]);

  // Fetch account status for all platforms
  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/accounts/status');
        if (res.ok) {
          const data = await res.json();
          setAccounts(data.accounts || {});
        }
      } catch {
        // Silently fail; cards will show as not connected
      } finally {
        setAccountsLoading(false);
      }
    }
    fetchAccounts();
  }, []);

  // Fetch stream URL when video is ready (re-fetches after reprocessing clears it)
  useEffect(() => {
    if (video?.status !== 'READY' || streamUrl) return;
    setStreamLoading(true);
    fetch(`/api/videos/${id}/stream`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.url) setStreamUrl(data.url);
      })
      .catch(() => {})
      .finally(() => setStreamLoading(false));
  }, [video?.status, id, streamUrl]);

  // Poll while processing/downloading
  useEffect(() => {
    if (!video) return;
    const shouldPoll = video.status === 'PROCESSING' || video.status === 'DOWNLOADING';

    if (shouldPoll) {
      pollingRef.current = setInterval(async () => {
        const updated = await fetchVideo();
        if (updated && updated.status !== 'PROCESSING' && updated.status !== 'DOWNLOADING') {
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [video?.status, fetchVideo]);

  async function handleProcess() {
    setProcessing(true);
    setError('');
    setStreamUrl(null);
    try {
      const body: Record<string, unknown> = {};
      const start = parseMMSS(startTime);
      const end = parseMMSS(endTime);
      if (start !== null) body.startTime = start;
      if (end !== null) body.endTime = end;
      body.captions = captionsEnabled;
      if (captionsEnabled) body.captionStyle = captionStyle;

      const res = await fetch(`/api/videos/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Processing failed');
      }

      await fetchVideo();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  }

  async function handleDownload() {
    try {
      const res = await fetch(`/api/videos/${id}/download`);
      if (!res.ok) throw new Error('Download failed');
      const data = await res.json();
      if (data.url) {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      setError('Download failed');
    }
  }

  // Fetch TikTok creator_info before the Direct Post composer is usable. TikTok
  // requires the privacy / interaction options to come from this live call.
  const loadCreatorInfo = useCallback(async () => {
    setCreatorInfoLoading(true);
    setCreatorInfoError('');
    try {
      const res = await fetch('/api/accounts/tiktok/creator-info');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load TikTok settings');
      }
      setCreatorInfo(await res.json());
    } catch (err: unknown) {
      setCreatorInfo(null);
      setCreatorInfoError(
        err instanceof Error ? err.message : 'Failed to load TikTok settings'
      );
    } finally {
      setCreatorInfoLoading(false);
    }
  }, []);

  function updatePlatformForm(
    platform: string,
    field: keyof PlatformFormState,
    value: string | boolean
  ) {
    setPlatformForms((prev) => ({
      ...prev,
      [platform]: {
        ...(prev[platform] || { title: '', description: '', tags: '', visibility: 'public' }),
        [field]: value,
      },
    }));
  }

  // YOUTUBE_SHORTS shares the YOUTUBE account
  function getAccountForPlatform(platform: string): AccountInfo | undefined {
    const direct = accounts[platform];
    if (direct?.connected) return direct;
    // Fallback: YOUTUBE_SHORTS uses YOUTUBE auth
    if (platform === 'YOUTUBE_SHORTS') return accounts['YOUTUBE'];
    return direct;
  }

  function getPostForPlatform(platform: string): Post | undefined {
    return video?.posts?.find((p) => p.platform === platform);
  }

  async function handlePublish(platform: string, scheduledAt?: string) {
    setPublishingPlatforms((prev) => new Set(prev).add(platform));
    setPublishErrors((prev) => ({ ...prev, [platform]: '' }));

    const form = platformForms[platform] || { title: '', description: '', tags: '', visibility: 'public' };
    const config = PLATFORM_CONFIG[platform];

    try {
      const hashtagList = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      // Build caption from available fields
      let caption = '';
      if (config.postFields.title) caption = form.title;
      else if (config.postFields.description) caption = form.description;

      const body: Record<string, unknown> = {
        platform,
        caption,
        hashtags: hashtagList,
        title: form.title,
        description: form.description,
        visibility: form.visibility,
      };

      if (platform === 'TIKTOK') {
        body.postMode = form.postMode ?? 'inbox';
        if (body.postMode === 'direct') {
          body.privacyLevel = form.tiktokPrivacy;
          body.disableComment = form.disableComment ?? false;
          body.disableDuet = form.disableDuet ?? false;
          body.disableStitch = form.disableStitch ?? false;
          body.brandOrganic = form.brandOrganic ?? false;
          body.brandedContent = form.brandedContent ?? false;
        }
      }

      if (scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      const res = await fetch(`/api/videos/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Publish failed');
      }

      // If scheduled, just refresh and clear the form
      if (scheduledAt) {
        await fetchVideo();
        setScheduledAtForms((prev) => ({ ...prev, [platform]: '' }));
        setPublishingPlatforms((prev) => {
          const next = new Set(prev);
          next.delete(platform);
          return next;
        });
        return;
      }

      // Poll until post status resolves
      const poll = setInterval(async () => {
        const updated = await fetchVideo();
        const p = updated?.posts?.find((post) => post.platform === platform);
        if (p && p.status !== 'UPLOADING') {
          clearInterval(poll);
          setPublishingPlatforms((prev) => {
            const next = new Set(prev);
            next.delete(platform);
            return next;
          });
        }
      }, 3000);
    } catch (err: unknown) {
      setPublishErrors((prev) => ({
        ...prev,
        [platform]: err instanceof Error ? err.message : 'Something went wrong',
      }));
      setPublishingPlatforms((prev) => {
        const next = new Set(prev);
        next.delete(platform);
        return next;
      });
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!video) {
    return <div className={styles.error}>{error || 'Video not found'}</div>;
  }

  return (
    <div className={styles.container}>
      <button className={`btn-secondary ${styles.backBtn}`} onClick={() => router.push('/dashboard')}>
        &larr; Back to Dashboard
      </button>

      <div className={styles.layout}>
        {/* Left column: video info */}
        <div className={styles.main}>
          <div className={styles.card}>
            {streamUrl ? (
              <div className={styles.playerWrapper}>
                <video
                  ref={videoRef}
                  src={streamUrl}
                  controls
                  playsInline
                  className={styles.player}
                  poster={video.thumbnailUrl || undefined}
                  onTimeUpdate={() => {
                    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                  }}
                />
                {video.duration != null && (
                  <TrimTimeline
                    duration={video.duration}
                    startSeconds={parseMMSS(startTime) ?? 0}
                    endSeconds={parseMMSS(endTime) ?? video.duration}
                    currentTime={currentTime}
                    onStartChange={(s) => setStartTime(formatDuration(s))}
                    onEndChange={(s) => setEndTime(formatDuration(s))}
                    onSeek={(t) => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = t;
                        setCurrentTime(t);
                      }
                    }}
                  />
                )}
              </div>
            ) : video.thumbnailUrl ? (
              <div className={styles.thumbnailWrapper}>
                <img src={video.thumbnailUrl} alt={video.title} className={styles.thumbnail} />
                {streamLoading && (
                  <div className={styles.playerLoading}>Loading player...</div>
                )}
              </div>
            ) : null}
            <div className={styles.videoInfo}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{video.title}</h1>
                <StatusBadge status={video.status} />
              </div>
              {video.description && (
                <p className={styles.description}>{video.description}</p>
              )}
              <div className={styles.metaRow}>
                {video.duration != null && (
                  <span className={styles.metaItem}>Duration: {formatDuration(video.duration)}</span>
                )}
                <span className={styles.metaItem}>
                  Added: {new Date(video.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Progress indicator for active states */}
          {(video.status === 'PROCESSING' || video.status === 'DOWNLOADING') && (
            <div className={styles.progressCard}>
              <div className={styles.spinner} />
              <div>
                <p className={styles.progressText}>
                  {video.status === 'DOWNLOADING' ? 'Downloading video...' : 'Processing video...'}
                </p>
                <p className={styles.progressSubtext}>This may take a minute. The page updates automatically.</p>
              </div>
            </div>
          )}

          {/* Pending state -- needs download & processing */}
          {video.status === 'PENDING' && (
            <div className={styles.card}>
              <p>This video hasn&apos;t been processed yet.</p>
              <button
                className="btn-primary"
                onClick={handleProcess}
                disabled={processing}
                style={{ marginTop: '0.75rem' }}
              >
                {processing ? 'Starting...' : 'Download & Process'}
              </button>
              {error && <p className={styles.errorText}>{error}</p>}
            </div>
          )}

          {/* Failed state */}
          {video.status === 'FAILED' && (
            <div className={styles.failedCard}>
              <p>Processing failed{video.errorMessage ? `: ${video.errorMessage}` : '.'}</p>
              <button className="btn-primary" onClick={handleProcess}>
                Retry Processing
              </button>
            </div>
          )}

          {/* Processing controls -- shown when READY */}
          {video.status === 'READY' && (
            <div className={styles.card}>
              <h2 className={styles.sectionTitle}>Clip Settings</h2>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Start Time (MM:SS:mm)</label>
                  <div className={styles.timeInputRow}>
                    <input
                      type="text"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="0:00:00"
                    />
                    {streamUrl && (
                      <button
                        type="button"
                        className={styles.setTimeBtn}
                        title="Set from current playback position"
                        onClick={() => {
                          if (videoRef.current) {
                            setStartTime(formatDuration(Math.floor(videoRef.current.currentTime)));
                          }
                        }}
                      >
                        Set
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.field}>
                  <label>End Time (MM:SS:mm)</label>
                  <div className={styles.timeInputRow}>
                    <input
                      type="text"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="1:00:00"
                    />
                    {streamUrl && (
                      <button
                        type="button"
                        className={styles.setTimeBtn}
                        title="Set from current playback position"
                        onClick={() => {
                          if (videoRef.current) {
                            setEndTime(formatDuration(Math.floor(videoRef.current.currentTime)));
                          }
                        }}
                      >
                        Set
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.field} style={{ marginTop: '1rem' }}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={captionsEnabled}
                    onChange={(e) => setCaptionsEnabled(e.target.checked)}
                  />
                  <span>Enable Captions</span>
                </label>
              </div>

              {captionsEnabled && (
                <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                  <label>Caption Style</label>
                  <select
                    value={captionStyle}
                    onChange={(e) => setCaptionStyle(e.target.value)}
                  >
                    <option value="white_outline">White + Black Outline</option>
                    <option value="keyword_highlight">Keyword Highlight</option>
                  </select>
                </div>
              )}

              <div className={styles.actions} style={{ marginTop: '1.25rem' }}>
                <button
                  className="btn-primary"
                  onClick={handleProcess}
                  disabled={processing}
                >
                  {processing ? 'Processing...' : 'Reprocess'}
                </button>
                <button className="btn-secondary" onClick={handleDownload}>
                  Download
                </button>
              </div>

              {error && <p className={styles.errorText}>{error}</p>}
            </div>
          )}
        </div>

        {/* Right column: publish cards */}
        <div className={styles.sidebar}>
          {accountsLoading ? (
            <div className={styles.card}>
              <p className={styles.loadingText}>Loading accounts...</p>
            </div>
          ) : (
            PUBLISH_PLATFORMS.map(([platformKey, config]) => {
              const account = getAccountForPlatform(platformKey);
              const isConnected = account?.connected === true;
              const post = getPostForPlatform(platformKey);
              const isPublishing = publishingPlatforms.has(platformKey);
              const publishError = publishErrors[platformKey];
              const form = platformForms[platformKey] || { title: '', description: '', tags: '', visibility: 'public' };
              const authRoute = PLATFORM_AUTH_ROUTE[platformKey];

              // TikTok Direct Post compliance gating.
              const isTikTokDirect = platformKey === 'TIKTOK' && form.postMode === 'direct';
              const disclosureOn = form.commercialContent === true;
              const disclosureValid =
                !disclosureOn || form.brandOrganic === true || form.brandedContent === true;
              const brandedPrivateConflict =
                form.brandedContent === true && form.tiktokPrivacy === 'SELF_ONLY';
              const tiktokDirectInvalid =
                isTikTokDirect &&
                (!creatorInfo ||
                  !form.tiktokPrivacy ||
                  !disclosureValid ||
                  brandedPrivateConflict);

              return (
                <div className={styles.card} key={platformKey}>
                  <h2 className={styles.sectionTitle}>{config.displayName}</h2>

                  {!isConnected && (
                    <div className={styles.connectPrompt}>
                      <p>Connect your {config.displayName} account to publish videos.</p>
                      {authRoute ? (
                        <button
                          className="btn-primary"
                          style={{ width: '100%' }}
                          onClick={() => {
                            window.location.href = `/api/auth/${authRoute}/link?returnTo=${encodeURIComponent(window.location.pathname)}`;
                          }}
                        >
                          Connect {config.displayName}
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ width: '100%' }}
                          disabled
                        >
                          Coming Soon
                        </button>
                      )}
                    </div>
                  )}

                  {isConnected && (
                    <>
                      <div className={styles.connectedBadge}>
                        {account.displayName || account.handle || `${config.displayName} connected`}
                      </div>

                      {config.postFields.title && (
                        <div className={styles.field}>
                          <label>Title</label>
                          <input
                            type="text"
                            value={form.title}
                            onChange={(e) => updatePlatformForm(platformKey, 'title', e.target.value)}
                            placeholder={`Title for ${config.displayName}...`}
                          />
                        </div>
                      )}

                      {config.postFields.description && (
                        <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                          <label>Description</label>
                          <textarea
                            rows={3}
                            value={form.description}
                            onChange={(e) => updatePlatformForm(platformKey, 'description', e.target.value)}
                            placeholder={`Description for ${config.displayName}...`}
                            className={styles.textarea}
                          />
                        </div>
                      )}

                      {config.postFields.tags && (
                        <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                          <label>Hashtags (comma separated)</label>
                          <input
                            type="text"
                            value={form.tags}
                            onChange={(e) => updatePlatformForm(platformKey, 'tags', e.target.value)}
                            placeholder="viral, fyp, clips"
                          />
                        </div>
                      )}

                      {config.postFields.visibility && !isTikTokDirect && (
                        <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                          <label>Visibility</label>
                          <select
                            value={form.visibility}
                            onChange={(e) => updatePlatformForm(platformKey, 'visibility', e.target.value)}
                          >
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                        </div>
                      )}

                      {platformKey === 'TIKTOK' && (
                        <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                          <label>Post mode</label>
                          <div className={styles.radioGroup}>
                            <label className={styles.radioLabel}>
                              <input
                                type="radio"
                                name={`postMode-${platformKey}`}
                                value="inbox"
                                checked={(form.postMode ?? 'inbox') === 'inbox'}
                                onChange={() => updatePlatformForm(platformKey, 'postMode', 'inbox')}
                              />
                              <span>Save to inbox (finish posting in the TikTok app)</span>
                            </label>
                            <label className={styles.radioLabel}>
                              <input
                                type="radio"
                                name={`postMode-${platformKey}`}
                                value="direct"
                                checked={form.postMode === 'direct'}
                                onChange={() => {
                                  updatePlatformForm(platformKey, 'postMode', 'direct');
                                  if (!creatorInfo && !creatorInfoLoading) loadCreatorInfo();
                                }}
                              />
                              <span>Post directly to my profile</span>
                            </label>
                          </div>

                          {form.postMode === 'direct' && (
                            <div className={styles.directPostOptions}>
                              {creatorInfoLoading && (
                                <p className={styles.mutedText}>Loading TikTok settings…</p>
                              )}

                              {!creatorInfoLoading && creatorInfoError && (
                                <div>
                                  <p className={styles.errorText}>{creatorInfoError}</p>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => loadCreatorInfo()}
                                  >
                                    Retry
                                  </button>
                                </div>
                              )}

                              {!creatorInfoLoading && creatorInfo && (
                                <>
                                  <p className={styles.mutedText}>
                                    Posting as <strong>{creatorInfo.creator_nickname}</strong>
                                  </p>

                                  {/* Privacy — options come from creator_info, no default selection */}
                                  <div className={styles.field}>
                                    <label>Who can view this video</label>
                                    <select
                                      value={form.tiktokPrivacy ?? ''}
                                      onChange={(e) =>
                                        updatePlatformForm(platformKey, 'tiktokPrivacy', e.target.value)
                                      }
                                    >
                                      <option value="" disabled>
                                        Select who can view this video
                                      </option>
                                      {creatorInfo.privacy_level_options.map((opt) => (
                                        <option
                                          key={opt}
                                          value={opt}
                                          disabled={opt === 'SELF_ONLY' && form.brandedContent === true}
                                          title={
                                            opt === 'SELF_ONLY' && form.brandedContent === true
                                              ? 'Branded content visibility cannot be set to private.'
                                              : undefined
                                          }
                                        >
                                          {TIKTOK_PRIVACY_LABELS[opt] ?? opt}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Interaction toggles — disabled ones reflect creator_info */}
                                  <label className={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      disabled={creatorInfo.comment_disabled}
                                      checked={creatorInfo.comment_disabled || (form.disableComment ?? false)}
                                      onChange={(e) =>
                                        updatePlatformForm(platformKey, 'disableComment', e.target.checked)
                                      }
                                    />
                                    <span>Disable comments</span>
                                  </label>
                                  <label className={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      disabled={creatorInfo.duet_disabled}
                                      checked={creatorInfo.duet_disabled || (form.disableDuet ?? false)}
                                      onChange={(e) =>
                                        updatePlatformForm(platformKey, 'disableDuet', e.target.checked)
                                      }
                                    />
                                    <span>Disable duet</span>
                                  </label>
                                  <label className={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      disabled={creatorInfo.stitch_disabled}
                                      checked={creatorInfo.stitch_disabled || (form.disableStitch ?? false)}
                                      onChange={(e) =>
                                        updatePlatformForm(platformKey, 'disableStitch', e.target.checked)
                                      }
                                    />
                                    <span>Disable stitch</span>
                                  </label>

                                  {/* Commercial content disclosure — off by default */}
                                  <div className={styles.disclosure}>
                                    <label className={styles.checkboxLabel}>
                                      <input
                                        type="checkbox"
                                        checked={form.commercialContent === true}
                                        onChange={(e) => {
                                          const on = e.target.checked;
                                          updatePlatformForm(platformKey, 'commercialContent', on);
                                          if (!on) {
                                            updatePlatformForm(platformKey, 'brandOrganic', false);
                                            updatePlatformForm(platformKey, 'brandedContent', false);
                                          }
                                        }}
                                      />
                                      <span>Disclose video content</span>
                                    </label>
                                    <p className={styles.mutedText}>
                                      Turn on to declare that this post promotes a brand, product, or service.
                                    </p>

                                    {form.commercialContent === true && (
                                      <div className={styles.disclosureOptions}>
                                        <label className={styles.checkboxLabel}>
                                          <input
                                            type="checkbox"
                                            checked={form.brandOrganic === true}
                                            onChange={(e) =>
                                              updatePlatformForm(platformKey, 'brandOrganic', e.target.checked)
                                            }
                                          />
                                          <span>
                                            <strong>Your brand</strong> — You are promoting yourself or
                                            your own business. This content will be classified as Brand
                                            Organic.
                                          </span>
                                        </label>
                                        <label className={styles.checkboxLabel}>
                                          <input
                                            type="checkbox"
                                            checked={form.brandedContent === true}
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              updatePlatformForm(platformKey, 'brandedContent', checked);
                                              // Branded content can't be private — clear an invalid pick.
                                              if (checked && form.tiktokPrivacy === 'SELF_ONLY') {
                                                updatePlatformForm(platformKey, 'tiktokPrivacy', '');
                                              }
                                            }}
                                          />
                                          <span>
                                            <strong>Branded content</strong> — You are promoting another
                                            brand or a third party. This content will be classified as
                                            Branded Content.
                                          </span>
                                        </label>

                                        {(form.brandOrganic || form.brandedContent) && (
                                          <p className={styles.mutedText}>
                                            {form.brandedContent
                                              ? "Your photo/video will be labeled 'Paid partnership'."
                                              : "Your photo/video will be labeled 'Promotional content'."}
                                          </p>
                                        )}

                                        {disclosureOn && !disclosureValid && (
                                          <p className={styles.errorText}>
                                            You need to indicate if your content promotes yourself, a
                                            third party, or both.
                                          </p>
                                        )}

                                        {(form.brandOrganic || form.brandedContent) && (
                                          <p className={styles.mutedText}>
                                            By posting, you agree to TikTok&apos;s{' '}
                                            {form.brandedContent && (
                                              <>
                                                <a
                                                  href={TIKTOK_BRANDED_CONTENT_POLICY_URL}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                >
                                                  Branded Content Policy
                                                </a>{' '}
                                                and{' '}
                                              </>
                                            )}
                                            <a
                                              href={TIKTOK_MUSIC_CONFIRMATION_URL}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              Music Usage Confirmation
                                            </a>
                                            .
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {brandedPrivateConflict && (
                                    <p className={styles.errorText}>
                                      Branded content visibility cannot be set to private.
                                    </p>
                                  )}

                                  <p className={styles.mutedText}>
                                    Max video length:{' '}
                                    {Math.floor(creatorInfo.max_video_post_duration_sec / 60)}m{' '}
                                    {creatorInfo.max_video_post_duration_sec % 60}s
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                        <label>Schedule For (optional)</label>
                        <input
                          type="datetime-local"
                          value={scheduledAtForms[platformKey] || ''}
                          onChange={(e) =>
                            setScheduledAtForms((prev) => ({ ...prev, [platformKey]: e.target.value }))
                          }
                        />
                      </div>

                      <div className={styles.actions} style={{ marginTop: '1rem' }}>
                        {scheduledAtForms[platformKey] ? (
                          <button
                            className="btn-primary"
                            style={{ flex: 1 }}
                            onClick={() => handlePublish(platformKey, scheduledAtForms[platformKey])}
                            disabled={
                              isPublishing ||
                              video.status !== 'READY' ||
                              post?.status === 'UPLOADING' ||
                              post?.status === 'POSTED' ||
                              post?.status === 'SCHEDULED' ||
                              tiktokDirectInvalid
                            }
                          >
                            {isPublishing ? 'Scheduling...' : `Schedule for ${config.displayName}`}
                          </button>
                        ) : (
                          <button
                            className="btn-primary"
                            style={{ flex: 1 }}
                            onClick={() => handlePublish(platformKey)}
                            disabled={
                              isPublishing ||
                              video.status !== 'READY' ||
                              post?.status === 'UPLOADING' ||
                              post?.status === 'POSTED' ||
                              tiktokDirectInvalid
                            }
                          >
                            {isPublishing
                              ? 'Publishing...'
                              : post?.status === 'FAILED'
                                ? `Retry Post to ${config.displayName}`
                                : post?.status === 'POSTED'
                                  ? `Posted to ${config.displayName}`
                                  : post?.status === 'SCHEDULED'
                                    ? `Scheduled`
                                    : `Post to ${config.displayName}`}
                          </button>
                        )}
                      </div>

                      {publishError && <p className={styles.errorText}>{publishError}</p>}

                      {post && (
                        <div className={styles.postStatus}>
                          <span className={styles.postLabel}>Post Status:</span>
                          <StatusBadge status={post.status} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
