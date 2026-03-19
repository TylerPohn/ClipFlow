'use client';

import Link from 'next/link';
import StatusBadge from './StatusBadge';
import styles from './VideoCard.module.css';

interface Video {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  status: 'PENDING' | 'DOWNLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  createdAt: string;
}

export default function VideoCard({ video }: { video: Video }) {
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
