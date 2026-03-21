'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';

interface Channel {
  channelName: string;
  channelHandle: string;
  thumbnailUrl: string;
  lastSyncedAt: string | null;
}

interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  duration: number;
  publishedAt: string;
  viewCount: number;
  imported: boolean;
  clipflowVideoId?: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
  return `${count} views`;
}

export default function YouTubeBrowsePage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    async function checkConnection() {
      try {
        const res = await fetch('/api/accounts/youtube');
        if (!res.ok) throw new Error('Failed to check YouTube connection');
        const data = await res.json();
        setConnected(data.connected);
        if (data.connected && data.channel) {
          setChannel(data.channel);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    }

    checkConnection();
  }, [authStatus]);

  useEffect(() => {
    if (!connected) return;

    async function fetchVideos() {
      try {
        const res = await fetch('/api/youtube/videos');
        if (!res.ok) throw new Error('Failed to fetch YouTube videos');
        const data = await res.json();
        setVideos(data.videos);
        setNextPageToken(data.nextPageToken ?? null);
        if (data.channel) {
          setChannel(data.channel);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    }

    fetchVideos();
  }, [connected]);

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/youtube/videos?pageToken=${encodeURIComponent(nextPageToken)}`);
      if (!res.ok) throw new Error('Failed to load more videos');
      const data = await res.json();
      setVideos((prev) => [...prev, ...data.videos]);
      setNextPageToken(data.nextPageToken ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load more videos');
    } finally {
      setLoadingMore(false);
    }
  }, [nextPageToken, loadingMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/youtube/sync', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to sync videos');
      // Wait briefly for sync to process, then re-fetch
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const videosRes = await fetch('/api/youtube/videos');
      if (!videosRes.ok) throw new Error('Failed to fetch videos after sync');
      const data = await videosRes.json();
      setVideos(data.videos);
      setNextPageToken(data.nextPageToken ?? null);
      if (data.channel) {
        setChannel(data.channel);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleImport(video: YouTubeVideo) {
    setImportingId(video.videoId);
    setError('');
    try {
      const res = await fetch('/api/youtube/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeVideoId: video.videoId,
          title: video.title,
          description: video.description,
          thumbnailUrl: video.thumbnailUrl,
          duration: video.duration,
        }),
      });
      if (!res.ok) throw new Error('Failed to import video');
      const data = await res.json();
      router.push(`/dashboard/videos/${data.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setImportingId(null);
    }
  }

  if (authStatus === 'loading' || authStatus === 'unauthenticated') {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className={styles.container}>
        <div className={styles.connectCard}>
          <div className={styles.connectIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="#FF0000">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </div>
          <h2>Connect Your YouTube Channel</h2>
          <p>Link your YouTube account to browse and import your videos into ClipFlow.</p>
          <a
            href="/api/auth/youtube/link?returnTo=/dashboard/youtube"
            className={styles.importBtn}
          >
            Connect YouTube Channel
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.channelInfo}>
          {channel?.thumbnailUrl && (
            <div className={styles.channelThumb}>
              <img src={channel.thumbnailUrl} alt={channel.channelName} width={48} height={48} />
            </div>
          )}
          <div className={styles.channelMeta}>
            <h1>{channel?.channelName}</h1>
            {channel?.channelHandle && (
              <span>{channel.channelHandle}</span>
            )}
            {channel?.lastSyncedAt && (
              <span>Last synced: {new Date(channel.lastSyncedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <button
          className={styles.syncBtn}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!error && videos.length === 0 && (
        <div className={styles.empty}>
          <p>No videos found. Try syncing your channel to pull in your latest uploads.</p>
        </div>
      )}

      {videos.length > 0 && (
        <>
          <div className={styles.grid}>
            {videos.map((video) => (
              <div key={video.videoId} className={styles.videoCard}>
                <div className={styles.videoThumb}>
                  <img src={video.thumbnailUrl} alt={video.title} />
                  <span className={styles.duration}>{formatDuration(video.duration)}</span>
                </div>
                <div className={styles.videoInfo}>
                  <div className={styles.videoTitle}>{video.title}</div>
                  <div className={styles.videoMeta}>
                    <span className={styles.viewCount}>{formatViews(video.viewCount)}</span>
                    <span className={styles.publishDate}>
                      {new Date(video.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {video.imported && video.clipflowVideoId ? (
                    <Link
                      href={`/dashboard/videos/${video.clipflowVideoId}`}
                      className={styles.importedBadge}
                    >
                      Imported
                    </Link>
                  ) : (
                    <button
                      className={styles.importBtn}
                      onClick={() => handleImport(video)}
                      disabled={importingId === video.videoId}
                    >
                      {importingId === video.videoId ? 'Importing...' : 'Import'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {nextPageToken && (
            <div ref={sentinelRef} className={styles.loadMore}>
              {loadingMore && <span>Loading more videos...</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
