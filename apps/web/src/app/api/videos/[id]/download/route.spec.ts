/**
 * @jest-environment node
 */
import { GET } from './route';

jest.mock('@/lib/auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@clipflow/db', () => ({
  prisma: {
    video: { findFirst: jest.fn() },
  },
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  GetObjectCommand: jest.fn().mockImplementation((input) => input),
}));

import { getServerSession } from '@/lib/auth';
import { prisma } from '@clipflow/db';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockFindFirst = prisma.video.findFirst as jest.MockedFunction<
  typeof prisma.video.findFirst
>;
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

function makeRequest() {
  return new Request('http://localhost/api/videos/vid_1/download');
}

function makeParams(id = 'vid_1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/videos/[id]/download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when video not found', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Video not found' });
  });

  it('returns 400 when video is not READY', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue({
      id: 'vid_1',
      status: 'PROCESSING',
      processedStorageKey: null,
    } as any);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Video is not ready for download',
    });
  });

  it('returns 400 when video is READY but has no processedStorageKey', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue({
      id: 'vid_1',
      status: 'READY',
      processedStorageKey: null,
    } as any);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(400);
  });

  it('returns presigned URL with Content-Disposition attachment for READY video', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue({
      id: 'vid_1',
      title: 'My Cool Video',
      status: 'READY',
      processedStorageKey: 'processed/vid_1.mp4',
    } as any);
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      url: 'https://s3.example.com/signed-url',
      expiresIn: 3600,
    });

    // Verify S3 command includes Content-Disposition for download
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'clipflow-processed',
      Key: 'processed/vid_1.mp4',
      ResponseContentDisposition: 'attachment; filename="My Cool Video.mp4"',
    });
  });

  it('sanitizes the filename from the video title', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue({
      id: 'vid_1',
      title: 'Video <with> "special" chars!',
      status: 'READY',
      processedStorageKey: 'processed/vid_1.mp4',
    } as any);
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');

    await GET(makeRequest(), makeParams());

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition:
          'attachment; filename="Video with special chars.mp4"',
      })
    );
  });

  it('uses "video" as default filename when title is null', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user_1' },
    } as any);
    mockFindFirst.mockResolvedValue({
      id: 'vid_1',
      title: null,
      status: 'READY',
      processedStorageKey: 'processed/vid_1.mp4',
    } as any);
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');

    await GET(makeRequest(), makeParams());

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: 'attachment; filename="video.mp4"',
      })
    );
  });
});
