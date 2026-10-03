import { defineConfig } from 'vite';

export default defineConfig({
  base: '/trail-quest/',
  build: {
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
