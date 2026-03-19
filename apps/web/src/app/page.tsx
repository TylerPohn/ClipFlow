import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <h1 className={styles.heading}>
          Turn YouTube videos into TikTok clips
        </h1>
        <p className={styles.subheading}>
          Import, trim, add captions, and publish -- all in one workflow.
        </p>
        <Link href="/dashboard" className={styles.cta}>
          Get Started
        </Link>
      </section>

      <section className={styles.features}>
        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h3>Import</h3>
          <p>Paste a YouTube URL and we handle the rest. Your video is downloaded and ready in seconds.</p>
        </div>
        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <h3>Process</h3>
          <p>Trim to the perfect clip, add captions with different styles, and format for vertical video.</p>
        </div>
        <div className={styles.feature}>
          <div className={styles.featureIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
          <h3>Publish</h3>
          <p>Post directly to TikTok with captions and hashtags. Schedule or publish instantly.</p>
        </div>
      </section>
    </div>
  );
}
