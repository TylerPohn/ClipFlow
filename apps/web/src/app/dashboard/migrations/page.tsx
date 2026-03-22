'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StatusBadge from '../../../components/StatusBadge';
import styles from './page.module.css';

interface Migration {
  id: string;
  name: string | null;
  sourcePlatform: string;
  destPlatform: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  counts: {
    total: number;
    posted: number;
    failed: number;
    scheduled: number;
    uploading: number;
  };
  createdAt: string;
}

export default function MigrationsPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    fetchMigrations();
  }, [authStatus]);

  async function fetchMigrations() {
    try {
      const res = await fetch('/api/migrations');
      if (!res.ok) throw new Error('Failed to fetch migrations');
      const data = await res.json();
      setMigrations(data.migrations ?? data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handlePauseResume(e: React.MouseEvent, migration: Migration) {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = migration.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const res = await fetch(`/api/migrations/${migration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update migration');
      setMigrations((prev) =>
        prev.map((m) => (m.id === migration.id ? { ...m, status: newStatus } : m))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function handleCancel(e: React.MouseEvent, migration: Migration) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to cancel this migration? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/migrations/${migration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) throw new Error('Failed to cancel migration');
      setMigrations((prev) =>
        prev.map((m) => (m.id === migration.id ? { ...m, status: 'CANCELLED' } : m))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  function getProgressPercent(m: Migration): number {
    if (m.counts.total === 0) return 0;
    return Math.round(((m.counts.posted + m.counts.failed) / m.counts.total) * 100);
  }

  function formatPlatform(platform: string): string {
    const map: Record<string, string> = {
      YOUTUBE: 'YouTube',
      YOUTUBE_SHORTS: 'YT Shorts',
      TIKTOK: 'TikTok',
      INSTAGRAM: 'Instagram',
      X: 'X',
    };
    return map[platform] ?? platform;
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
        <div className={styles.headerLeft}>
          <h1>Migrations</h1>
          <p>Bulk migrate videos between platforms on a schedule.</p>
        </div>
        <Link href="/dashboard/migrations/new" className={styles.newBtn}>
          New Migration
        </Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {migrations.length === 0 ? (
        <div className={styles.empty}>
          <p>No migrations yet. Create one to start moving your content.</p>
          <Link href="/dashboard/migrations/new" className={styles.newBtn}>
            New Migration
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {migrations.map((migration) => (
            <Link
              key={migration.id}
              href={`/dashboard/migrations/${migration.id}`}
              className={styles.card}
            >
              <div className={styles.cardTop}>
                <div className={styles.cardInfo}>
                  <span className={styles.migrationName}>
                    {migration.name ||
                      `${formatPlatform(migration.sourcePlatform)} \u2192 ${formatPlatform(migration.destPlatform)}`}
                  </span>
                  <StatusBadge status={migration.status} />
                </div>
                <span className={styles.platformRoute}>
                  {formatPlatform(migration.sourcePlatform)} \u2192{' '}
                  {formatPlatform(migration.destPlatform)}
                </span>
              </div>

              <div className={styles.cardMeta}>
                <span>{migration.counts.posted} / {migration.counts.total} posted</span>
                {migration.counts.failed > 0 && (
                  <span style={{ color: 'var(--error)' }}>{migration.counts.failed} failed</span>
                )}
                <span>Created {new Date(migration.createdAt).toLocaleDateString()}</span>
              </div>

              <div className={styles.progressContainer}>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${getProgressPercent(migration)}%` }}
                  />
                </div>
                <div className={styles.progressLabel}>{getProgressPercent(migration)}% complete</div>
              </div>

              {(migration.status === 'ACTIVE' || migration.status === 'PAUSED') && (
                <div className={styles.cardActions}>
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => handlePauseResume(e, migration)}
                  >
                    {migration.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    className={styles.cancelBtn}
                    onClick={(e) => handleCancel(e, migration)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
