# Chép chính tả — Công cụ nghe & chép trên trình duyệt

Web app hỗ trợ nghe chép chính tả: up file audio, app tự chia câu theo khoảng lặng,
phát từng câu rồi tự dừng để bạn gõ — thay vì phải tua đi tua lại bằng phần mềm phát nhạc.

Mọi thứ chạy cục bộ trong trình duyệt: **audio không upload đi đâu**, tiến độ chép
(audio + nội dung + vị trí phát) được lưu tự động trong IndexedDB của máy.

## Chạy

```bash
pnpm install
pnpm dev        # mở http://localhost:5173
pnpm build      # bản production vào dist/ (pnpm preview để xem thử)
```

## Deploy

```bash
pnpm deploy   # build + đẩy lên Cloudflare (Workers static assets)
```

Đang chạy tại: https://tool-dictation.thangquyvanthao2000.workers.dev
(`wrangler.jsonc` trỏ assets vào `dist/`; lần đầu trên máy mới cần `wrangler login`.)

## Tính năng

- **Chia câu tự động**: phân tích năng lượng âm thanh (RMS từng cửa sổ 25ms), cắt câu
  ở giữa các khoảng lặng đủ dài. Chỉnh được "Lặng tối thiểu" và "Nhạy cảm" rồi chia lại.
- **Chế độ câu** *(tùy chọn, mặc định tắt)*: phát đúng một câu rồi tự dừng cuối câu.
- **Tự lùi khi phát** *(tùy chọn, mặc định tắt)*: bấm phát lại thì lùi ~1s để nghe lại từ cuối.
- Waveform bấm-tua, 5 nút điều hướng (câu trước/kế, lùi/tới 3s, nghe lại câu).
- Tốc độ 0.5×–2× giữ nguyên cao độ (giọng không bị "vẹo").
- Bộ soạn thảo: đếm từ/ký tự, chèn mốc thời gian `[phút:giây]`, xuất `.txt`,
  tự lưu khi gõ và khôi phục phiên khi mở lại trang.
- Sáng/tối theo theme hệ thống.

## Phím tắt

| Phím | Chức năng |
| --- | --- |
| `Space` | Phát / dừng (khi con trỏ không trong ô gõ; đang gõ thì Space là dấu cách) |
| `Esc` | Phát / dừng — mọi lúc, kể cả trong ô gõ |
| `Ctrl` bấm-nhả nhanh | Nghe lại câu hiện tại từ đầu |
| `Tab` / `Shift`+`Tab` | Nghe lại câu / câu trước |
| `Alt`+`←` / `Alt`+`→` | Câu trước / câu kế (chưa phát — bấm `Space` để nghe) |
| `Ctrl`+`Alt`+`←` / `→` | Lùi / tới 3 giây |
| `Ctrl`+`Enter` / `Ctrl`+`Shift`+`Enter` | Câu kế / câu trước (phạm dụng khi đang gõ) |
| `Ctrl`+`;` | Chèn mốc thời gian tại con trỏ |
| `Ctrl`+`+` / `-` / `0` | Tăng / giảm / reset tốc độ |
| `Ctrl`+`S` | Lưu bài chép ngay |

Chuột: bấm vào waveform hoặc dòng trong danh sách câu là nhảy về **đầu câu đó**
(bấm `Space` để phát). Bấm giữa câu đang phát vẫn phát tiếp tới hết câu rồi tự dừng.

## Mẹo dùng

- Chia câu không chuẩn? Tăng "Lặng tối thiểu" (ví dụ 600–800ms với giọng đọc chậm)
  hoặc giảm "Nhạy cảm" nếu tiếng ồn nền bị lẫn vào câu.
- Chép xong câu nào bấm `Space` nghe câu kế, lỡ bỏ sót thì `Ctrl` (bấm-nhả) nghe lại
  — tay không cần rời khỏi ô gõ.

## Công nghệ

Vite + TypeScript + [wavesurfer.js v7](https://wavesurfer.xyz) (waveform + region).
Không có backend. `vite.config.ts` loại wavesurfer.js khỏi dep prebundle của dev
server — bản prebundle làm hỏng đăng ký plugin trên WebKit.
