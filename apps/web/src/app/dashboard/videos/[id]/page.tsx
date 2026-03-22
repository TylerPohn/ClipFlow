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
}

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
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseMMSS(value: string): number | null {
  const match = value.match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
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
  const [startTime, setStartTime] = useState('0:00');
  const [endTime, setEndTime] = useState('');
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionStyle, setCaptionStyle] = useState('white_outline');
  const [processing, setProcessing] = useState(false);

  // Account status for all platforms
  const [accounts, setAccounts] = useState<Record<string, AccountInfo>>({});
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Per-platform form state and publishing state
  const [platformForms, setPlatformForms] = useState<Record<string, PlatformFormState>>({});
  const [publishingPlatforms, setPublishingPlatforms] = useState<Set<string>>(new Set());
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});

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
        window.open(data.url, '_blank');
      }
    } catch {
      setError('Download failed');
    }
  }

  function updatePlatformForm(platform: string, field: keyof PlatformFormState, value: string) {
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

  async function handlePublish(platform: string) {
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

      const res = await fetch(`/api/videos/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          caption,
          hashtags: hashtagList,
          title: form.title,
          description: form.description,
          visibility: form.visibility,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Publish failed');
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
            {video.thumbnailUrl && (
              <div className={styles.thumbnailWrapper}>
                <img src={video.thumbnailUrl} alt={video.title} className={styles.thumbnail} />
              </div>
            )}
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
                  <label>Start Time (MM:SS)</label>
                  <input
                    type="text"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    placeholder="0:00"
                  />
                </div>
                <div className={styles.field}>
                  <label>End Time (MM:SS)</label>
                  <input
                    type="text"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    placeholder="1:00"
                  />
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

                      {config.postFields.visibility && (
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

                      <button
                        className="btn-primary"
                        style={{ marginTop: '1rem', width: '100%' }}
                        onClick={() => handlePublish(platformKey)}
                        disabled={
                          isPublishing ||
                          video.status !== 'READY' ||
                          post?.status === 'UPLOADING' ||
                          post?.status === 'POSTED'
                        }
                      >
                        {isPublishing
                          ? 'Publishing...'
                          : post?.status === 'FAILED'
                            ? `Retry Post to ${config.displayName}`
                            : post?.status === 'POSTED'
                              ? `Posted to ${config.displayName}`
                              : `Post to ${config.displayName}`}
                      </button>

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
