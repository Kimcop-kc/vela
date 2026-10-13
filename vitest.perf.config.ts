import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/services/narrative-consistency/__tests__/perf-regression.test.ts',
      'src/components/__tests__/markdown-render-cost.perf.ts',
    ],
    // 基准之间互相争抢 CPU 会让阈值失去意义（实测并行时单次渲染耗时翻数倍）。
    // 基准套件本来就只在 npm run test:perf 里单独跑，串行是划算的。
    fileParallelism: false,
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
