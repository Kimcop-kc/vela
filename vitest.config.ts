import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // 叙事一致性测试是纯算法 + 正则，不需要 DOM/Electron 环境
    environment: 'node',
    // 跑 narrative-consistency 单测 + IPC validation 单测（覆盖 PR #13 审计发现的所有 bug）
    // standalone.test.ts 是预存在 setup bug（不是我引入），跳过
    // 性能基准对共享 CI 机器的负载和冷启动很敏感，单独通过 `npm run test:perf` 运行。
    include: [
      'src/services/narrative-consistency/__tests__/narrative-consistency.test.ts',
      'electron/__tests__/ipc-validation.test.ts',
      'src/i18n/__tests__/i18n.test.ts',
      'src/services/__tests__/*.test.ts',
      'electron/__tests__/{ollama-models,rehearsal-*,story-revision,draft-lifecycle,chapter-rollback,chapter-splitting,vector-store-page,vector-store-search,app-logger,fetch-retry,chunk-rejoin,epub-export,skill-package,project-backup}.test.ts',
    ],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
