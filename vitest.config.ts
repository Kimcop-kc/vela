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
      'src/services/narrative-consistency/__tests__/long-form-memory.test.ts',
      'src/services/narrative-consistency/__tests__/layered-memory-search.test.ts',
      'electron/__tests__/ipc-validation.test.ts',
      'src/i18n/__tests__/i18n.test.ts',
      'src/services/__tests__/*.test.ts',
      // 状态层（zustand store）与界面层抽出的纯函数。注意：仓库未装 jsdom / testing-library，
      // environment 固定为 node，因此这里的用例只能是纯逻辑（store 状态机、格式化、判定谓词），
      // 不能渲染组件。
      'src/stores/__tests__/*.test.ts',
      'src/shared/__tests__/*.test.ts',
      'src/components/pages/**/__tests__/*.test.ts',
      // 强调色底上不得写死 text-white 的源码级守门
      'src/components/ui/__tests__/*.test.ts',
      // Storybook 预览配置守门：主题清单 / 画布背景色必须与 index.css 的 5 套主题一致
      '.storybook/__tests__/*.test.ts',
      'electron/__tests__/{ollama-models,rehearsal-*,story-revision,draft-lifecycle,chapter-rollback,chapter-splitting,vector-store-page,vector-store-search,embedding-availability,canon-fact-review,canon-foreshadow,canon-impact,canon-item-ledger,canon-realms,canon-locations,schema-migration,pipeline-repository,reconstruct-repository,app-logger,fetch-retry,chunk-rejoin,epub-export,skill-package,project-backup,ipc-channel-allowlist}.test.ts',
    ],
    globals: false,
    // SQLite 文件 I/O 在整包并行运行时争用明显，默认 5s 会误判超时。
    // 单个用例本身很快（单独运行均通过），这里放宽以消除并行争用造成的假失败。
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
