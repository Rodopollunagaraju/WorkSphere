import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const gateway = process.env.VITE_GATEWAY || 'http://localhost:3000';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': gateway, '/socket.io': { target: gateway, ws: true } } },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js', css: false },
});
