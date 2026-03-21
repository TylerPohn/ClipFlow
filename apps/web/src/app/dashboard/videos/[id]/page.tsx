'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import StatusBadge from '@/components/StatusBadge';
import styles from './page.module.css';

interface Post {
  id: string;
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

  // TikTok connection
  const [tiktokConnected, setTiktokConnected] = useState<boolean | null>(null);

  // YouTube connection
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  const [youtubeChannel, setYoutubeChannel] = useState<{ channelName: string; lastSyncedAt: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Publish options
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const fetchVideo = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${id}`);
      if (!res.ok) throw new Error('Failed to load video');
      const data: Video = await res.json();
      setVideo(data);
      if (!caption && data.title) {
        setCaption(data.title);
      }
      if (!hashtags && data.description) {
        const desc = data.description.trim();
        // Extract #Hashtags from anywhere in the description
        const hashtagMatches = desc.match(/#(\w+)/g);
        if (hashtagMatches && hashtagMatches.length >= 2) {
          const parsed = hashtagMatches
            .map((t) => t.replace(/^#/, ''))
            .slice(0, 4);
          setHashtags(parsed.join(', '));
        } else {
          // Fallback: last line is comma-separated keywords
          const lines = desc.split('\n');
          const lastLine = lines[lines.length - 1].trim();
          const parts = lastLine.split(',').map((t) => t.trim());
          if (parts.length >= 2 && parts.every((p) => /^[\w][\w\s]*$/.test(p))) {
            setHashtags(parts.slice(0, 4).join(', '));
          }
        }
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
  }, [id, endTime, caption, hashtags]);

  // Initial fetch
  useEffect(() => {
    fetchVideo();
  }, [fetchVideo]);

  // Check TikTok connection
  useEffect(() => {
    async function checkTikTok() {
      try {
        const res = await fetch('/api/accounts/tiktok');
        if (res.ok) {
          const data = await res.json();
          setTiktokConnected(data.connected);
        }
      } catch {
        setTiktokConnected(false);
      }
    }
    checkTikTok();
  }, []);

  // Check YouTube connection
  useEffect(() => {
    async function checkYouTube() {
      try {
        const res = await fetch('/api/accounts/youtube');
        if (res.ok) {
          const data = await res.json();
          setYoutubeConnected(data.connected);
          setYoutubeChannel(data.channel);
        }
      } catch {
        setYoutubeConnected(false);
      }
    }
    checkYouTube();
  }, []);

  async function handleYouTubeSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/youtube/sync', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Sync failed');
      }
      // Refresh video data after sync is queued
      setTimeout(() => fetchVideo(), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

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

  async function handlePublish() {
    setPublishing(true);
    setPublishError('');
    try {
      const hashtagList = hashtags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/videos/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'TIKTOK', caption, hashtags: hashtagList }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Publish failed');
      }

      await fetchVideo();
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!video) {
    return <div className={styles.error}>{error || 'Video not found'}</div>;
  }

  const post = video.posts?.[0];

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

        {/* Right column: publish */}
        <div className={styles.sidebar}>
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>Publish to TikTok</h2>

            {tiktokConnected === false && (
              <div className={styles.connectPrompt}>
                <p>Connect your TikTok account to publish videos.</p>
                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    window.location.href = `/api/auth/tiktok/link?returnTo=${encodeURIComponent(window.location.pathname)}`;
                  }}
                >
                  Connect TikTok
                </button>
              </div>
            )}

            {tiktokConnected === true && (
              <>
                <div className={styles.connectedBadge}>TikTok connected</div>

                <div className={styles.field}>
                  <label>Caption</label>
                  <textarea
                    rows={3}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Write a caption for your TikTok..."
                    className={styles.textarea}
                  />
                </div>

                <div className={styles.field} style={{ marginTop: '0.75rem' }}>
                  <label>Hashtags (comma separated)</label>
                  <input
                    type="text"
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="viral, fyp, clips"
                  />
                </div>

                <button
                  className="btn-primary"
                  style={{ marginTop: '1rem', width: '100%' }}
                  onClick={handlePublish}
                  disabled={publishing || video.status !== 'READY'}
                >
                  {publishing ? 'Publishing...' : 'Post to TikTok'}
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

            {tiktokConnected === null && (
              <p className={styles.loadingText}>Checking connection...</p>
            )}
          </div>

          {/* YouTube Integration */}
          <div className={styles.card}>
            <h2 className={styles.sectionTitle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              YouTube Channel
            </h2>

            {youtubeConnected === false && (
              <div className={styles.connectPrompt}>
                <p>Link your YouTube channel to auto-sync video metadata.</p>
                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    window.location.href = `/api/auth/youtube/link?returnTo=${encodeURIComponent(window.location.pathname)}`;
                  }}
                >
                  Connect YouTube
                </button>
              </div>
            )}

            {youtubeConnected === true && youtubeChannel && (
              <>
                <div className={styles.connectedBadge} style={{ borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#ef4444"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                  {youtubeChannel.channelName}
                </div>
                {youtubeChannel.lastSyncedAt && (
                  <p className={styles.loadingText} style={{ marginBottom: '0.75rem' }}>
                    Last synced: {new Date(youtubeChannel.lastSyncedAt).toLocaleString()}
                  </p>
                )}
                <button
                  className="btn-secondary"
                  style={{ width: '100%' }}
                  onClick={handleYouTubeSync}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : 'Sync Videos'}
                </button>
              </>
            )}

            {youtubeConnected === null && (
              <p className={styles.loadingText}>Checking connection...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
