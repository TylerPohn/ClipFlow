'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import StatusBadge from '../../../../components/StatusBadge';
import styles from './page.module.css';

interface MigrationPost {
  id: string;
  videoId: string;
  video: {
    id: string;
    title: string | null;
    thumbnailUrl: string | null;
  };
  caption: string | null;
  hashtags: string[];
  scheduledAt: string;
  status: 'SCHEDULED' | 'UPLOADING' | 'POSTED' | 'FAILED' | 'DRAFT';
}

interface Migration {
  id: string;
  name: string | null;
  sourcePlatform: string;
  destPlatform: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  posts: MigrationPost[];
}

export default function MigrationDetailPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [migration, setMigration] = useState<Migration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editScheduledAt, setEditScheduledAt] = useState('');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  const fetchMigration = useCallback(async () => {
    try {
      const res = await fetch(`/api/migrations/${id}`);
      if (!res.ok) throw new Error('Failed to fetch migration');
      const data = await res.json();
      setMigration(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    fetchMigration();
  }, [authStatus, fetchMigration]);

  // Auto-refresh every 10 seconds while ACTIVE
  useEffect(() => {
    if (!migration || migration.status !== 'ACTIVE') return;
    const interval = setInterval(fetchMigration, 10000);
    return () => clearInterval(interval);
  }, [migration?.status, fetchMigration]);

  async function handlePauseResume() {
    if (!migration) return;
    const newStatus = migration.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const res = await fetch(`/api/migrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update migration');
      setMigration((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this migration? Remaining scheduled posts will not be published.')) return;
    try {
      const res = await fetch(`/api/migrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) throw new Error('Failed to cancel migration');
      setMigration((prev) => prev ? { ...prev, status: 'CANCELLED' } : prev);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function handleRetry(postId: string) {
    try {
      const res = await fetch(`/api/migrations/${id}/posts/${postId}/retry`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Retry failed');
      fetchMigration();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    }
  }

  function startEdit(post: MigrationPost) {
    setEditingPostId(post.id);
    setEditCaption(post.caption ?? '');
    setEditHashtags(post.hashtags.join(', '));
    setEditScheduledAt(post.scheduledAt.slice(0, 16)); // datetime-local format
  }

  function cancelEdit() {
    setEditingPostId(null);
  }

  async function saveEdit(postId: string) {
    try {
      const res = await fetch(`/api/migrations/${id}/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: editCaption,
          hashtags: editHashtags.split(',').map((h) => h.trim()).filter(Boolean),
          scheduledAt: new Date(editScheduledAt).toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save changes');
      setEditingPostId(null);
      fetchMigration();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
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

  function getCounts() {
    if (!migration) return { total: 0, posted: 0, failed: 0, remaining: 0 };
    const total = migration.posts.length;
    const posted = migration.posts.filter((p) => p.status === 'POSTED').length;
    const failed = migration.posts.filter((p) => p.status === 'FAILED').length;
    return { total, posted, failed, remaining: total - posted - failed };
  }

  function getProgressPercent(): number {
    const { total, posted, failed } = getCounts();
    if (total === 0) return 0;
    return Math.round(((posted + failed) / total) * 100);
  }

  // Group posts by date
  function groupPostsByDate(posts: MigrationPost[]): Record<string, MigrationPost[]> {
    const groups: Record<string, MigrationPost[]> = {};
    const sorted = [...posts].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
    for (const post of sorted) {
      const date = new Date(post.scheduledAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(post);
    }
    return groups;
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

  if (!migration) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Migration not found.</div>
      </div>
    );
  }

  const grouped = groupPostsByDate(migration.posts ?? []);

  return (
    <div className={styles.container}>
      <Link href="/dashboard/migrations" className={styles.backLink}>
        &larr; Back to Migrations
      </Link>

      {error && <div className={styles.error}>{error}</div>}

      {/* Header card */}
      <div className={styles.headerCard}>
        <div className={styles.headerTop}>
          <div className={styles.headerInfo}>
            <span className={styles.migrationName}>
              {migration.name ||
                `${formatPlatform(migration.sourcePlatform)} \u2192 ${formatPlatform(migration.destPlatform)}`}
            </span>
            <StatusBadge status={migration.status} />
          </div>

          {(migration.status === 'ACTIVE' || migration.status === 'PAUSED') && (
            <div className={styles.headerActions}>
              <button className={styles.actionBtn} onClick={handlePauseResume}>
                {migration.status === 'ACTIVE' ? 'Pause' : 'Resume'}
              </button>
              <button className={styles.cancelBtn} onClick={handleCancel}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className={styles.platformRoute}>
          {formatPlatform(migration.sourcePlatform)} &rarr;{' '}
          {formatPlatform(migration.destPlatform)}
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statValue}>{getCounts().posted}</div>
            <div className={styles.statLabel}>Posted</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{getCounts().failed}</div>
            <div className={styles.statLabel}>Failed</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{getCounts().remaining}</div>
            <div className={styles.statLabel}>Remaining</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{getCounts().total}</div>
            <div className={styles.statLabel}>Total</div>
          </div>
        </div>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${getProgressPercent()}%` }}
            />
          </div>
          <div className={styles.progressLabel}>{getProgressPercent()}% complete</div>
        </div>
      </div>

      {/* Posts timeline */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Scheduled Posts</h2>

        {Object.keys(grouped).length === 0 ? (
          <div className={styles.emptyPosts}>No posts in this migration.</div>
        ) : (
          Object.entries(grouped).map(([date, posts]) => (
            <div key={date} className={styles.dateGroup}>
              <div className={styles.dateLabel}>{date}</div>
              {posts.map((post) => (
                <div key={post.id}>
                  <div className={styles.postItem}>
                    {post.video.thumbnailUrl ? (
                      <img src={post.video.thumbnailUrl} alt="" className={styles.postThumb} />
                    ) : (
                      <div className={styles.postThumb} />
                    )}
                    <div className={styles.postInfo}>
                      <div className={styles.postTitle}>{post.video.title}</div>
                      <div className={styles.postTime}>
                        {new Date(post.scheduledAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <div className={styles.postActions}>
                      <StatusBadge status={post.status} />
                      {post.status === 'FAILED' && (
                        <button
                          className={styles.retryBtn}
                          onClick={() => handleRetry(post.id)}
                        >
                          Retry
                        </button>
                      )}
                      {post.status === 'SCHEDULED' && (
                        <button
                          className={styles.editBtn}
                          onClick={() => startEdit(post)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline edit form */}
                  {editingPostId === post.id && (
                    <div className={styles.editForm}>
                      <label>Caption</label>
                      <textarea
                        value={editCaption}
                        onChange={(e) => setEditCaption(e.target.value)}
                      />
                      <label>Hashtags (comma-separated)</label>
                      <input
                        type="text"
                        value={editHashtags}
                        onChange={(e) => setEditHashtags(e.target.value)}
                      />
                      <label>Scheduled Time</label>
                      <input
                        type="datetime-local"
                        value={editScheduledAt}
                        onChange={(e) => setEditScheduledAt(e.target.value)}
                      />
                      <div className={styles.editActions}>
                        <button
                          className={styles.saveBtn}
                          onClick={() => saveEdit(post.id)}
                        >
                          Save
                        </button>
                        <button className={styles.editCancelBtn} onClick={cancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
