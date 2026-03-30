'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';
import styles from './NavBar.module.css';

export default function NavBar() {
  const { data: session, status } = useSession();
  const [platformsOpen, setPlatformsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPlatformsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          ClipFlow
        </Link>
        <div className={styles.links}>
          {session && (
            <>
              <Link href="/dashboard" className={styles.link}>
                Dashboard
              </Link>
              <div className={styles.dropdown} ref={dropdownRef}>
                <button
                  className={styles.dropdownToggle}
                  onClick={() => setPlatformsOpen((v) => !v)}
                  type="button"
                >
                  Platforms
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="currentColor"
                    className={platformsOpen ? styles.chevronUp : ''}
                  >
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {platformsOpen && (
                  <div className={styles.dropdownMenu}>
                    <Link href="/dashboard/platforms" className={styles.dropdownItem} onClick={() => setPlatformsOpen(false)}>
                      All Platforms
                    </Link>
                    <div className={styles.dropdownDivider} />
                    <Link href="/dashboard/platforms/youtube" className={styles.dropdownItem} onClick={() => setPlatformsOpen(false)}>
                      YouTube
                    </Link>
                    <Link href="/dashboard/platforms/tiktok" className={styles.dropdownItem} onClick={() => setPlatformsOpen(false)}>
                      TikTok
                    </Link>
                    <Link href="/dashboard/platforms/instagram" className={styles.dropdownItem} onClick={() => setPlatformsOpen(false)}>
                      Instagram
                    </Link>
                    <Link href="/dashboard/platforms/x" className={styles.dropdownItem} onClick={() => setPlatformsOpen(false)}>
                      X
                    </Link>
                  </div>
                )}
              </div>
              <Link href="/dashboard/migrations" className={styles.link}>
                Migrations
              </Link>
              <Link href="/dashboard/schedule" className={styles.link}>
                Schedule
              </Link>
            </>
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
