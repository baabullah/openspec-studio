import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = `http://127.0.0.1:${process.env.PORT || 3940}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { allow: ['..'] },
    // WSL: inotify doesn't fire reliably on Windows drives (/mnt/c), so poll there
    watch: process.cwd().startsWith('/mnt/') ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': { target: API },
      '/ws': { target: API, ws: true },
    },
  },
});
