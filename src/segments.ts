import type { Segment } from './types';

export interface SplitOptions {
  /** Độ dài khoảng lặng tính từ lúc im để coi là kết thúc câu (ms). */
  minSilenceMs: number;
  /** 1..10 — cao thì nhạy hơn (bắt được khoảng lặng nhỏ hơn/đậm hơn). */
  sensitivity: number;
}

const WIN_MS = 25; // cửa sổ đo năng lượng
const MIN_SEG_SEC = 0.8; // câu ngắn hơn thế thì gộp vào câu kề
const EDGE_PAD_SEC = 0.15; // giữ lại một chút lặng hai đầu câu

/**
 * Phát hiện câu bằng cách đo năng lượng (RMS) từng cửa sổ 25ms, tìm các
 * khoảng lặng đủ dài rồi cắt ở chính giữa khoảng lặng đó.
 * Ngưỡng lặng tính theo dB so với đỉnh to nhất của bản ghi — nên không
 * phụ thuộc âm lượng gốc của file.
 */
export function detectSegments(buffer: AudioBuffer, opts: SplitOptions): Segment[] {
  const duration = buffer.duration;
  if (duration <= 0) return [];

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.round((sr * WIN_MS) / 1000));
  const nWindows = Math.ceil(ch0.length / win);
  if (nWindows === 0) return [];

  // RMS từng cửa sổ
  const rms = new Float32Array(nWindows);
  let peak = 0;
  for (let i = 0; i < nWindows; i++) {
    const from = i * win;
    const to = Math.min(from + win, ch0.length);
    let sum = 0;
    let n = 0;
    for (let j = from; j < to; j++) {
      const v = ch1 ? (ch0[j] + ch1[j]) / 2 : ch0[j];
      sum += v * v;
      n++;
    }
    const r = n ? Math.sqrt(sum / n) : 0;
    rms[i] = r;
    if (r > peak) peak = r;
  }
  if (peak <= 0) return [{ start: 0, end: duration }];

  // sensitivity 1..10 → ngưỡng -15.3dB .. -45dB dưới đỉnh
  const thresholdDb = -(12 + opts.sensitivity * 3.3);
  const threshold = peak * Math.pow(10, thresholdDb / 20);

  const winSec = win / sr;
  const minSilenceWins = Math.max(1, Math.round(opts.minSilenceMs / WIN_MS));

  // Tìm điểm cắt: giữa mỗi khoảng lặng đủ dài
  const cuts: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= nWindows; i++) {
    const silent = i < nWindows && rms[i] < threshold;
    if (silent) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const runLen = i - runStart;
      if (runLen >= minSilenceWins) {
        const mid = runStart + runLen / 2;
        const t = mid * winSec;
        if (t > 0.2 && t < duration - 0.2) cuts.push(t);
      }
      runStart = -1;
    }
  }

  // Xác định phần có tiếng thực sự để trim lặng đầu/cuối file
  let firstLoud = 0;
  while (firstLoud < nWindows && rms[firstLoud] < threshold) firstLoud++;
  let lastLoud = nWindows - 1;
  while (lastLoud >= 0 && rms[lastLoud] < threshold) lastLoud--;

  const startTime = firstLoud >= nWindows ? 0 : Math.max(0, firstLoud * winSec - EDGE_PAD_SEC);
  const endTime = lastLoud < 0 ? duration : Math.min(duration, (lastLoud + 1) * winSec + EDGE_PAD_SEC);
  if (endTime - startTime < 0.5) return [{ start: startTime, end: endTime }];

  const bounds = [startTime, ...cuts.filter((c) => c > startTime && c < endTime), endTime];

  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push({ start: bounds[i], end: bounds[i + 1] });
  }

  // Gộp câu quá ngắn vào câu kề trước đó
  const merged: Segment[] = [];
  for (const seg of segments) {
    if (merged.length && seg.end - seg.start < MIN_SEG_SEC) {
      const prev = merged[merged.length - 1];
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}
