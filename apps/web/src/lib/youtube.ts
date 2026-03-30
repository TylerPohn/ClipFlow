import { prisma } from '@clipflow/db';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

/**
 * Refresh a Google OAuth access token if expired.
 * Accepts a PlatformAccount ID and refreshes/returns the access token.
 */
export async function getValidAccessToken(platformAccountId: string): Promise<string> {
  const platformAccount = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  });
  if (!platformAccount?.accessToken) {
    throw new Error('No YouTube PlatformAccount found or missing access token');
  }

  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Refresh if expires within 5 minutes
  if (
    platformAccount.tokenExpiresAt &&
    platformAccount.tokenExpiresAt < fiveMinutesFromNow &&
    platformAccount.refreshToken
  ) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: platformAccount.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`YouTube token refresh failed: ${res.status}`, errorBody);
      throw new Error(`Token refresh failed: ${res.status} - ${errorBody}`);
    }

    const data: GoogleTokenResponse = await res.json();

    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      },
    });

    return data.access_token;
  }

  return platformAccount.accessToken;
}

/**
 * Get the authenticated user's YouTube channel info.
 */
export async function getMyChannel(accessToken: string) {
  const res = await fetch(
    `${YOUTUBE_API_BASE}/channels?part=snippet,contentDetails,statistics&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`YouTube channels.list failed: ${res.status}`);
  }

  const data = await res.json();
  const channel = data.items?.[0];
  if (!channel) {
    throw new Error('No YouTube channel found for this account');
  }

  return {
    channelId: channel.id as string,
    channelName: channel.snippet.title as string,
    channelHandle: (channel.snippet.customUrl as string) ?? null,
    thumbnailUrl: (channel.snippet.thumbnails?.default?.url as string) ?? null,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads as string,
  };
}

/**
 * List video IDs from an uploads playlist (paginated).
 */
export async function listUploadedVideoIds(
  accessToken: string,
  playlistId: string,
  maxResults = 50,
  pageToken?: string
): Promise<{ videoIds: string[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    part: 'contentDetails',
    playlistId,
    maxResults: String(maxResults),
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`${YOUTUBE_API_BASE}/playlistItems?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`YouTube playlistItems.list failed: ${res.status}`);
  }

  const data = await res.json();
  const videoIds = (data.items ?? []).map(
    (item: { contentDetails: { videoId: string } }) => item.contentDetails.videoId
  );

  return { videoIds, nextPageToken: data.nextPageToken };
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl: string | null;
  duration: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YouTubeComment {
  commentId: string;
  authorName: string;
  authorProfileUrl: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  replyCount: number;
}

/**
 * Get full video details for up to 50 video IDs.
 */
export async function getVideoDetails(
  accessToken: string,
  videoIds: string[]
): Promise<YouTubeVideoDetails[]> {
  if (videoIds.length === 0) return [];

  const res = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`YouTube videos.list failed: ${res.status}`);
  }

  const data = await res.json();

  return (data.items ?? []).map(
    (item: {
      id: string;
      snippet: {
        title: string;
        description: string;
        tags?: string[];
        thumbnails?: { maxres?: { url: string }; high?: { url: string }; default?: { url: string } };
        publishedAt: string;
      };
      contentDetails: { duration: string };
      statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
    }) => ({
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      tags: item.snippet.tags ?? [],
      thumbnailUrl:
        item.snippet.thumbnails?.maxres?.url ??
        item.snippet.thumbnails?.high?.url ??
        item.snippet.thumbnails?.default?.url ??
        null,
      duration: item.contentDetails.duration,
      publishedAt: item.snippet.publishedAt,
      viewCount: parseInt(item.statistics.viewCount ?? '0', 10),
      likeCount: parseInt(item.statistics.likeCount ?? '0', 10),
      commentCount: parseInt(item.statistics.commentCount ?? '0', 10),
    })
  );
}

/**
 * Get top-level comments for a YouTube video (paginated).
 */
export async function getVideoComments(
  accessToken: string,
  videoId: string,
  maxResults = 50,
  pageToken?: string
): Promise<{ comments: YouTubeComment[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    part: 'snippet',
    videoId,
    maxResults: String(Math.min(maxResults, 100)),
    order: 'relevance',
    textFormat: 'plainText',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`${YOUTUBE_API_BASE}/commentThreads?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    if (res.status === 403) {
      return { comments: [] };
    }
    throw new Error(`YouTube commentThreads.list failed: ${res.status}`);
  }

  const data = await res.json();

  const comments: YouTubeComment[] = (data.items ?? []).map(
    (item: {
      id: string;
      snippet: {
        totalReplyCount: number;
        topLevelComment: {
          snippet: {
            authorDisplayName: string;
            authorProfileImageUrl: string;
            textDisplay: string;
            likeCount: number;
            publishedAt: string;
          };
        };
      };
    }) => ({
      commentId: item.id,
      authorName: item.snippet.topLevelComment.snippet.authorDisplayName,
      authorProfileUrl: item.snippet.topLevelComment.snippet.authorProfileImageUrl,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      likeCount: item.snippet.topLevelComment.snippet.likeCount,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
      replyCount: item.snippet.totalReplyCount,
    })
  );

  return { comments, nextPageToken: data.nextPageToken };
}

/**
 * Subscribe to PubSubHubbub push notifications for a YouTube channel.
 */
export async function subscribeToPush(channelId: string): Promise<boolean> {
  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/youtube`;
  const topicUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'hub.callback': callbackUrl,
      'hub.topic': topicUrl,
      'hub.verify': 'async',
      'hub.mode': 'subscribe',
      'hub.lease_seconds': '432000', // 5 days
    }),
  });

  return res.ok || res.status === 202;
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to seconds.
 */
export function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
