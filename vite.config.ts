import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // wavesurfer.js v7 dùng shadow DOM + đăng ký plugin trong constructor;
    // bản esbuild prebundle làm việc đăng ký plugin thất bại trên WebKit.
    // Phục vụ ESM thô (như node_modules trực tiếp) thì hoạt động đúng.
    exclude: ['wavesurfer.js'],
  },
});