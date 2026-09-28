import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  test: {
    // Other Claude sessions keep git worktrees under .claude/worktrees;
    // without this, their copies of the tests run (and pass or fail) here
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
