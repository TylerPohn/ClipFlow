'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PLATFORM_CONFIG } from '@clipflow/shared/src/platforms';
import styles from './accounts.module.css';

interface AccountStatus {
  connected: boolean;
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  lastSyncedAt?: string | null;
}

type PlatformKey = 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'X';

const PLATFORM_ORDER: PlatformKey[] = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'];

const PLATFORM_LINK_URLS: Record<PlatformKey, string | null> = {
  YOUTUBE: '/api/auth/youtube/link?returnTo=/dashboard/accounts',
  TIKTOK: '/api/auth/tiktok/link?returnTo=/dashboard/accounts',
  INSTAGRAM: null, // Not implemented yet
  X: null, // Not implemented yet
};

const PLATFORM_COLORS: Record<PlatformKey, string> = {
  YOUTUBE: '#FF0000',
  TIKTOK: '#00f2ea',
  INSTAGRAM: '#E4405F',
  X: '#ffffff',
};

export default function AccountsPage() {
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
    if (!confirm(`Are you sure you want to disconnect your ${PLATFORM_CONFIG[platform]?.displayName ?? platform} account?`)) {
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

  function getInitial(platform: PlatformKey): string {
    return (PLATFORM_CONFIG[platform]?.displayName ?? platform).charAt(0);
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Connected Accounts</h1>
        <p>Manage your platform connections for publishing and importing content.</p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {PLATFORM_ORDER.map((platform) => {
          const account = accounts[platform];
          const config = PLATFORM_CONFIG[platform];
          const isConnected = account?.connected ?? false;
          const linkUrl = PLATFORM_LINK_URLS[platform];
          const isComingSoon = linkUrl === null;

          return (
            <div key={platform} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.platformLabel}>
                  <span
                    className={`${styles.statusDot} ${isConnected ? styles.statusDotConnected : styles.statusDotDisconnected}`}
                  />
                  <span className={styles.platformName}>{config?.displayName ?? platform}</span>
                </div>
                <span
                  className={`${styles.statusBadge} ${isConnected ? styles.statusConnected : styles.statusDisconnected}`}
                >
                  {isConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>

              {isConnected ? (
                <>
                  <div className={styles.accountInfo}>
                    {account.avatarUrl ? (
                      <div className={styles.avatar}>
                        <img
                          src={account.avatarUrl}
                          alt={account.displayName ?? ''}
                        />
                      </div>
                    ) : (
                      <div
                        className={styles.avatarPlaceholder}
                        style={{ backgroundColor: PLATFORM_COLORS[platform] + '20', color: PLATFORM_COLORS[platform] }}
                      >
                        {getInitial(platform)}
                      </div>
                    )}
                    <div className={styles.accountMeta}>
                      {account.displayName && (
                        <span className={styles.displayName}>{account.displayName}</span>
                      )}
                      {account.handle && (
                        <span className={styles.handle}>{account.handle}</span>
                      )}
                    </div>
                  </div>
                  {account.lastSyncedAt && (
                    <div className={styles.lastSynced}>
                      Last synced: {new Date(account.lastSyncedAt).toLocaleDateString()}
                    </div>
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
                <>
                  <div className={styles.disconnectedMessage}>
                    No {config?.displayName ?? platform} account connected.
                  </div>
                  {isComingSoon ? (
                    <div>
                      <span className={styles.connectBtnDisabled}>Connect {config?.displayName ?? platform}</span>
                      <span className={styles.comingSoon}> Coming Soon</span>
                    </div>
                  ) : (
                    <a href={linkUrl} className={styles.connectBtn}>
                      Connect {config?.displayName ?? platform}
                    </a>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
