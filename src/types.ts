export interface Segment {
  start: number;
  end: number;
}

export interface Session {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  blob: Blob;
  transcript: string;
  segments: Segment[];
  currentTime: number;
  savedAt: number;
}

export interface Settings {
  rate: number;
  volume: number;
  sentenceMode: boolean;
  autoRewind: boolean;
  rewindSecs: number;
  minSilenceMs: number;
  sensitivity: number;
}

// sentenceMode/autoRewind mặc định TẮT: can thiệp vào thao tác tay của người
// dùng (tự dừng, tự lùi vị trí) gây cảm giác khó điều khiển — ai muốn thì bật.
export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  volume: 1,
  sentenceMode: false,
  autoRewind: false,
  rewindSecs: 1,
  minSilenceMs: 450,
  sensitivity: 4,
};

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
