export interface ShortcutHandlers {
  togglePlay(): void;
  replaySegment(): void;
  nextSegment(): void;
  prevSegment(): void;
  skip(delta: number): void;
  insertTimestamp(): void;
  speedUp(): void;
  speedDown(): void;
  speedReset(): void;
  saveNow(): void;
}

/**
 * Phím tắt theo thói quen trình phát nhạc, dùng được ngay cả khi đang gõ:
 *
 *   Space      phát/dừng (khi con trỏ KHÔNG trong ô gõ — đang gõ thì Space là dấu cách)
 *   Esc        phát/dừng (mọi lúc, kể cả trong ô gõ)
 *   Ctrl/Cmd   bấm nhả nhanh (không kết hợp phím khác) = nghe lại câu từ đầu
 *   Tab        nghe lại câu từ đầu
 *   Alt+←/→    câu trước / câu kế (nhảy tới, chưa phát — bấm Space để phát)
 *   Ctrl+Enter / Ctrl+Shift+Enter  câu kế / câu trước
 *   Ctrl+Alt+←/→  lùi / tới 3 giây
 *   Ctrl+;     chèn mốc thời gian
 *   Ctrl +/-/0 tốc độ
 *   Ctrl+S     lưu ngay
 */
export function registerShortcuts(h: ShortcutHandlers): void {
  // theo dõi Ctrl/Cmd "tap" — chỉ tính khi bấm rồi nhả nhanh, không có phím nào kèm theo
  let modDownAt = 0;
  let modClean = false;

  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);

      // ── theo dõi tap Ctrl/Cmd ──
      if (e.key === 'Control' || e.key === 'Meta') {
        if (!e.repeat) {
          modDownAt = Date.now();
          modClean = true;
        }
        return; // không chặn modifier đơn thuột
      }
      if (mod) modClean = false; // có phím khác đi kèm → không còn là "tap"

      // ── Space phát/dừng khi không đang gõ ──
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        h.togglePlay();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        h.togglePlay();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) h.prevSegment();
        else h.replaySegment();
        return;
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (mod) {
          h.skip(e.key === 'ArrowLeft' ? -3 : 3);
        } else {
          if (e.key === 'ArrowLeft') h.prevSegment();
          else h.nextSegment();
        }
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) h.prevSegment();
        else h.nextSegment();
        return;
      }
      if (mod && (e.key === ';' || e.code === 'Semicolon')) {
        e.preventDefault();
        h.insertTimestamp();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        h.speedUp();
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        h.speedDown();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        h.speedReset();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        h.saveNow();
      }
    },
    { capture: true }
  );

  // nhả nhanh Ctrl/Cmd một mình → nghe lại câu
  window.addEventListener(
    'keyup',
    (e) => {
      if ((e.key === 'Control' || e.key === 'Meta') && modClean && Date.now() - modDownAt < 600) {
        modClean = false;
        h.replaySegment();
      }
    },
    { capture: true }
  );
}
