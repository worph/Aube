import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@aube/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['{shared,server}/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
})
