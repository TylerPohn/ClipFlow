import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

const execFileAsync = promisify(execFile);

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

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
    '--merge-output-format',
    'mp4',
  ];

  if (format) {
    args.push('-f', format);
  }

  await execFileAsync(YT_DLP, args);

  // yt-dlp writes info JSON alongside the output file
  const infoPath = outputPath.replace(/\.[^.]+$/, '.info.json');
  const infoData = await readFile(infoPath, 'utf-8');
  const info = JSON.parse(infoData);

  return {
    filePath: outputPath,
    title: info.title ?? 'Untitled',
    duration: info.duration ?? 0,
  };
}
