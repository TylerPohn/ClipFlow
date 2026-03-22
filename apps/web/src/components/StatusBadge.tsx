'use client';

import styles from './StatusBadge.module.css';

type Status = 'PENDING' | 'DOWNLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DRAFT' | 'UPLOADING' | 'POSTED' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

const statusColors: Record<Status, string> = {
  PENDING: 'yellow',
  DOWNLOADING: 'blue',
  PROCESSING: 'blue',
  READY: 'green',
  FAILED: 'red',
  DRAFT: 'yellow',
  UPLOADING: 'blue',
  POSTED: 'green',
  SCHEDULED: 'blue',
  ACTIVE: 'green',
  PAUSED: 'yellow',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

export default function StatusBadge({ status }: { status: Status }) {
  const color = statusColors[status] || 'yellow';
  return (
    <span className={`${styles.badge} ${styles[color]}`}>
      {status}
    </span>
  );
}
