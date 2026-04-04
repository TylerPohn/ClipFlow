import Link from 'next/link';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.copyright}>
          &copy; {new Date().getFullYear()} Cliptopus
        </span>
        <div className={styles.links}>
          <Link href="/privacy" className={styles.link}>
            Privacy Policy
          </Link>
          <Link href="/terms" className={styles.link}>
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
