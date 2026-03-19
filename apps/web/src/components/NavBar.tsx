'use client';

import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';
import styles from './NavBar.module.css';

export default function NavBar() {
  const { data: session, status } = useSession();

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          ClipFlow
        </Link>
        <div className={styles.links}>
          {session && (
            <Link href="/dashboard" className={styles.link}>
              Dashboard
            </Link>
          )}
          {status === 'loading' ? null : session ? (
            <button className="btn-secondary" onClick={() => signOut()}>
              Sign Out
            </button>
          ) : (
            <button className="btn-primary" onClick={() => signIn()}>
              Sign In
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
