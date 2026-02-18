import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This MUST match your repository name on GitHub
  // If your repo is https://github.com/galioni/gym, the base is '/gym/'
  base: '', 
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 3000,
    open: true
  }
});