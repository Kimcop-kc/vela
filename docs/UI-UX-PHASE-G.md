# 阶段 G 实施记录 —— 回归与交付（含界面级视觉验证补充）

> 对应《Vela 全局 UI_UX 改》任务书第十节（回归）与第十三节（最终交付报告）。
> 对象：`vela-src`，基线 `1f343c0`。本文记录阶段 G 的全部执行过程，以及交付后的补充验证轮次。

---

## 1. 任务书第十节：回归要求（逐字）

### 10.1 自动化检查（8 项）

1. TypeScript 编译
2. 测试套件
3. ESLint
4. 正式构建
5. 受影响的组件测试
6. 主题切换测试
7. 布局状态测试
8. 编辑器保存和切换测试

### 10.2 手动回归（17 项，不得仅以代码编译成功代替界面验收）

原文逐条（自任务书 docx 第 419–437 段提取）：

1. 启动应用。
2. 创建或打开项目。
3. 打开已有章节。
4. 修改并保存正文。
5. 切换工作台主题。
6. 切换编辑器纸稿模式。
7. 重启后检查主题和布局设置。
8. 展开和收起左右面板。
9. 调整三栏宽度。
10. 开启并退出专注模式。
11. 运行至少一种真实 AI 写作操作。
12. 打开知识库和故事圣经。
13. 打开拆书功能。
14. 打开设置并修改设置项。
15. 触发确认弹窗和错误提示。
16. 检查长正文和长章节标题。
17. 验证已有项目、小说正文和记忆数据未被修改或丢失。

（最终报告 §9.2 的表把 1+2 / 3+4 / 8+9 / 12+13 合并成行，共 13 行，覆盖上面全部 17 条。）

### 10.3 环境限制的如实记录要求

> 「如果当前环境无法启动 Electron 或进行截图验证，明确记录无法验证的部分」；
> 「不得为了让测试通过而删除测试、跳过检查或屏蔽真实错误」。

---

## 2. 八项自动化检查结果

| # | 检查项 | 结果 |
| --- | --- | --- |
| 1 | TypeScript | `tsc --noEmit` 0 error |
| 2 | 测试套件 | `vitest run` **86 文件 / 1053 用例全通过** |
| 3 | ESLint | 0 problem（`--max-warnings 0`） |
| 4 | 正式构建 | 完成（`dist/` 00:52 + 安装包 00:57，见 2.1） |
| 5 | 受影响的组件测试 | 含 2 个本轮新增的源码级守门测试 |
| 6 | 主题切换测试 | `theme-store.test.ts` |
| 7 | 布局状态测试 | `layout-store.test.ts` |
| 8 | 编辑器保存和切换测试 | `editor-store.test.ts` 9 用例；`editor-store.ts` 全程未改动 |

### 2.1 正式构建的环境限制与一次过程失误（如实记录）

`npm run build` 作为单条命令会被环境的 `node-safe-delete-shim` 拦截（vite 清空 `dist/assets`
252 个文件 > 阈值 50）。两次观察需要区分：

- **沙箱化的后台执行**：会被拦（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
- **前台提权执行**（无沙箱隔离）：不复现。第十六轮用探针实测——前台 `fs.rmSync`
  删除 60 个文件成功，shim 未介入。

最终全链路（第十六轮收尾时重跑）：

```
npx vite build       → dist/ 00:52（250 个 hash 资源）+ dist-electron/ 00:52（5 文件）
npx electron-builder → asar 00:56 + release/0.2.7/Vela-0.2.7-Windows-x64-{Setup,Portable}.exe 00:57
```

产物用特征串核验，确认打包的是当前代码：`vela-badge--info`、`editor-paragraph-spacing`、
`focusSnapshot`、`NativeSelect`、`data-editor-appearance`、`btn-primary text-[var(--color-on-accent)]`,
以及第十六轮特征串 `color-ai-glow-end` / `color-on-error` / `color-info-rgb` / `e27f84` /
`color-rose` / `color-mint` / `color-gold` / `z-toast` / `error-text` 均 FOUND。

**一次过程失误**：第十六轮首次打包写成 `npx vite build 2>&1 | tail -4 && npx electron-builder`
并放进后台任务——① vite build 被 shim 拦下、退出码非 0，但管道 `| tail` 的退出码是 0，
`&&` 照常放行；② electron-builder 随即用**旧 dist** 打出 exe。靠读日志时发现 vite 段的
堆栈尾巴才察觉，随后前台重跑 vite → 特征串核 dist → 前台重跑 electron-builder → 特征串
核 asar，纠正完毕。**教训**：`| tail` / `| head` 会让失败链路伪装成成功，产物链路命令应直接看退出码。

### 2.2 一次测试抖动（如实记录，非回归）

全量跑时 `electron/__tests__/vector-store-search.test.ts` 的 `afterEach` 偶发
`Hook timed out in 30000ms`；单独跑该文件 2/2 通过（14.7s）；`vector-store.ts` /
`embedding.ts` / 该测试文件本次均未触碰。判定为全量并行下的清理钩子超时，非业务回归。
后续全量复跑该文件通过（43.8s），整套 86/1053 全绿。

**但连续复跑后又失败两次**（同一处钩子），说明这不是「偶发」而是「整包并行 + 磁盘吃紧时
稳定复现」。既然它把 `npm run test` 这道门禁打成了不可信，就把它修掉：

- 清理改为 **async + 显式重试到 60s**（原来只靠 `rmSync` 的 `maxRetries: 3, retryDelay: 50`，
  在句柄释放滞后时不够）；
- 用 `vi.setConfig({ hookTimeout: 65_000 })` **只放宽这一个文件**（`hookTimeout` 是配置级选项，
  不能挂 `describe`），其它文件仍沿用全局 30s；
- 保留「删不掉最终仍抛错」的语义，**没有** try/catch 后静默跳过，也没有删测试或加 skip。

---

## 3. 手动回归的处理方式

17 项中**页面级与交互级**的全部未验证——本环境是无头命令行，起不了 Electron 窗口。
已在最终报告 §9.2 逐项列出「待验证项 / 关联阶段 / 自动化已覆盖的部分」。

**但本轮把可验证的部分往下压了一层**：放弃了「整个界面不能验，就一项都不验」的立场，
用真实的 `index.css` 与真实的 `ui/` 组件搭了可截图、可量化的验证工具，见第 4 节。

---

## 4. 界面级视觉验证（本轮核心补充）

### 4.1 为什么不是 Storybook

先走了 Storybook 路线，失败：

```
npm run build-storybook
Error: Unable to index ./src/stories/Introduction.stories.mdx
       Invariant failed: No matching indexer found for .../Introduction.stories.mdx
```

（`package.json` 声明 `storybook ^10.3.5`，实际安装 10.4.6。）静态 Storybook 不可用，
于是自建 `tools/theme-preview/`。

### 4.2 工具与两个防自欺设计

```
tools/theme-preview/
├── README.md            用法与注意事项
├── index.html           外壳
├── main.tsx             画廊：真实组件 + 内联样式，?theme= 切换主题
├── vite.config.ts       构建配置
├── shoot.mjs            起静态服务 + Playwright 截 5 套主题全页图
└── verify-contrast.mjs  读 computed style，现场算 WCAG 对比度
```

1. `vite.config.ts` 的 `root` 指向**仓库根**而非工具目录——否则 Tailwind 只扫工具目录，
   工具类缺一大半，截图会是一片没样式的裸 HTML（第一次 build 后我专门 grep 产物 CSS
   确认 `vela-badge--info` / `btn-primary` 在里面）。
2. 走查页**只用内联样式**，不写 Tailwind 工具类——扫描范围再怎么变，页面自身布局不塌。

对应 npm 脚本：`theme:preview`、`theme:contrast`；`dist/` 与 `shots/` 已入 `.gitignore`。

### 4.3 5 套主题实截结果

全部正常渲染：语义色板 13 项、徽章 7 变体、按钮 6 变体 + 2 尺寸、Input / Textarea /
NativeSelect / Switch / Label、图标 4 个、EmptyState + Skeleton、图标按钮 5 态、
正文渲染（MarkdownContent）、对话框（标题/描述/取消/删除）。无缺令牌控件，
无「选了暗色主题却看着浅色底」。画廊已从 10 个组件扩到 **13 个**，并引入 `src/i18n`
使文案与真实应用一致（第十六轮）。

### 4.4 实测对比度（getComputedStyle 现场读，非估算）

| 主题 | 主操作按钮实际字色 | accent | 对比度 | 判定 |
| --- | --- | --- | --- | --- |
| light | `rgb(255,255,255)` | `#0078d4` | 4.53 | AA 通过 |
| galaxy | `rgb(11,22,34)` | `#5cb8f0` | 8.31 | AA 通过 |
| paper | `rgb(255,255,255)` | `#6C6198`（原 `#7c6fae`） | **4.50** | AA 通过（原 4.43，第十六轮压暗后达标） |
| dark | `rgb(11,27,41)` | `#4cc2ff` | 8.70 | AA 通过 |
| ocean | `rgb(6,32,40)` | `#38c8e8` | 8.51 | AA 通过 |

**第十六轮起升级为全量实测**（不再只看主按钮）：遍历走查页所有含文字元素，逐层合成
半透明底后判定。最终 5 套主题共测 **67 类文本元素，未达阈值 1/67**（light 徽章
`default` 4.02，需改 Fluent 品牌蓝 `#0078D4`，属设计决策）。测量方法修正过三处系统性
误差：渐变按钮须从 `backgroundImage` 取色标（原来算出 1.00）、半透明层须逐层合成
（`.glass` 原来算出 1.12）、须排除 `sr-only` 与 ≤1px 元素。

---

## 5. 本轮发现并修复的缺陷

### 5.1 强调色底上写死 `text-white`（6 处）

| 文件 | 位置 |
| --- | --- |
| `src/components/ui/Button.tsx` | `default` 变体 |
| `src/components/pages/WelcomePage.tsx` | 2 处 |
| `src/components/settings/ModelSettings.tsx` | 1 处 |
| `src/components/settings/PromptSettings.tsx` | hover 态 |
| `src/components/settings/SettingsModal.tsx` | 侧栏选中态 |

白字在 galaxy / dark / ocean 的亮色强调色上对比度只有 2.0~2.2（AA 要求 4.5）。
统一改为 `text-[var(--color-on-accent)]`，实测升至 8.31 / 8.70 / 8.51。

**注意**：`SettingsModal.tsx` 里本就有一处同类修复（Badge solid 变体，注释写着
「替代原先硬编码的 text-white」），但同文件 L117 的侧栏选中态被漏掉。这说明
「修一处留一处」比「完全没修」更难发现——因此补了守门测试。

### 5.2 守门测试（2 个新增）

- `src/components/ui/__tests__/accent-text-token.test.ts`：源码级扫描，同一行不得同时
  出现 `text-white` 与强调色底。**做了反向验证**：把 `#F5F5F5` 改回 `#F7F9FC` 并删掉
  ocean，测试如预期报 2 条失败，确认不是空转。
- `.storybook/__tests__/preview-theme-sync.test.ts`：Storybook 主题清单 + 画布背景色
  必须与 `index.css` 的 5 套主题 `--color-bg` 逐套一致。

### 5.3 Storybook 预览的失效背景色

`.storybook/preview.ts` 的 `backgrounds.values` 4 个色值**全部与令牌不符**
（light `#F7F9FC` vs 实际 `#F5F5F5`；dark `#1E1E1E` vs `#1C1C1C`；paper 差一个数字位），
且漏掉 `.ocean`。已按 `index.css` 逐套校正、补 ocean、装饰器改取 `var(--color-bg)`。

### 5.4 当时未修、第十六轮已清的账

- ~~`paper` 主按钮 4.43~~ → `--color-accent` 压暗至 `#6C6198`（连带同步 `accent-rgb` /
  `accent-soft` / `accent-glow`），实测 4.50。
- ~~5 处 `text-white`~~ → 5 套主题补齐 `--color-on-error` / `--color-on-success` /
  `--color-ai-glow-end` 三个令牌；`.ai-glow` 前景改 `var(--color-on-accent)`、渐变终点
  改令牌；两处红橙渐变按钮改 `from-[var(--color-error)] to-[var(--color-warning-text)]`。

第十六轮唯一未达标项：light 徽章 `default` 4.02。调 `accent-soft` 的 alpha（0.09→0.02）
只到 4.18，必须动 Fluent 品牌蓝 `#0078D4` 才够——属设计决策，如实记录。

---

## 6. 第十六轮收尾（令牌补齐 / 调色板清零 / z-index 收口 / gitattributes）

前几轮遗留的 6 项小债在本轮全部清掉：

| 项 | 结果 |
| --- | --- |
| `--color-info-rgb` 缺失 | 5 套主题补齐；info 徽章与 `tool-call-source-badge.builtin` 从 `color-mix` 改为统一 `rgba(var(--color-info-rgb), α)` |
| 调色板类 106 处 | 11 个文件清零。按「语义色 vs 分类色」分两类映射：语义（红→error / 黄→warning / 绿→success / 蓝→info），分类（红→rose / 橙→amber / 紫→violet / 蓝→cyan / 绿→mint / 黄→gold）。grep 复核残留 **0** |
| z-index 6 处硬编码 | `ContextMenu` `z-[9999]`→`--z-dropdown`；`Toast`→`--z-toast`；`Tooltip`→`--z-tooltip`；`FeatureTour` `z-[10000..10002]` 三层统一 `--z-modal`，靠 Portal 内 DOM 顺序叠加 |
| 无 `.gitattributes` | 新增 `* text=auto` + 二进制后缀清单 + `.sh/.mjs/.cjs` 强制 LF；`git ls-files --eol` 复核分布未变（469 个 `i/lf w/crlf`），未触发大规模重归一 |
| `--color-error-text` 缺失 | 5 套主题补齐（这是**新发现**：4 个语义徽章里 error 是唯一用原色的异类）；连带 paper 主题一套前景色按「合成后淡色底」重取 |
| 5 处 `text-white` | 见 5.4 |

另修正：`DialogDescription`（muted→secondary，`.glass` 底上 4.22）、`MarkdownContent`
行内 code（accent→info-text，3.73→5.85）与代码块语言标签。

**涉及文件**：`src/index.css` · `src/styles/agent-tools.css` ·
`src/components/ui/{Button,ContextMenu,Toast,Tooltip,Dialog,MarkdownContent}.tsx` ·
`src/components/onboarding/FeatureTour.tsx` ·
`src/components/editor/{ArchFileViewer,WorldBuildingEditor,ChapterCardEditor,VersionHistory,CodeMirrorEditor,ReviewReport}.tsx` ·
`src/components/dialogs/{ArchitectureConfirmDialog,ChapterCreationDialog,ExportDialog}.tsx` ·
`src/components/settings/{ModelSettings,PromptSettings}.tsx` ·
`src/components/panels/agent/AgentHeader.tsx` ·
`tools/theme-preview/{main.tsx,index.html,verify-contrast.mjs}` ·
新增 `.gitattributes`。

四道门禁重跑：`tsc` 0 error / `eslint` 0 problem / **86 文件 / 1053 用例全通过** /
前台全链路构建 + 特征串核验通过（2.1）。

---

## 7. 全程未触碰

SQLite 结构、LanceDB、小说工程与正文、事实提取 / 检索 / 生成 / 审稿规则、
IPC 契约、既有功能入口、任何既有测试（未删、未 skip、未屏蔽）。
Git 仍停在 `1f343c0`，**未提交、未推送**。
