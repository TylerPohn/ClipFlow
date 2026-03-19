import OpenAI from 'openai';
import { createReadStream } from 'fs';
import type { TranscriptWord } from '@clipflow/shared';

const openai = new OpenAI();

export interface TranscriptionResult {
  text: string;
  words: TranscriptWord[];
}

export async function transcribeVideo(
  filePath: string
): Promise<TranscriptionResult> {
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  const words: TranscriptWord[] = (response.words ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  return {
    text: response.text,
    words,
  };
}
