import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * 主题走查页构建配置。root 指向仓库根，是为了让 Tailwind 的源码扫描范围
 * 与正式构建完全一致（扫到 src/components），否则生成的工具类会缺一大半。
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [tailwindcss()],
  build: {
    outDir: 'tools/theme-preview/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { preview: fileURLToPath(new URL('./main.tsx', import.meta.url)) },
      output: { entryFileNames: 'preview.js', assetFileNames: 'preview.[ext]' },
    },
  },
})
