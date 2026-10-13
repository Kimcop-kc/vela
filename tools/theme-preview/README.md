# tools/theme-preview — 主题走查工具

无头环境起不了 Electron 时，用它对**真实的 `src/index.css` 与真实的 `src/components/ui` 组件**
做按主题的视觉核对。这是本仓库目前唯一能在命令行里完成的「界面级」验证手段。

## 为什么存在

任务书 §10.2 要求 17 项手动回归「不得仅以代码编译成功代替界面验收」，但 CI / 无头环境
无法启动 Electron 窗口。本工具把界面收敛成一个可截图的静态页，使「令牌 → 组件」的落地效果
可被反复核对，并把对比度这类问题变成可计算的数字。

2026-10-13 用它发现并修复了一个真实缺陷：`btn-primary` / `bg-[var(--color-accent)]`
上有 6 处写死 `text-white`，在 galaxy / dark / ocean 三套主题下对比度只有 2.0~2.2
（AA 要求 4.5）。改为 `text-[var(--color-on-accent)]` 后实测 8.31 / 8.70 / 8.51。

## 用法

```bash
# 1. 构建走查页（root 指向仓库根，保证 Tailwind 扫描范围与正式构建一致）
npx vite build --config tools/theme-preview/vite.config.ts

# 2. 二选一
node tools/theme-preview/shoot.mjs            # 5 套主题各截一张全页图 → tools/theme-preview/shots/*.png
node tools/theme-preview/verify-contrast.mjs  # 读出主操作按钮实际字色 + 该主题强调色，算 WCAG 对比度
```

也可以手工看：构建后任选一个静态服务器指向 `tools/theme-preview/`，访问
`/?theme=light|galaxy|paper|dark|ocean`。

## 注意事项

- `vite.config.ts` 的 `root` 故意指向仓库根目录（不是本目录），否则 Tailwind 只会扫描本目录，
  生成的工具类会缺一大半。
- 走查页只用内联样式，不写 Tailwind 工具类，避免「扫描不到导致样式丢失」的假阴性。
- `dist/` 是构建产物，已在 `.gitignore` 中忽略。
- 本工具只覆盖 `ui/` 基础组件。页面级布局、编辑器、IPC 交互仍需在真实客户端人工验收。
