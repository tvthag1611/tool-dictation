import './styles.css';
import { DictationPlayer, SPEED_STEPS } from './player';
import { DictationEditor } from './editor';
import { registerShortcuts } from './shortcuts';
import { detectSegments } from './segments';
import { loadLatestSession, loadSettings, saveSession, saveSettings } from './storage';
import { formatTime, type Segment, type Session, type Settings } from './types';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/* ---------- Elements ---------- */
const uploadScreen = byId('uploadScreen');
const workScreen = byId('workScreen');
const dropZone = byId('dropZone');
const fileInput = byId<HTMLInputElement>('fileInput');
const fileBadge = byId('fileBadge');
const btnChangeAudio = byId<HTMLButtonElement>('btnChangeAudio');
const timeCur = byId('timeCur');
const timeTotal = byId('timeTotal');
const btnPlay = byId<HTMLButtonElement>('btnPlay');
const btnBack = byId<HTMLButtonElement>('btnBack');
const btnFwd = byId<HTMLButtonElement>('btnFwd');
const btnPrevSeg = byId<HTMLButtonElement>('btnPrevSeg');
const btnNextSeg = byId<HTMLButtonElement>('btnNextSeg');
const btnReplaySeg = byId<HTMLButtonElement>('btnReplaySeg');
const btnSpeedUp = byId<HTMLButtonElement>('btnSpeedUp');
const btnSpeedDown = byId<HTMLButtonElement>('btnSpeedDown');
const btnSpeedPill = byId<HTMLButtonElement>('btnSpeedPill');
const volume = byId<HTMLInputElement>('volume');
const ckSentenceMode = byId<HTMLInputElement>('ckSentenceMode');
const ckAutoRewind = byId<HTMLInputElement>('ckAutoRewind');
const rewindSecs = byId<HTMLInputElement>('rewindSecs');
const rewindSecsLabel = byId('rewindSecsLabel');
const segIndexEl = byId('segIndex');
const segHint = byId('segHint');
const segCount = byId('segCount');
const segList = byId('segList');
const minSilence = byId<HTMLInputElement>('minSilence');
const minSilenceVal = byId('minSilenceVal');
const sensitivity = byId<HTMLInputElement>('sensitivity');
const btnResplit = byId<HTMLButtonElement>('btnResplit');
const counter = byId('counter');
const btnTimestamp = byId<HTMLButtonElement>('btnTimestamp');
const btnExport = byId<HTMLButtonElement>('btnExport');
const editorTa = byId<HTMLTextAreaElement>('editor');
const toastEl = byId('toast');

/* ---------- State ---------- */
let settings: Settings = loadSettings();
let player: DictationPlayer | null = null;
let editor: DictationEditor;
let session: Session | null = null;
let audioBuffer: AudioBuffer | null = null;
let objectUrl: string | null = null;
let segItems: HTMLLIElement[] = [];
let saveTimer: number | undefined;
let splitTimer: number | undefined;
let toastTimer: number | undefined;

/* ---------- Toast ---------- */
function toast(msg: string, isError = false): void {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.hidden = false;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ---------- Persistence ---------- */
function saveNow(): void {
  if (!session) return;
  session.transcript = editor.text;
  session.currentTime = player ? player.currentTime : session.currentTime;
  session.savedAt = Date.now();
  void saveSession(session);
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 600);
}

/* ---------- Audio loading ---------- */
async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

async function loadFile(
  file: File,
  restore?: { transcript: string; segments: Segment[]; currentTime: number }
): Promise<void> {
  try {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|flac|webm|aac|mp4|opus)$/i.test(file.name)) {
      toast('File này không phải audio — hãy chọn mp3, wav, m4a, ogg…', true);
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    uploadScreen.hidden = true;
    workScreen.hidden = false;
    ensurePlayer();
    fileBadge.hidden = false;
    btnChangeAudio.hidden = false;

    const decoded = await decodeAudio(file);
    audioBuffer = decoded;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i)
    );
    await player!.load(objectUrl, channels);
    timeTotal.textContent = formatTime(player!.duration);

    const segments =
      restore?.segments?.length
        ? restore.segments
        : detectSegments(audioBuffer, {
            minSilenceMs: settings.minSilenceMs,
            sensitivity: settings.sensitivity,
          });

    player!.setSegments(segments);
    renderSegList(segments);
    editor.setText(restore?.transcript ?? '');
    if (restore && restore.currentTime > 0) player!.seek(restore.currentTime);

    session = {
      id: `${file.name}::${file.size}::${file.lastModified}`,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      blob: file,
      transcript: restore?.transcript ?? '',
      segments,
      currentTime: restore?.currentTime ?? 0,
      savedAt: Date.now(),
    };
    void saveSession(session);
    if (!restore) toast(`Đã chia ${segments.length} câu — Esc để nghe, gõ bài chép bên dưới`);
  } catch (err) {
    console.error(err);
    uploadScreen.hidden = false;
    workScreen.hidden = true;
    toast('Không đọc được file audio này. Thử định dạng khác (mp3, wav, m4a)…', true);
  }
}

function resplit(): void {
  if (!audioBuffer || !player) return;
  const segments = detectSegments(audioBuffer, {
    minSilenceMs: settings.minSilenceMs,
    sensitivity: settings.sensitivity,
  });
  player.setSegments(segments);
  renderSegList(segments);
  if (session) {
    session.segments = segments;
    void saveSession(session);
  }
  toast(`Đã chia lại thành ${segments.length} câu`);
}

/* ---------- Segment list UI ---------- */
function renderSegList(segments: Segment[]): void {
  segList.textContent = '';
  segItems = segments.map((seg, i) => {
    const li = document.createElement('li');
    li.className = 'seg-item';
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    const time = document.createElement('span');
    time.className = 'seg-time';
    time.textContent = `${formatTime(seg.start)}–${formatTime(seg.end)}`;
    const label = document.createElement('span');
    label.textContent = `Câu ${i + 1}`;
    const len = document.createElement('span');
    len.className = 'seg-len';
    len.textContent = `${(seg.end - seg.start).toFixed(1)}s`;
    li.append(time, label, len);
    li.addEventListener('click', () => player?.goToSegment(i));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        player?.goToSegment(i);
      }
    });
    segList.append(li);
    return li;
  });
  segCount.textContent = `(${segments.length})`;
  segIndexEl.textContent = segments.length ? 'Câu 1' : '';
  updateSegHint();
}

function highlightSegment(i: number): void {
  segItems.forEach((li, idx) => li.classList.toggle('active', idx === i));
  const active = segItems[i];
  // KHÔNG dùng scrollIntoView — nó cuộn cả trang chạy xuống theo câu active.
  // Chỉ cuộn chính khung danh sách, trang đứng yên.
  if (active) {
    const listRect = segList.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    if (itemRect.top < listRect.top) segList.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) segList.scrollTop += itemRect.bottom - listRect.bottom;
  }
  segIndexEl.textContent = player?.segments.length ? `Câu ${i + 1}/${player.segments.length}` : '';
}

function updateSegHint(): void {
  if (!player?.segments.length) {
    segHint.textContent = '';
    return;
  }
  segHint.textContent = settings.sentenceMode ? 'tự dừng cuối câu' : 'phát liên tục';
}

/* ---------- Speed ---------- */
function formatRate(r: number): string {
  return `${r.toFixed(2).replace(/\.?0+$/, '')}×`;
}

function nearestStepIndex(r: number): number {
  let best = 0;
  let bestDist = Infinity;
  SPEED_STEPS.forEach((s, i) => {
    const d = Math.abs(s - r);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function setSpeed(rate: number): void {
  const clamped = Math.min(2, Math.max(0.5, rate));
  settings.rate = clamped;
  player?.setRate(clamped);
  btnSpeedPill.textContent = formatRate(clamped);
  btnSpeedPill.classList.toggle('changed', clamped !== 1);
  saveSettings(settings);
}

/* ---------- Settings ↔ UI ---------- */
function applySettingsToUi(): void {
  ckSentenceMode.checked = settings.sentenceMode;
  ckAutoRewind.checked = settings.autoRewind;
  rewindSecs.value = String(settings.rewindSecs);
  rewindSecs.disabled = !settings.autoRewind;
  rewindSecsLabel.textContent = `${settings.rewindSecs.toFixed(1)}s`;
  minSilence.value = String(settings.minSilenceMs);
  minSilenceVal.textContent = `${settings.minSilenceMs}ms`;
  sensitivity.value = String(settings.sensitivity);
  volume.value = String(settings.volume);
  btnSpeedPill.textContent = formatRate(settings.rate);
  btnSpeedPill.classList.toggle('changed', settings.rate !== 1);
}

function applySettingsToPlayer(): void {
  if (!player) return;
  player.sentenceMode = settings.sentenceMode;
  player.autoRewind = settings.autoRewind;
  player.rewindSecs = settings.rewindSecs;
  player.setRate(settings.rate);
  player.setVolume(settings.volume);
}

/* ---------- Init ---------- */

/**
 * WaveSurfer phải được tạo khi #workScreen đã hiển thị — tạo sớm khi
 * container còn display:none (rộng 0) thì renderer sinh DOM rời,
 * waveform sẽ không bao giờ vẽ.
 */
function ensurePlayer(): void {
  if (player) return;
  player = new DictationPlayer(byId('waveform'), {
    onTime: (t) => {
      timeCur.textContent = formatTime(t);
    },
    onPlayState: (playing) => {
      btnPlay.classList.toggle('playing', playing);
      if (!playing) saveNow();
    },
    onActiveSegment: (i) => highlightSegment(i),
    onSentenceFinished: (i) => {
      segHint.textContent = `Câu ${i + 1} xong — Esc: câu kế · Tab: nghe lại`;
      saveNow();
    },
  });
  applySettingsToPlayer();
}

function init(): void {
  editor = new DictationEditor(editorTa, counter, () => scheduleSave());

  applySettingsToUi();
  updateSegHint();

  /* File picking */
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
    fileInput.value = '';
  });
  btnChangeAudio.addEventListener('click', () => fileInput.click());

  /* Transport */
  btnPlay.addEventListener('click', () => player?.toggle());
  btnBack.addEventListener('click', () => player?.skip(-3));
  btnFwd.addEventListener('click', () => player?.skip(3));
  btnPrevSeg.addEventListener('click', () => player?.prevSegment());
  btnNextSeg.addEventListener('click', () => player?.nextSegment());
  btnReplaySeg.addEventListener('click', () => player?.replaySegment());

  /* Speed */
  btnSpeedUp.addEventListener('click', () => setSpeed(SPEED_STEPS[nearestStepIndex(settings.rate) + 1] ?? 2));
  btnSpeedDown.addEventListener('click', () =>
    setSpeed(SPEED_STEPS[nearestStepIndex(settings.rate) - 1] ?? 0.5)
  );
  btnSpeedPill.addEventListener('click', () => setSpeed(1));

  /* Volume */
  volume.addEventListener('input', () => {
    settings.volume = Number(volume.value);
    player?.setVolume(settings.volume);
    saveSettings(settings);
  });

  /* Modes */
  ckSentenceMode.addEventListener('change', () => {
    settings.sentenceMode = ckSentenceMode.checked;
    if (player) player.sentenceMode = settings.sentenceMode;
    updateSegHint();
    saveSettings(settings);
  });
  ckAutoRewind.addEventListener('change', () => {
    settings.autoRewind = ckAutoRewind.checked;
    if (player) player.autoRewind = settings.autoRewind;
    rewindSecs.disabled = !settings.autoRewind;
    saveSettings(settings);
  });
  rewindSecs.addEventListener('input', () => {
    settings.rewindSecs = Number(rewindSecs.value);
    if (player) player.rewindSecs = settings.rewindSecs;
    rewindSecsLabel.textContent = `${settings.rewindSecs.toFixed(1)}s`;
    saveSettings(settings);
  });

  /* Re-split */
  const onSplitParams = () => {
    settings.minSilenceMs = Number(minSilence.value);
    settings.sensitivity = Number(sensitivity.value);
    minSilenceVal.textContent = `${settings.minSilenceMs}ms`;
    saveSettings(settings);
    clearTimeout(splitTimer);
    splitTimer = window.setTimeout(resplit, 400);
  };
  minSilence.addEventListener('input', onSplitParams);
  sensitivity.addEventListener('input', onSplitParams);
  btnResplit.addEventListener('click', resplit);

  /* Editor toolbar */
  btnTimestamp.addEventListener('click', () => {
    if (!player) return;
    editor.insertAtCursor(`[${formatTime(player.currentTime)}] `);
  });
  btnExport.addEventListener('click', () => {
    editor.exportTxt((session?.name ?? 'bai-chep').replace(/\.[^.]+$/, ''));
    toast('Đã tải bài chép về máy');
  });

  /* Shortcuts */
  registerShortcuts({
    togglePlay: () => player?.toggle(),
    replaySegment: () => player?.replaySegment(),
    nextSegment: () => player?.nextSegment(),
    prevSegment: () => player?.prevSegment(),
    skip: (d) => player?.skip(d),
    insertTimestamp: () => {
      if (!player) return;
      editor.insertAtCursor(`[${formatTime(player.currentTime)}] `);
    },
    speedUp: () => setSpeed(SPEED_STEPS[nearestStepIndex(settings.rate) + 1] ?? 2),
    speedDown: () => setSpeed(SPEED_STEPS[nearestStepIndex(settings.rate) - 1] ?? 0.5),
    speedReset: () => setSpeed(1),
    saveNow: () => {
      saveNow();
      toast('Đã lưu bài chép');
    },
  });

  /* Flush on exit */
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  /* Restore previous session */
  void (async () => {
    const prev = await loadLatestSession();
    if (!prev) return;
    const file =
      prev.blob instanceof File ? prev.blob : new File([prev.blob], prev.name, { type: prev.blob.type });
    await loadFile(file, {
      transcript: prev.transcript,
      segments: prev.segments,
      currentTime: prev.currentTime,
    });
    toast(`Đã khôi phục phiên trước: ${prev.name}`);
  })();
}

init();
