import { writeFile } from 'fs/promises';
import type { TranscriptWord } from '@clipflow/shared';

interface SubtitleSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

function groupWordsIntoSegments(words: TranscriptWord[]): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  let currentWords: TranscriptWord[] = [];
  let segmentIndex = 1;

  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i]);

    const isLastWord = i === words.length - 1;
    const hasEnoughWords = currentWords.length >= 5;
    const hasPause =
      !isLastWord && words[i + 1].start - words[i].end > 0.3;
    const atMaxWords = currentWords.length >= 8;

    if (isLastWord || (hasEnoughWords && hasPause) || atMaxWords) {
      segments.push({
        index: segmentIndex++,
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map((w) => w.word).join(' '),
        words: [...currentWords],
      });
      currentWords = [];
    }
  }

  return segments;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Simple heuristic for keyword detection: words longer than 3 chars
// that are likely nouns/verbs (not common stop words)
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'not', 'yet', 'so',
  'in', 'on', 'at', 'to', 'of', 'is', 'it', 'be', 'as', 'do', 'we', 'he',
  'she', 'by', 'if', 'my', 'up', 'no', 'am', 'was', 'are', 'has', 'had',
  'its', 'his', 'her', 'our', 'who', 'how', 'all', 'can', 'did', 'get',
  'got', 'him', 'may', 'own', 'say', 'too', 'use', 'way', 'you', 'with',
  'this', 'that', 'from', 'they', 'been', 'have', 'were', 'what', 'when',
  'will', 'more', 'them', 'then', 'than', 'each', 'just', 'also', 'into',
  'some', 'very', 'about', 'would', 'there', 'their', 'which', 'could',
  'other', 'these', 'those', 'being', 'after', 'should',
]);

function isKeyword(word: string): boolean {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  return cleaned.length > 3 && !STOP_WORDS.has(cleaned);
}

export async function generateSrtFile(
  words: TranscriptWord[],
  outputPath: string
): Promise<void> {
  if (words.length === 0) {
    throw new Error('No words provided for SRT generation');
  }

  const segments = groupWordsIntoSegments(words);
  const srtContent = segments
    .map(
      (seg) =>
        `${seg.index}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}`
    )
    .join('\n\n');

  await writeFile(outputPath, srtContent + '\n', 'utf-8');
}

export async function generateAssFile(
  words: TranscriptWord[],
  outputPath: string,
  style: 'default' | 'highlight' = 'default'
): Promise<void> {
  if (words.length === 0) {
    throw new Error('No words provided for ASS generation');
  }

  const segments = groupWordsIntoSegments(words);

  const header = `[Script Info]
Title: ClipFlow Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,120,1
Style: Highlight,Arial,72,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let events = '';

  for (const seg of segments) {
    const start = formatAssTime(seg.start);
    const end = formatAssTime(seg.end);

    if (style === 'highlight') {
      // Build text with highlighted keywords
      const styledText = seg.words
        .map((w) => {
          if (isKeyword(w.word)) {
            return `{\\rHighlight}${w.word}{\\rDefault}`;
          }
          return w.word;
        })
        .join(' ');
      events += `Dialogue: 0,${start},${end},Default,,0,0,0,,${styledText}\n`;
    } else {
      events += `Dialogue: 0,${start},${end},Default,,0,0,0,,${seg.text}\n`;
    }
  }

  await writeFile(outputPath, header + events, 'utf-8');
}

export async function burnCaptions(
  inputPath: string,
  subtitlePath: string,
  outputPath: string
): Promise<void> {
  const ffmpeg = (await import('fluent-ffmpeg')).default;

  const isAss = subtitlePath.endsWith('.ass');
  const filterName = isAss ? 'ass' : 'subtitles';
  // Escape special characters in path for ffmpeg filter
  const escapedPath = subtitlePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(`${filterName}='${escapedPath}'`)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-crf', '23'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
