import ffmpeg from 'fluent-ffmpeg';
import { execFileSync } from 'child_process';

export interface ProcessVideoOptions {
  inputPath: string;
  outputPath: string;
  maxDuration?: number;
  width?: number;
  height?: number;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  codec: string;
  size: number;
}

export function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      resolve({
        duration: metadata.format.duration ?? 0,
        width: videoStream.width ?? 0,
        height: videoStream.height ?? 0,
        codec: videoStream.codec_name ?? 'unknown',
        size: metadata.format.size ?? 0,
      });
    });
  });
}

export function processVideo(options: ProcessVideoOptions): Promise<void> {
  const { inputPath, outputPath, maxDuration, width, height } = options;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    if (maxDuration) {
      command = command.duration(maxDuration);
    }

    if (width && height) {
      command = command.size(`${width}x${height}`);
    }

    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

export function generateThumbnail(
  inputPath: string,
  outputPath: string,
  timestamp = '00:00:01'
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [timestamp],
        filename: outputPath,
        count: 1,
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
}

export interface ProcessVideoVerticalOptions {
  inputPath: string;
  outputPath: string;
  startTime?: number;
  endTime?: number;
  width?: number;
  height?: number;
  subtitlePath?: string;
}

export async function processVideoVertical(
  options: ProcessVideoVerticalOptions
): Promise<void> {
  const {
    inputPath,
    outputPath,
    startTime,
    endTime,
    width = 1080,
    height = 1920,
    subtitlePath,
  } = options;

  const metadata = await getVideoMetadata(inputPath);
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;

  // Build video filter chain
  const filters: string[] = [];

  // Scale and crop for vertical format
  const targetAspect = width / height;
  const srcAspect = srcWidth / srcHeight;

  if (srcAspect > targetAspect) {
    filters.push(`scale=-2:${height}`);
    filters.push(`crop=${width}:${height}`);
  } else {
    filters.push(`scale=${width}:-2`);
    filters.push(`crop=${width}:${height}`);
  }

  if (subtitlePath) {
    const isAss = subtitlePath.endsWith('.ass');
    const filterName = isAss ? 'ass' : 'subtitles';
    const escapedPath = subtitlePath
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    filters.push(`${filterName}='${escapedPath}'`);
  }

  const args: string[] = [];

  if (startTime !== undefined) {
    args.push('-ss', String(startTime));
  }

  args.push('-i', inputPath);

  if (endTime !== undefined) {
    const duration =
      startTime !== undefined ? endTime - startTime : endTime;
    args.push('-t', String(duration));
  }

  args.push(
    '-vf', filters.join(','),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-crf', '23',
    '-y',
    outputPath
  );

  console.log('ffmpeg args:', args.join(' '));

  const { writeFileSync } = await import('fs');
  try {
    execFileSync('ffmpeg', args, {
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    const err = error as { stderr?: Buffer; status?: number };
    const stderr = err.stderr?.toString() || '';
    writeFileSync('/tmp/clipflow-ffmpeg-stderr.log', stderr);
    console.error('Full ffmpeg stderr written to /tmp/clipflow-ffmpeg-stderr.log');
    const lastLines = stderr.split('\n').slice(-15).join('\n');
    throw new Error(`ffmpeg exited with code ${err.status}: ${lastLines}`);
  }
}
