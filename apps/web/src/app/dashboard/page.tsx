'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import VideoCard from '@/components/VideoCard';
import styles from './page.module.css';

interface Video {
  id: string;
  title: string | null;
  thumbnailUrl?: string | null;
  status: 'PENDING' | 'DOWNLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  platform?: string | null;
  posts?: { platform: string }[];
  createdAt: string;
}

export default function DashboardPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    async function fetchVideos() {
      try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error('Failed to fetch videos');
        const data = await res.json();
        setVideos(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    }

    fetchVideos();
  }, [authStatus]);

  if (authStatus === 'loading' || authStatus === 'unauthenticated') {
    return <div className={styles.loading}>Loading...</div>;
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredVideos = normalizedSearchQuery
    ? videos.filter((video) =>
        (video.title ?? '').toLowerCase().includes(normalizedSearchQuery)
      )
    : videos;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Your Videos</h1>
        <Link href="/dashboard/import" className={styles.importBtn}>
          + Import New Video
        </Link>
      </div>

      {loading && <div className={styles.loading}>Loading videos...</div>}

      {error && <div className={styles.error}>{error}</div>}

      {!loading && !error && videos.length === 0 && (
        <div className={styles.empty}>
          <p>No videos yet. Import your first YouTube video to get started.</p>
          <Link href="/dashboard/import" className={styles.importBtn}>
            Import a Video
          </Link>
        </div>
      )}

      {!loading && !error && videos.length > 0 && (
        <div className={styles.searchBar}>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search videos..."
            aria-label="Search videos by title"
          />
        </div>
      )}

      {!loading && !error && videos.length > 0 && filteredVideos.length === 0 && (
        <div className={styles.empty}>
          <p>No videos match your search.</p>
        </div>
      )}

      {!loading && !error && filteredVideos.length > 0 && (
        <div className={styles.grid}>
          {filteredVideos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
