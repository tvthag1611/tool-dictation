import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import type { Segment } from './types';

export const SPEED_STEPS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export interface PlayerCallbacks {
  onTime: (t: number) => void;
  onPlayState: (playing: boolean) => void;
  onActiveSegment: (index: number) => void;
  onSentenceFinished: (index: number) => void;
}

/** Đọc biến màu từ theme hiện tại (để waveform khớp light/dark). */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** '#2563eb' + alpha → 'rgba(...)' cho màu region. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class DictationPlayer {
  private audio: HTMLAudioElement;
  private ws: WaveSurfer;
  private regions: RegionsPlugin;
  private regionBySeg: Region[] = [];
  private rafId = 0;
  /** Câu vừa tự dừng ở cuối (chế độ câu) — để Tab nghe lại đúng câu đó, Esc sang câu kế. */
  private justFinished: number | null = null;
  private inactiveColor: string;
  private activeColor: string;

  segments: Segment[] = [];
  activeIndex = -1;
  sentenceMode = true;
  autoRewind = true;
  rewindSecs = 1;

  private pendingSeek: number | null = null;
  private seekAttempts = 0;
  private resumeAfterSeek = false;
  private retrySeekOnReady = false;
  /** Câu hiện tại đã được nghe qua (điều kiện để tự dừng cuối câu). */
  private playedInSentence = false;

  constructor(container: HTMLElement, private cb: PlayerCallbacks) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;

    this.inactiveColor = hexToRgba(cssVar('--border'), 0.55);
    this.activeColor = hexToRgba(cssVar('--accent'), 0.22);

    this.regions = RegionsPlugin.create();
    this.ws = WaveSurfer.create({
      container,
      media: this.audio,
      height: 96,
      waveColor: cssVar('--border'),
      progressColor: cssVar('--accent'),
      cursorColor: cssVar('--muted'),
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      normalize: true,
      // đăng ký qua options để plugin init đồng bộ trong constructor (chuẩn v7)
      plugins: [this.regions],
    });

    this.audio.addEventListener('play', () => {
      this.cb.onPlayState(true);
      this.tick();
    });
    // dự phòng khi tab ở nền (rAF bị throttle): timeupdate vẫn chạy
    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.paused) return;
      const t = this.audio.currentTime;
      if (this.checkSentenceEnd(t)) return;
      this.updateActiveFromTime(t);
      this.cb.onTime(t);
    });
    // mp3 mới load có thể chưa seek được (seekable rỗng) — thử lại khi sẵn sàng
    this.audio.addEventListener('canplay', () => {
      if (!this.retrySeekOnReady || this.pendingSeek === null) return;
      this.retrySeekOnReady = false;
      this.audio.currentTime = this.pendingSeek;
    });
    this.audio.addEventListener('pause', () => {
      this.cb.onPlayState(false);
      this.stopTick();
      this.cb.onTime(this.audio.currentTime);
    });
    this.audio.addEventListener('ended', () => {
      this.cb.onPlayState(false);
      this.stopTick();
    });
    this.audio.addEventListener('seeked', () => this.onSeeked());
    // click waveform: wavesurfer đã seek tới điểm bấm — đè lên bằng đầu của
    // câu chứa điểm bấm để "click câu nào nghe câu đó" từ đầu
    this.ws.on('interaction', (time: number) => {
      if (this.segments.length < 2) return;
      const seg = this.segments[this.indexAt(time)];
      this.applySeek(seg.start, true);
    });
    this.ws.on('error', (err) => console.error('wavesurfer error:', err));

    // khối region chỉ dùng để PHỎNG VẼ highlight — cho click xuyên xuống waveform
    this.disableRegionPointerEvents();
  }

  /**
   * Xử lý sau khi seek hạ cánh. Mp3 (nhất là VBR) thường đáp lệch vị trí
   * yêu cầu — nếu hụt quá 0.35s thì seek lại (tối đa 2 lần), tránh hiện
   * tượng click câu này nhưng highlight nhảy câu kia.
   */
  private onSeeked(): void {
    const actual = this.audio.currentTime;
    if (this.pendingSeek !== null) {
      const short = this.pendingSeek - actual;
      if (short > 0.35 && this.seekAttempts < 2) {
        this.seekAttempts++;
        // lần 2 nhích nhẹ qua mục tiêu để bù "hụt đà"
        this.audio.currentTime = this.pendingSeek + (this.seekAttempts === 2 ? 0.15 : 0);
        return;
      }
      // câu active tính theo ĐÍCH seek, không theo điểm mp3 đáp về
      // (mp3 thường lệch vài ms khiến câu kế bị tính lại thành câu cũ)
      this.updateActiveFromTime(this.pendingSeek ?? actual);
      this.pendingSeek = null;
    } else {
      this.updateActiveFromTime(actual);
     }
    this.justFinished = null;
    this.cb.onTime(actual);
    if (this.resumeAfterSeek) {
      this.resumeAfterSeek = false;
      this.startPlayback();
    }
  }

  /**
   * Seek về vị trí chính xác. Nếu đang phát thì PAUSE NGAY (phản hồi tức thì,
   * tránh đoạn cũ tiếp tục reo trong lúc mp3 seek ì) rồi phát lại khi hạ cánh.
   */
  private applySeek(target: number, resumeIfPlaying: boolean): void {
    const dur = this.duration || 0;
    this.pendingSeek = Math.min(Math.max(target, 0), dur ? dur - 0.01 : target);
    this.seekAttempts = 0;
    this.justFinished = null;
    if (resumeIfPlaying && this.playing) {
      this.audio.pause();
      this.resumeAfterSeek = true;
    }
    try {
      this.audio.currentTime = this.pendingSeek;
    } catch {
      // mp3 chưa load xong (seekable rỗng) — chờ canplay rồi tự seek lại
      this.retrySeekOnReady = true;
    }
    this.playedInSentence = false; // seek sang chỗ mới — câu đó chưa được nghe
    this.updateActiveFromTime(this.pendingSeek);
    this.cb.onTime(this.pendingSeek);
  }

  private disableRegionPointerEvents(): void {
    const root = this.ws.getWrapper().getRootNode();
    if (!(root instanceof ShadowRoot) || root.querySelector('style[data-regions-off]')) return;
    const style = document.createElement('style');
    style.dataset.regionsOff = '';
    style.textContent = '[part^="region"]{pointer-events:none !important}';
    root.appendChild(style);
   }

  /**
   * Nạp audio vào wavesurfer. channelData lấy từ AudioBuffer đã decode sẵn
   * (tránh fetch + decode lần hai, và render waveform ngay lập tức).
   */
  async load(url: string, channelData?: Float32Array[]): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const offReady = this.ws.on('ready', () => {
      offReady();
      resolve();
    });
    const offErr = this.ws.on('error', (err) => {
      offErr();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    this.audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
    try {
      this.ws.load(url, channelData);
      await promise;
    } finally {
      offReady();
      offErr();
    }
  }

  get duration(): number {
    return this.ws.getDuration();
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  /** Vòng lặp vẽ khi đang phát: cập nhật giờ, theo dõi câu hiện tại, tự dừng cuối câu. */
  private tick = () => {
    if (this.audio.paused) return;
    const t = this.audio.currentTime;
    // kiểm tra hết câu TRƯỚC khi cập nhật activeIndex — không thì đã nhảy
    // sang câu kế và bỏ qua việc tự dừng ở cuối câu đang phát
    if (this.checkSentenceEnd(t)) return;
    this.updateActiveFromTime(t);
    this.cb.onTime(t);
    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Dừng ở cuối câu hiện tại nếu chế độ câu bật — nhưng CHỈ khi câu đó đã
   * được nghe qua ít nhất một chút. Bấm phát ngay tại cuối câu thì không
   * dừng ngầm: phát tiếp sang câu kế và dừng ở cuối câu đó.
   */
  private checkSentenceEnd(t: number): boolean {
    if (!this.sentenceMode || this.activeIndex < 0) return false;
    const seg = this.segments[this.activeIndex];
    if (t < seg.end) {
      this.playedInSentence = true;
      return false;
    }
    if (!this.playedInSentence) return false;
    this.justFinished = this.activeIndex;
    this.audio.pause();
    this.cb.onSentenceFinished(this.activeIndex);
    return true;
  }

  private stopTick(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** index của câu chứa t; nếu t vượt quá câu cuối thì trả về câu cuối. */
  private indexAt(t: number): number {
    for (let i = 0; i < this.segments.length; i++) {
      if (t < this.segments[i].end) return i;
    }
    return this.segments.length - 1;
  }

  private updateActiveFromTime(t: number): void {
    if (!this.segments.length) return;
    const i = this.indexAt(t);
    if (i !== this.activeIndex) {
      const prev = this.activeIndex;
      this.activeIndex = i;
      this.playedInSentence = false; // đổi câu khác — cần nghe lại mới được tính
      if (this.regionBySeg[prev]) this.regionBySeg[prev].setOptions({ color: this.inactiveColor });
      if (this.regionBySeg[i]) this.regionBySeg[i].setOptions({ color: this.activeColor });
      this.cb.onActiveSegment(i);
    }
  }

  play(): void {
    if (!this.segments.length) {
      void this.audio.play();
      return;
    }
    // khi seek mp3 còn treo, currentTime vẫn trả giá trị CŨ — dùng đích seek
    // để không tính nhầm vị trí (click câu A rồi Space phát nhầm câu B)
    const t = this.pendingSeek ?? this.audio.currentTime;
    let target = t;
    if (this.justFinished !== null) {
      // vừa chép xong câu → Esc/phát chuyển sang câu kế
      const next = this.segments[this.justFinished + 1];
      if (next) target = next.start;
      this.justFinished = null;
    } else if (this.autoRewind) {
      const seg = this.segments[this.indexAt(t)];
      if (t > seg.start + 0.05) {
        // nghe lại phần cuối trước khi tiếp tục
        target = Math.max(seg.start, t - this.rewindSecs);
      }
    }
    if (target !== t) {
      // seek chính xác + phát ngay khi hạ cánh (mp3 hay đáp lệch vị trí)
      this.applySeek(target, true);
      this.resumeAfterSeek = true;
    } else if (this.pendingSeek !== null) {
      // seek trước đó còn treo — WebKit từ chối play giữa chừng, chờ hạ cánh
      this.resumeAfterSeek = true;
    } else {
      this.startPlayback();
    }
  }

  pause(): void {
    this.resumeAfterSeek = false;
    this.audio.pause();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const dur = this.duration || 0;
    this.justFinished = null;
    this.audio.currentTime = Math.min(Math.max(t, 0), dur ? dur - 0.01 : t);
  }

  skip(delta: number): void {
    this.applySeek((this.pendingSeek ?? this.audio.currentTime) + delta, true);
  }

  /** Tab / Ctrl-tap: nghe lại câu hiện tại từ đầu (luôn phát sau khi hạ cánh). */
  replaySegment(): void {
    if (!this.segments.length) return;
    const i = this.justFinished ?? this.indexAt(this.pendingSeek ?? this.audio.currentTime);
    this.applySeek(this.segments[i].start, true);
    this.resumeAfterSeek = true;
  }

  /** play() kèm xử lý khi trình duyệt chặn autoplay — đồng bộ lại nút bấm. */
  private startPlayback(): void {
    this.playedInSentence = false; // buổi phát mới — chưa nghe gì trong câu hiện tại
    this.audio.play().catch(() => {
      // bị từ chối (đang seek giữa chừng / chặn autoplay) — nếu seek còn treo
      // thì tự phát lại khi hạ cánh, người dùng không phải bấm hai lần
      if (this.pendingSeek !== null) this.resumeAfterSeek = true;
      this.cb.onPlayState(false);
    });
  }

  goToSegment(i: number, autoplay = false): void {
    if (i < 0 || i >= this.segments.length) return;
    const wantPlay = autoplay || this.playing;
    this.applySeek(this.segments[i].start, wantPlay);
    if (wantPlay) this.resumeAfterSeek = true;
  }

  nextSegment(): void {
    this.goToSegment(this.activeIndex >= 0 ? this.activeIndex + 1 : 0);
  }

  prevSegment(): void {
    this.goToSegment(this.activeIndex - 1);
  }

  setSegments(segs: Segment[]): void {
    this.segments = segs;
    this.activeIndex = -1;
    this.justFinished = null;
    this.regions.clearRegions();
    this.regionBySeg = segs.map((seg) =>
      this.regions.addRegion({
        start: seg.start,
        end: Math.min(seg.end, this.duration || seg.end),
        color: this.inactiveColor,
        drag: false,
        resize: false,
      })
    );
    this.updateActiveFromTime(this.audio.currentTime);
  }

  setRate(rate: number): void {
    this.audio.playbackRate = rate;
    this.audio.preservesPitch = true;
  }

  setVolume(v: number): void {
    this.audio.volume = v;
  }
}
