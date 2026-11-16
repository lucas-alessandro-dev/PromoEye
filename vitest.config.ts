import { defineConfig } from 'vitest/config'

// Rode pelos scripts (`npm test`): eles passam por scripts/vitest.mjs, que
// corrige o drive minúsculo do Windows. Veja o comentário lá.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5433/test',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-123456',
      PUBLIC_URL: 'https://promoeye.example',
    },
  },
})
