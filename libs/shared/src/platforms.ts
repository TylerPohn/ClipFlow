export interface PlatformPostFields {
  title: boolean;
  description: boolean;
  tags: boolean;
  visibility: boolean;
  thumbnail: boolean;
}

export interface PlatformConfig {
  displayName: string;
  oauthScopes: string[];
  supportsSync: boolean;
  supportsPost: boolean;
  postFields: PlatformPostFields;
  maxDurationSeconds?: number;
}

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  YOUTUBE: {
    displayName: 'YouTube',
    oauthScopes: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
    ],
    supportsSync: true,
    supportsPost: true,
    postFields: {
      title: true,
      description: true,
      tags: true,
      visibility: true,
      thumbnail: true,
    },
  },
  YOUTUBE_SHORTS: {
    displayName: 'YouTube Shorts',
    oauthScopes: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
    ],
    supportsSync: false,
    supportsPost: true,
    postFields: {
      title: true,
      description: true,
      tags: true,
      visibility: true,
      thumbnail: false,
    },
    maxDurationSeconds: 60,
  },
  TIKTOK: {
    displayName: 'TikTok',
    oauthScopes: ['user.info.basic', 'video.publish', 'video.upload'],
    supportsSync: false,
    supportsPost: true,
    postFields: {
      title: true,
      description: false,
      tags: true,
      visibility: true,
      thumbnail: false,
    },
  },
  INSTAGRAM: {
    displayName: 'Instagram',
    oauthScopes: ['instagram_basic', 'instagram_content_publish'],
    supportsSync: true,
    supportsPost: true,
    postFields: {
      title: false,
      description: true,
      tags: true,
      visibility: false,
      thumbnail: true,
    },
    maxDurationSeconds: 60,
  },
  X: {
    displayName: 'X',
    oauthScopes: [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
    ],
    supportsSync: false,
    supportsPost: true,
    postFields: {
      title: false,
      description: true,
      tags: true,
      visibility: false,
      thumbnail: false,
    },
    maxDurationSeconds: 140,
  },
};
