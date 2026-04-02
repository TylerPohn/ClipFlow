'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { PLATFORM_CONFIG } from '@clipflow/shared/src/platforms';
import styles from './platforms.module.css';

const VALID_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'] as const;
type ValidPlatform = (typeof VALID_PLATFORMS)[number];

interface AccountInfo {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  lastSyncedAt: string | null;
  tokenStatus: string | null;
}

interface PlatformVideo {
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

const PLATFORM_AUTH_PATHS: Record<ValidPlatform, string> = {
  YOUTUBE: '/api/auth/youtube/link',
  TIKTOK: '/api/auth/tiktok/link',
  INSTAGRAM: '/api/auth/instagram/link',
  X: '/api/auth/x/link',
};

export default function PlatformBrowsePage() {
  const { platform: rawPlatform } = useParams<{ platform: string }>();
  const platform = rawPlatform.toUpperCase() as ValidPlatform;
  const isValid = VALID_PLATFORMS.includes(platform);
  const config = isValid ? PLATFORM_CONFIG[platform] : null;

  const { status: authStatus } = useSession();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [videos, setVideos] = useState<PlatformVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const needsReconnect = account?.tokenStatus === 'expired' || account?.tokenStatus === 'scope_error';
  const [disconnecting, setDisconnecting] = useState(false);
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
    if (authStatus !== 'authenticated' || !isValid) return;

    async function checkConnection() {
      try {
        const res = await fetch(`/api/accounts/${rawPlatform}`);
        if (!res.ok) throw new Error(`Failed to check ${config?.displayName} connection`);
        const data = await res.json();
        setConnected(data.connected);
        if (data.connected) {
          // Normalize account info from different response shapes
          const acct = data.channel || data.account || data;
          setAccount({
            displayName: acct.channelName || acct.displayName || '',
            handle: acct.channelHandle || acct.handle || null,
            avatarUrl: acct.thumbnailUrl || acct.avatarUrl || null,
            lastSyncedAt: acct.lastSyncedAt || null,
            tokenStatus: acct.tokenStatus || data.tokenStatus || null,
          });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    }

    checkConnection();
  }, [authStatus, isValid, rawPlatform, config?.displayName]);

  useEffect(() => {
    if (!connected || !config?.supportsSync) return;

    async function fetchVideos() {
      try {
        const res = await fetch(`/api/platforms/${rawPlatform}/videos`);
        if (!res.ok) throw new Error(`Failed to fetch ${config?.displayName} videos`);
        const data = await res.json();
        setVideos(data.videos);
        setNextPageToken(data.nextPageToken ?? null);
        if (data.channel || data.account) {
          const acct = data.channel || data.account;
          setAccount({
            displayName: acct.channelName || acct.displayName || '',
            handle: acct.channelHandle || acct.handle || null,
            avatarUrl: acct.thumbnailUrl || acct.avatarUrl || null,
            lastSyncedAt: acct.lastSyncedAt || null,
            tokenStatus: acct.tokenStatus || null,
          });
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    }

    fetchVideos();
  }, [connected, rawPlatform, config?.supportsSync, config?.displayName]);

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/platforms/${rawPlatform}/videos?pageToken=${encodeURIComponent(nextPageToken)}`
      );
      if (!res.ok) throw new Error('Failed to load more videos');
      const data = await res.json();
      setVideos((prev) => {
        const existingIds = new Set(prev.map((v) => v.videoId));
        const newVideos = (data.videos as PlatformVideo[]).filter(
          (v) => !existingIds.has(v.videoId)
        );
        return [...prev, ...newVideos];
      });
      setNextPageToken(data.nextPageToken ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load more videos');
    } finally {
      setLoadingMore(false);
    }
  }, [nextPageToken, loadingMore, rawPlatform]);

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
      const res = await fetch(`/api/platforms/${rawPlatform}/sync`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to sync videos');
      // Wait briefly for sync to process, then re-fetch
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const videosRes = await fetch(`/api/platforms/${rawPlatform}/videos`);
      if (!videosRes.ok) throw new Error('Failed to fetch videos after sync');
      const data = await videosRes.json();
      setVideos(data.videos);
      setNextPageToken(data.nextPageToken ?? null);
      if (data.channel || data.account) {
        const acct = data.channel || data.account;
        setAccount({
          displayName: acct.channelName || acct.displayName || '',
          handle: acct.channelHandle || acct.handle || null,
          avatarUrl: acct.thumbnailUrl || acct.avatarUrl || null,
          lastSyncedAt: acct.lastSyncedAt || null,
          tokenStatus: acct.tokenStatus || null,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleImport(video: PlatformVideo) {
    setImportingId(video.videoId);
    setError('');
    try {
      const res = await fetch(`/api/platforms/${rawPlatform}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.videoId,
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

  async function handleDisconnect() {
    if (!confirm(`Are you sure you want to disconnect your ${config?.displayName} account?`)) {
      return;
    }
    setDisconnecting(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${rawPlatform}/disconnect`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect account');
      setConnected(false);
      setAccount(null);
      setVideos([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  }

  if (authStatus === 'loading' || authStatus === 'unauthenticated') {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!isValid || !config) {
    return (
      <div className={styles.container}>
        <div className={styles.notFound}>
          <h2>Platform Not Found</h2>
          <p>The platform &quot;{rawPlatform}&quot; is not supported.</p>
        </div>
      </div>
    );
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
            <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--accent)">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2>Connect Your {config.displayName} Account</h2>
          <p>
            Link your {config.displayName} account to browse and import your videos into ClipFlow.
          </p>
          <a
            href={`${PLATFORM_AUTH_PATHS[platform]}?returnTo=/dashboard/platforms/${rawPlatform}`}
            className={styles.importBtn}
          >
            Connect {config.displayName}
          </a>
        </div>
      </div>
    );
  }

  if (!config.supportsSync) {
    return (
      <div className={styles.container}>
        <div className={styles.notSupported}>
          <h2>{config.displayName}</h2>
          <p>
            Videos from {config.displayName} will appear here once browsing is supported.
            You can still post to {config.displayName} from your videos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.channelInfo}>
          {account?.avatarUrl && (
            <div className={styles.channelThumb}>
              <img src={account.avatarUrl} alt={account.displayName} width={48} height={48} />
            </div>
          )}
          <div className={styles.channelMeta}>
            <h1>{account?.displayName}</h1>
            {account?.handle && <span>{account.handle}</span>}
            {account?.lastSyncedAt && (
              <span>Last synced: {new Date(account.lastSyncedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          {needsReconnect ? (
            <a
              href={`${PLATFORM_AUTH_PATHS[platform]}?returnTo=/dashboard/platforms/${rawPlatform}`}
              className={styles.reconnectBtn}
            >
              Reconnect
            </a>
          ) : (
            <button
              className={styles.syncBtn}
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
          <button
            className={styles.disconnectBtn}
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
      </div>

      {needsReconnect && (
        <div className={styles.reconnectBanner}>
          <div className={styles.reconnectContent}>
            <strong>Your {config.displayName} connection has expired.</strong>
            <p>To fix this:</p>
            <ol>
              <li>Open TikTok app or go to tiktok.com</li>
              <li>Go to <strong>Settings and Privacy</strong> &gt; <strong>Security and Permissions</strong> &gt; <strong>Manage permissions</strong></li>
              <li>Find <strong>ClipFlow</strong> and tap <strong>Remove</strong></li>
              <li>Come back here and click <strong>Reconnect</strong></li>
            </ol>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {!error && videos.length === 0 && (
        <div className={styles.empty}>
          <p>
            No videos found. Try syncing your {config.displayName} account to pull in your latest
            uploads.
          </p>
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
