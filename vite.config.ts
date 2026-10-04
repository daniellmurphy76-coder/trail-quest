import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/trail-quest/',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        activities: fileURLToPath(new URL('./dev/activities.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    // Agent worktrees live inside the project; their edits must not reload the dev page.
    watch: { ignored: ['**/.claude/worktrees/**'] },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Pins the quality tier so results do not depend on the CPU of the machine running them.
    setupFiles: ['tests/setup-quality.ts'],
  },
});
