export class DictationEditor {
  constructor(
    private ta: HTMLTextAreaElement,
    private counterEl: HTMLElement,
    private onChange: (text: string) => void
  ) {
    this.ta.addEventListener('input', () => {
      this.updateCounter();
      this.onChange(this.ta.value);
    });
  }

  setText(text: string): void {
    this.ta.value = text;
    this.updateCounter();
  }

  get text(): string {
    return this.ta.value;
  }

  updateCounter(): void {
    const text = this.ta.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    this.counterEl.textContent = `${words} từ · ${text.length} ký tự`;
  }

  /** Chèn text tại vị trí con trỏ, focus lại editor, bắn sự kiện change. */
  insertAtCursor(text: string): void {
    const start = this.ta.selectionStart ?? this.ta.value.length;
    const end = this.ta.selectionEnd ?? start;
    this.ta.setRangeText(text, start, end, 'end');
    this.ta.focus();
    this.updateCounter();
    this.onChange(this.ta.value);
  }

  exportTxt(baseName: string): void {
    const blob = new Blob([this.ta.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}-bai-chep.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
