// Local visual test transport. No file bytes leave the browser.
let current: PreviewUpload | null = null;
export async function finishPreviewUpload() { await current?.finish(); }
export default class PreviewUpload {
  static uploadPartBytes() { throw new Error("No network uploads in this preview"); }
  handlers: Record<string, (...args: any[]) => void> = {};
  options: any;
  file: any;
  uploadInfo: any;
  constructor(..._args: unknown[]) { current = this; }
  use(_plugin: unknown, options: any) { this.options = options; return this; }
  on(event: string, handler: (...args: any[]) => void) { this.handlers[event] = handler; return this; }
  addFile(file: any) { this.file = file; return "preview-file"; }
  setFileState() {}
  async upload() {
    this.uploadInfo = await this.options.createMultipartUpload();
    this.handlers.progress?.(35);
    this.handlers["upload-progress"]?.(this.file, { bytesUploaded: this.file.data.size * .35, bytesTotal: this.file.data.size });
    return { successful: [], failed: [] };
  }
  async finish() {
    if (!this.uploadInfo) return;
    await this.options.completeMultipartUpload(this.file, { ...this.uploadInfo, parts: [] });
    this.handlers.progress?.(100);
    this.handlers["upload-success"]?.(this.file);
    this.uploadInfo = null;
  }
  retryAll() { return this.upload(); }
  cancelAll() { this.uploadInfo = null; }
  destroy() { if (current === this) current = null; }
}
