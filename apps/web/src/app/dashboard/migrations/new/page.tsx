'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PLATFORM_CONFIG } from '@clipflow/shared/src/platforms';
import styles from './page.module.css';

type PlatformKey = 'YOUTUBE' | 'YOUTUBE_SHORTS' | 'TIKTOK' | 'INSTAGRAM' | 'X';

const SOURCE_PLATFORMS: PlatformKey[] = ['YOUTUBE', 'YOUTUBE_SHORTS'];
const DEST_PLATFORMS: PlatformKey[] = ['TIKTOK', 'INSTAGRAM', 'YOUTUBE_SHORTS', 'X'];

interface AccountStatus {
  connected: boolean;
  displayName?: string | null;
}

interface Video {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  alreadyPosted?: boolean;
}

interface PreviewItem {
  videoId: string;
  videoTitle: string | null;
  caption: string | null;
  hashtags: string[];
  scheduledAt: string;
}

const STEP_LABELS = ['Source & Dest', 'Select Videos', 'Settings', 'Schedule', 'Review'];

export default function NewMigrationPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();

  // Step state
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  // Step 1: Source & Destination
  const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [sourcePlatform, setSourcePlatform] = useState<PlatformKey | ''>('');
  const [destPlatform, setDestPlatform] = useState<PlatformKey | ''>('');

  // Step 2: Select Videos
  const [videos, setVideos] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Step 3: Default Settings
  const [captionTemplate, setCaptionTemplate] = useState('{{originalTitle}}');
  const [hashtags, setHashtags] = useState('');
  const [visibility, setVisibility] = useState('public');

  // Step 4: Schedule
  const [videosPerDay, setVideosPerDay] = useState(2);
  const [timeSlots, setTimeSlots] = useState<string[]>(['09:00', '17:00']);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [skipWeekends, setSkipWeekends] = useState(false);

  // Step 5: Preview
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    }
  }, [authStatus, router]);

  // Fetch account status
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/accounts/status');
        if (!res.ok) throw new Error('Failed to fetch accounts');
        const data = await res.json();
        setAccounts(data.accounts);
      } catch {
        setError('Failed to load account connections');
      } finally {
        setAccountsLoading(false);
      }
    }
    fetchAccounts();
  }, [authStatus]);

  // Fetch videos when entering step 2
  const fetchVideos = useCallback(async () => {
    if (!sourcePlatform) return;
    setVideosLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/platforms/${sourcePlatform}/videos`);
      if (!res.ok) throw new Error('Failed to fetch videos');
      const data = await res.json();
      const videoList: Video[] = (data.videos ?? data).map((v: Video & { posts?: Array<{ platform: string; status: string }> }) => ({
        ...v,
        alreadyPosted: v.posts?.some(
          (p: { platform: string; status: string }) => p.platform === destPlatform && p.status === 'POSTED'
        ) ?? false,
      }));
      setVideos(videoList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load videos');
    } finally {
      setVideosLoading(false);
    }
  }, [sourcePlatform, destPlatform]);

  // Fetch preview when entering step 5
  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    setError('');
    try {
      const res = await fetch('/api/migrations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePlatform,
          destPlatform,
          videoIds: Array.from(selectedVideoIds),
          defaultCaption: captionTemplate,
          defaultHashtags: hashtags
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean),
          cadence: {
            videosPerDay,
            timeSlots,
            skipWeekends,
          },
          startDate,
        }),
      });
      if (!res.ok) throw new Error('Failed to generate preview');
      const data = await res.json();
      setPreview(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [sourcePlatform, destPlatform, selectedVideoIds, captionTemplate, hashtags, visibility, videosPerDay, timeSlots, startDate, skipWeekends]);

  function handleNext() {
    setError('');
    if (step === 0) {
      if (!sourcePlatform || !destPlatform) {
        setError('Please select both source and destination platforms.');
        return;
      }
      setStep(1);
      fetchVideos();
    } else if (step === 1) {
      if (selectedVideoIds.size === 0) {
        setError('Please select at least one video.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      if (timeSlots.length === 0) {
        setError('Please add at least one time slot.');
        return;
      }
      setStep(4);
      fetchPreview();
    }
  }

  function handleBack() {
    setError('');
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/migrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePlatform,
          destPlatform,
          videoIds: Array.from(selectedVideoIds),
          defaultCaption: captionTemplate,
          defaultHashtags: hashtags
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean),
          defaultSettings: { visibility },
          cadence: {
            videosPerDay,
            timeSlots,
            skipWeekends,
          },
          startDate,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create migration');
      }
      const data = await res.json();
      router.push(`/dashboard/migrations/${data.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleVideo(id: string) {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const filtered = filteredVideos();
    if (selectedVideoIds.size === filtered.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(filtered.map((v) => v.id)));
    }
  }

  function filteredVideos(): Video[] {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter((v) => v.title.toLowerCase().includes(q));
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function addTimeSlot() {
    setTimeSlots((prev) => [...prev, '12:00']);
  }

  function removeTimeSlot(index: number) {
    setTimeSlots((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTimeSlot(index: number, value: string) {
    setTimeSlots((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function platformName(key: string): string {
    return PLATFORM_CONFIG[key]?.displayName ?? key;
  }

  function isConnected(key: string): boolean {
    // YOUTUBE_SHORTS uses the YOUTUBE account
    const lookupKey = key === 'YOUTUBE_SHORTS' ? 'YOUTUBE' : key;
    return accounts[lookupKey]?.connected ?? false;
  }

  // Group preview items by date
  function groupByDate(items: PreviewItem[]): Record<string, PreviewItem[]> {
    const groups: Record<string, PreviewItem[]> = {};
    for (const item of items) {
      const date = new Date(item.scheduledAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(item);
    }
    return groups;
  }

  if (authStatus === 'loading' || authStatus === 'unauthenticated') {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>New Migration</h1>
        <p>Set up a scheduled bulk migration of videos between platforms.</p>
      </div>

      {/* Step indicators */}
      <div className={styles.steps}>
        {STEP_LABELS.map((_, i) => (
          <div
            key={i}
            className={`${styles.step} ${i < step ? styles.stepDone : ''} ${i === step ? styles.stepActive : ''}`}
          />
        ))}
      </div>
      <div className={styles.stepLabel}>
        {STEP_LABELS.map((label, i) => (
          <span key={i} className={i === step ? styles.stepLabelActive : ''}>
            {label}
          </span>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Step 1: Source & Destination */}
      {step === 0 && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Source & Destination</h2>
          <p className={styles.cardSubtitle}>Choose where to pull videos from and where to post them.</p>

          {accountsLoading ? (
            <div className={styles.loading}>Loading accounts...</div>
          ) : (
            <>
              <div className={styles.fieldGroup}>
                <label>Source Platform</label>
                <div className={styles.selectGrid}>
                  {SOURCE_PLATFORMS.map((p) => (
                    <div
                      key={p}
                      className={`${styles.platformOption} ${sourcePlatform === p ? styles.platformOptionSelected : ''}`}
                      onClick={() => setSourcePlatform(p)}
                    >
                      <div className={styles.platformOptionName}>{platformName(p)}</div>
                      <div className={`${styles.platformOptionStatus} ${isConnected(p) ? styles.connected : styles.notConnected}`}>
                        {isConnected(p) ? 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.arrow}>&darr;</div>

              <div className={styles.fieldGroup}>
                <label>Destination Platform</label>
                <div className={styles.selectGrid}>
                  {DEST_PLATFORMS.map((p) => (
                    <div
                      key={p}
                      className={`${styles.platformOption} ${destPlatform === p ? styles.platformOptionSelected : ''}`}
                      onClick={() => setDestPlatform(p)}
                    >
                      <div className={styles.platformOptionName}>{platformName(p)}</div>
                      <div className={`${styles.platformOptionStatus} ${isConnected(p) ? styles.connected : styles.notConnected}`}>
                        {isConnected(p) ? 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className={styles.footer}>
            <div />
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={!sourcePlatform || !destPlatform}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Select Videos */}
      {step === 1 && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Select Videos</h2>
          <p className={styles.cardSubtitle}>
            Choose which videos to migrate from {platformName(sourcePlatform)} to {platformName(destPlatform)}.
          </p>

          {videosLoading ? (
            <div className={styles.loading}>Loading videos...</div>
          ) : videos.length === 0 ? (
            <div className={styles.emptyVideos}>No videos found on {platformName(sourcePlatform)}.</div>
          ) : (
            <>
              <div className={styles.searchBar}>
                <input
                  type="text"
                  placeholder="Search videos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button className={styles.selectAllBtn} onClick={toggleSelectAll}>
                  {selectedVideoIds.size === filteredVideos().length ? 'Deselect All' : 'Select All'}
                </button>
                <span className={styles.selectedCount}>
                  {selectedVideoIds.size} selected
                </span>
              </div>

              <div className={styles.videoGrid}>
                {filteredVideos().map((video) => (
                  <div
                    key={video.id}
                    className={`${styles.videoItem} ${selectedVideoIds.has(video.id) ? styles.videoItemSelected : ''}`}
                    onClick={() => toggleVideo(video.id)}
                  >
                    <div
                      className={`${styles.videoCheck} ${selectedVideoIds.has(video.id) ? styles.videoCheckSelected : ''}`}
                    >
                      &#10003;
                    </div>
                    {video.thumbnailUrl ? (
                      <img src={video.thumbnailUrl} alt="" className={styles.videoThumb} />
                    ) : (
                      <div className={styles.videoThumb} />
                    )}
                    <div className={styles.videoInfo}>
                      <div className={styles.videoTitle}>{video.title}</div>
                      {video.duration && (
                        <div className={styles.videoDuration}>{formatDuration(video.duration)}</div>
                      )}
                      {video.alreadyPosted && (
                        <div className={styles.alreadyPosted}>Already posted to {platformName(destPlatform)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={styles.footer}>
            <button className="btn-secondary" onClick={handleBack}>Back</button>
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={selectedVideoIds.size === 0}
            >
              Next ({selectedVideoIds.size} selected)
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Default Settings */}
      {step === 2 && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Default Settings</h2>
          <p className={styles.cardSubtitle}>Configure default caption and visibility for migrated posts.</p>

          <div className={styles.fieldGroup}>
            <label>Caption Template</label>
            <input
              type="text"
              value={captionTemplate}
              onChange={(e) => setCaptionTemplate(e.target.value)}
              placeholder="{{originalTitle}}"
            />
            <div className={styles.fieldHint}>
              Use {'{{originalTitle}}'} to include the original video title.
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label>Hashtags</label>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="viral, fyp, content"
            />
            <div className={styles.fieldHint}>Comma-separated. These will be appended to captions.</div>
          </div>

          <div className={styles.fieldGroup}>
            <label>Visibility</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="friends">Friends Only</option>
            </select>
          </div>

          <div className={styles.footer}>
            <button className="btn-secondary" onClick={handleBack}>Back</button>
            <button className="btn-primary" onClick={handleNext}>Next</button>
          </div>
        </div>
      )}

      {/* Step 4: Schedule */}
      {step === 3 && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Schedule</h2>
          <p className={styles.cardSubtitle}>Set how many videos to post per day and when.</p>

          <div className={styles.fieldGroup}>
            <label>Videos per day</label>
            <div className={styles.inlineField}>
              <input
                type="number"
                min={1}
                max={10}
                value={videosPerDay}
                onChange={(e) => setVideosPerDay(Math.max(1, Math.min(10, Number(e.target.value))))}
              />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                (1-10 per day)
              </span>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label>Time Slots</label>
            <div className={styles.timeSlots}>
              {timeSlots.map((slot, i) => (
                <div key={i} className={styles.timeSlotRow}>
                  <input
                    type="time"
                    value={slot}
                    onChange={(e) => updateTimeSlot(i, e.target.value)}
                  />
                  {timeSlots.length > 1 && (
                    <button
                      className={styles.removeSlotBtn}
                      onClick={() => removeTimeSlot(i)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {timeSlots.length < 10 && (
                <button className={styles.addSlotBtn} onClick={addTimeSlot}>
                  + Add Time Slot
                </button>
              )}
            </div>
            <div className={styles.fieldHint}>
              Videos will be distributed across these time slots each day.
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <div className={styles.checkboxRow}>
              <input
                type="checkbox"
                id="skipWeekends"
                checked={skipWeekends}
                onChange={(e) => setSkipWeekends(e.target.checked)}
              />
              <label htmlFor="skipWeekends" style={{ margin: 0 }}>Skip weekends</label>
            </div>
          </div>

          <div className={styles.footer}>
            <button className="btn-secondary" onClick={handleBack}>Back</button>
            <button className="btn-primary" onClick={handleNext}>
              Preview Schedule
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Review & Confirm */}
      {step === 4 && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Review & Confirm</h2>
          <p className={styles.cardSubtitle}>
            Review your migration schedule before starting.
          </p>

          {previewLoading ? (
            <div className={styles.loading}>Generating preview...</div>
          ) : preview && preview.length > 0 ? (
            <>
              <div className={styles.previewSummary}>
                <div className={styles.previewStat}>
                  <div className={styles.previewStatValue}>{preview.length}</div>
                  <div className={styles.previewStatLabel}>Total Posts</div>
                </div>
                <div className={styles.previewStat}>
                  <div className={styles.previewStatValue}>{timeSlots.length}/day</div>
                  <div className={styles.previewStatLabel}>Posting Rate</div>
                </div>
                <div className={styles.previewStat}>
                  <div className={styles.previewStatValue}>
                    {new Date(preview[preview.length - 1].scheduledAt).toLocaleDateString()}
                  </div>
                  <div className={styles.previewStatLabel}>Est. Completion</div>
                </div>
                <div className={styles.previewStat}>
                  <div className={styles.previewStatValue}>
                    {platformName(sourcePlatform)} &rarr; {platformName(destPlatform)}
                  </div>
                  <div className={styles.previewStatLabel}>Route</div>
                </div>
              </div>

              <div className={styles.previewList}>
                {Object.entries(groupByDate(preview)).map(([date, items]) => (
                  <div key={date}>
                    <div className={styles.previewDate}>{date}</div>
                    {items.map((item, i) => (
                      <div key={i} className={styles.previewItem}>
                        <div className={styles.previewMeta}>
                          <div className={styles.previewTitle}>{item.videoTitle}</div>
                          <div className={styles.previewTime}>
                            {new Date(item.scheduledAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className={styles.footer}>
            <button className="btn-secondary" onClick={handleBack}>Back</button>
            <button
              className="btn-primary"
              onClick={handleConfirm}
              disabled={submitting || previewLoading}
            >
              {submitting ? 'Creating...' : 'Confirm & Start Migration'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
