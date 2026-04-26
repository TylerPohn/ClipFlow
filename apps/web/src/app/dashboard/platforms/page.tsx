'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PLATFORM_CONFIG } from '@clipflow/shared/src/platforms';
import styles from './platforms-index.module.css';

interface AccountStatus {
  connected: boolean;
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  lastSyncedAt?: string | null;
  tokenStatus?: string | null;
  bio?: string | null;
  isVerified?: boolean;
  profileWebLink?: string | null;
  profileDeepLink?: string | null;
  followerCount?: number | null;
  followingCount?: number | null;
  likesCount?: number | null;
  videoCount?: number | null;
  statsUpdatedAt?: string | null;
}

type PlatformKey = 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'X';

const PLATFORM_ORDER: PlatformKey[] = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'];

const PLATFORM_ICONS: Record<PlatformKey, JSX.Element> = {
  YOUTUBE: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  ),
  TIKTOK: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.35a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.22z" />
    </svg>
  ),
  INSTAGRAM: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  ),
  X: (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

const PLATFORM_COLORS: Record<PlatformKey, string> = {
  YOUTUBE: '#FF0000',
  TIKTOK: '#00f2ea',
  INSTAGRAM: '#E4405F',
  X: '#a0a0a0',
};

function getCapabilities(platform: PlatformKey) {
  const config = PLATFORM_CONFIG[platform];
  const caps: string[] = [];
  if (config?.supportsSync) caps.push('Browse & import');
  if (config?.supportsPost) caps.push('Publish');
  return caps;
}

function formatCompactNumber(count: number | null | undefined): string {
  if (count == null) return '-';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export default function PlatformsIndexPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/accounts/status');
        if (!res.ok) throw new Error('Failed to fetch account status');
        const data = await res.json();
        setAccounts(data.accounts);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
  }, [authStatus]);

  async function handleDisconnect(platform: PlatformKey) {
    const config = PLATFORM_CONFIG[platform];
    if (!confirm(`Are you sure you want to disconnect your ${config?.displayName ?? platform} account?`)) {
      return;
    }

    setDisconnectingPlatform(platform);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${platform.toLowerCase()}/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to disconnect account');
      setAccounts((prev) => ({
        ...prev,
        [platform]: { connected: false },
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnectingPlatform(null);
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

  const connectedCount = PLATFORM_ORDER.filter((p) => accounts[p]?.connected).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Platforms</h1>
          <p>
            {connectedCount} of {PLATFORM_ORDER.length} platforms connected
          </p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {PLATFORM_ORDER.map((platform) => {
          const account = accounts[platform];
          const config = PLATFORM_CONFIG[platform];
          const isConnected = account?.connected ?? false;
          const needsReconnect = isConnected && account?.tokenStatus && account.tokenStatus !== 'valid';
          const capabilities = getCapabilities(platform);
          const color = PLATFORM_COLORS[platform];
          const tiktokStats =
            platform === 'TIKTOK' && isConnected && account
              ? [
                  { label: 'Followers', value: account.followerCount },
                  { label: 'Following', value: account.followingCount },
                  { label: 'Likes', value: account.likesCount },
                  { label: 'Videos', value: account.videoCount },
                ]
              : [];

          return (
            <div key={platform} className={styles.card}>
              <div className={styles.cardBody}>
                <div className={styles.cardTop} style={{ borderColor: isConnected ? color : 'transparent' }}>
                  <div className={styles.iconWrap} style={{ color }}>
                    {PLATFORM_ICONS[platform]}
                  </div>
                  <div className={styles.platformInfo}>
                    <span className={styles.platformName}>{config?.displayName ?? platform}</span>
                    <span
                      className={`${styles.statusBadge} ${
                        needsReconnect
                          ? styles.statusExpired
                          : isConnected
                            ? styles.statusConnected
                            : styles.statusDisconnected
                      }`}
                    >
                      {needsReconnect ? 'Reconnect needed' : isConnected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                </div>

                {isConnected && account ? (
                  <div className={styles.accountSection}>
                    <div className={styles.accountRow}>
                      {account.avatarUrl ? (
                        <img
                          className={styles.avatar}
                          src={account.avatarUrl}
                          alt={account.displayName ?? ''}
                        />
                      ) : (
                        <div className={styles.avatarPlaceholder} style={{ backgroundColor: color + '20', color }}>
                          {(config?.displayName ?? platform).charAt(0)}
                        </div>
                      )}
                      <div className={styles.accountMeta}>
                        {account.displayName && (
                          <span className={styles.displayName}>
                            {account.displayName}
                            {account.isVerified && (
                              <span className={styles.verifiedBadge} title="Verified">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                                  <path d="M12 2l2.39 2.39 3.36-.67.67 3.36L20.81 9.6 19.42 12l1.39 2.39-2.39 2.39-.67 3.36-3.36-.67L12 21.85l-2.39-2.39-3.36.67-.67-3.36L3.19 14.4 4.58 12 3.19 9.6l2.39-2.39.67-3.36 3.36.67L12 2zm-1.2 13.4l5.66-5.66-1.41-1.41-4.24 4.24-2.12-2.12-1.41 1.41 3.52 3.54z" />
                                </svg>
                              </span>
                            )}
                          </span>
                        )}
                        {account.handle && (
                          <span className={styles.handle}>{account.handle}</span>
                        )}
                      </div>
                    </div>
                    {tiktokStats.length > 0 && (
                      <div className={styles.statsRow}>
                        {tiktokStats.map((stat) => (
                          <div key={stat.label} className={styles.statBlock}>
                            <span className={styles.statValue}>
                              {formatCompactNumber(stat.value)}
                            </span>
                            <span className={styles.statLabel}>{stat.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {account.bio && (
                      <p className={styles.bio}>{account.bio}</p>
                    )}
                    {account.profileWebLink && (
                      <a
                        className={styles.profileLink}
                        href={account.profileWebLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View profile ↗
                      </a>
                    )}
                    {account.lastSyncedAt && (
                      <div className={styles.lastSynced}>
                        Last synced {new Date(account.lastSyncedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.disconnectedSection}>
                    <p>Connect your {config?.displayName ?? platform} account to get started.</p>
                  </div>
                )}

                <div className={styles.capabilities}>
                  {capabilities.map((cap) => (
                    <span key={cap} className={styles.capBadge}>
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.actions}>
                {isConnected ? (
                  <>
                    {needsReconnect ? (
                      <a
                        href={`/api/auth/${platform.toLowerCase()}/link?returnTo=/dashboard/platforms`}
                        className={styles.reconnectBtn}
                      >
                        Reconnect {config?.displayName}
                      </a>
                    ) : (
                      <Link
                        href={`/dashboard/platforms/${platform.toLowerCase()}`}
                        className={styles.browseBtn}
                      >
                        Browse {config?.displayName}
                      </Link>
                    )}
                    <button
                      className={styles.disconnectBtn}
                      onClick={() => handleDisconnect(platform)}
                      disabled={disconnectingPlatform === platform}
                    >
                      {disconnectingPlatform === platform ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </>
                ) : (
                  <a
                    href={`/api/auth/${platform.toLowerCase()}/link?returnTo=/dashboard/platforms`}
                    className={styles.connectBtn}
                  >
                    Connect {config?.displayName}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
