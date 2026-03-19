import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DownloadOptions {
  url: string;
  outputPath: string;
  format?: string;
}

export interface DownloadResult {
  filePath: string;
  title: string;
  duration: number;
}

export async function downloadVideo(
  options: DownloadOptions
): Promise<DownloadResult> {
  const { url, outputPath, format } = options;

  const args = [
    url,
    '-o',
    outputPath,
    '--write-info-json',
    '--no-playlist',
  ];

  if (format) {
    args.push('-f', format);
  }

  await execFileAsync('yt-dlp', args);

  // Read info JSON for metadata
  const infoPath = outputPath.replace(/\.[^.]+$/, '.info.json');
  const { stdout } = await execFileAsync('cat', [infoPath]);
  const info = JSON.parse(stdout);

  return {
    filePath: outputPath,
    title: info.title ?? 'Untitled',
    duration: info.duration ?? 0,
  };
}
