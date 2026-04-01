'use client';

import Link from 'next/link';
import StatusBadge from './StatusBadge';
import styles from './VideoCard.module.css';

const PLATFORM_COLORS: Record<string, string> = {
  YOUTUBE: '#FF0000',
  YOUTUBE_SHORTS: '#FF0000',
  TIKTOK: '#00f2ea',
  INSTAGRAM: '#E4405F',
  X: '#a0a0a0',
};

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: 'YouTube',
  YOUTUBE_SHORTS: 'YT Shorts',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  X: 'X',
};

interface Post {
  platform: string;
}

interface Video {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  status: 'PENDING' | 'DOWNLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  platform?: string | null;
  posts?: Post[];
  createdAt: string;
}

function getPlatforms(video: Video): string[] {
  const platforms = new Set<string>();
  if (video.platform) platforms.add(video.platform);
  if (video.posts) {
    for (const post of video.posts) {
      platforms.add(post.platform);
    }
  }
  return Array.from(platforms);
}

export default function VideoCard({ video }: { video: Video }) {
  const platforms = getPlatforms(video);

  return (
    <Link href={`/dashboard/videos/${video.id}`} className={styles.card}>
      <div className={styles.thumbnail}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={video.title} />
        ) : (
          <div className={styles.placeholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        )}
        {platforms.length > 0 && (
          <div className={styles.platformBadges}>
            {platforms.map((p) => (
              <span
                key={p}
                className={styles.platformBadge}
                style={{
                  backgroundColor: PLATFORM_COLORS[p] || '#666',
                }}
              >
                {PLATFORM_LABELS[p] || p}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.info}>
        <h3 className={styles.title}>{video.title}</h3>
        <div className={styles.meta}>
          <StatusBadge status={video.status} />
          <span className={styles.date}>
            {new Date(video.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </Link>
  );
}
