'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import styles from './schedule.module.css';

interface ScheduledPost {
  id: string;
  platform: string;
  status: 'DRAFT' | 'SCHEDULED' | 'UPLOADING' | 'POSTED' | 'FAILED';
  caption: string | null;
  hashtags: string[];
  scheduledAt: string | null;
  postedAt: string | null;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    status: string;
  };
}

const PLATFORM_NAMES: Record<string, string> = {
  YOUTUBE: 'YouTube',
  YOUTUBE_SHORTS: 'YT Shorts',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  X: 'X',
};

export default function SchedulePage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ caption: '', hashtags: '', scheduledAt: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    fetchPosts();
  }, [authStatus]);

  async function fetchPosts() {
    try {
      const res = await fetch('/api/posts');
      if (!res.ok) throw new Error('Failed to fetch scheduled posts');
      const data: ScheduledPost[] = await res.json();
      setPosts(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function startEdit(post: ScheduledPost) {
    setEditingId(post.id);
    setEditForm({
      caption: post.caption || '',
      hashtags: post.hashtags.join(', '),
      scheduledAt: post.scheduledAt
        ? new Date(post.scheduledAt).toISOString().slice(0, 16)
        : '',
    });
  }

  async function handleSaveEdit(postId: string) {
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {};
      if (editForm.caption !== undefined) body.caption = editForm.caption;
      if (editForm.hashtags !== undefined) {
        body.hashtags = editForm.hashtags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
      if (editForm.scheduledAt) {
        body.scheduledAt = new Date(editForm.scheduledAt).toISOString();
      }

      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update post');
      }

      setEditingId(null);
      await fetchPosts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(postId: string) {
    if (!confirm('Are you sure you want to cancel this scheduled post?')) return;
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to cancel post');
      }
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1>Scheduled Posts</h1>
          <p>Manage individually scheduled posts across all platforms.</p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {posts.length === 0 ? (
        <div className={styles.empty}>
          <p>No scheduled posts. Schedule a video from the <Link href="/dashboard">video detail page</Link>.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {posts.map((post) =>
            editingId === post.id ? (
              <div key={post.id} className={styles.editForm}>
                <div>
                  <label>Caption</label>
                  <textarea
                    rows={2}
                    value={editForm.caption}
                    onChange={(e) => setEditForm((f) => ({ ...f, caption: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Hashtags (comma separated)</label>
                  <input
                    type="text"
                    value={editForm.hashtags}
                    onChange={(e) => setEditForm((f) => ({ ...f, hashtags: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Scheduled For</label>
                  <input
                    type="datetime-local"
                    value={editForm.scheduledAt}
                    onChange={(e) => setEditForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  />
                </div>
                <div className={styles.editActions}>
                  <button
                    className="btn-primary"
                    onClick={() => handleSaveEdit(post.id)}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setEditingId(null)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={post.id} className={styles.card}>
                {post.video.thumbnailUrl && (
                  <div className={styles.thumbnailWrapper}>
                    <img
                      src={`/api/videos/${post.video.id}/thumbnail`}
                      alt={post.video.title}
                      className={styles.thumbnail}
                    />
                  </div>
                )}

                <div className={styles.cardContent}>
                  <div className={styles.cardTop}>
                    <span className={styles.videoTitle}>{post.video.title}</span>
                    <span className={styles.platform}>
                      {PLATFORM_NAMES[post.platform] || post.platform}
                    </span>
                    <StatusBadge status={post.status} />
                  </div>

                  {post.caption && <p className={styles.caption}>{post.caption}</p>}

                  <div className={styles.cardMeta}>
                    {post.scheduledAt && (
                      <span>
                        Scheduled: {new Date(post.scheduledAt).toLocaleString()}
                      </span>
                    )}
                    {post.postedAt && (
                      <span>Posted: {new Date(post.postedAt).toLocaleString()}</span>
                    )}
                  </div>
                </div>

                {(post.status === 'SCHEDULED' || post.status === 'DRAFT') && (
                  <div className={styles.cardActions}>
                    <button className={styles.actionBtn} onClick={() => startEdit(post)}>
                      Edit
                    </button>
                    <button className={styles.cancelBtn} onClick={() => handleCancel(post.id)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
