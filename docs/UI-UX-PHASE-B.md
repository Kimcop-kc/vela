# Vela 全局 UI/UX 改造 —— 阶段 B 实施记录（令牌收口 + 编辑器外观）

> 对应《Vela 全局 UI/UX 改造任务书》第十一节「阶段 B：设计令牌与主题」，
> 以及阶段 A 审计报告（`docs/UI-UX-AUDIT.md`）第 3、4、8 节。
> 实施时间：2026-10-13　对象：`vela-src`（分支 `master`，基线 `1f343c0`）

---

## 0. 本阶段做了什么

| # | 事项 | 结果 |
|---|---|---|
| 1 | 令牌唯一真源收口 | 删除 `src/tokens/`（364 行死代码），修复 Storybook 死导入与过时内容 |
| 2 | 硬编码颜色收口 | **61 处 → 15 处**，真实违规归零（剩余为合理保留） |
| 3 | 层级规范修正 | Dialog / SettingsModal 的 modal 层从 `z-50` 改为 `--z-modal`；遮罩色改用 `--color-backdrop` |
| 4 | 文档同步 | `rule.md` 技术栈表 5 处版本号 |
| 5 | 编辑器外观设置（任务书 6.4） | 新增「跟随工作台 / 浅色纸稿 / 深色编辑器」+ 正文字号，见第 6 节 |

**一处与原计划的偏差（如实说明）**：审计报告曾建议"顺带激活 `GlobalConfig.editorFontSize` / `editorFontFamily`"，实际核查后发现两件事，故**只激活了字号，未激活字体族** —— 详见第 7 节。

---

## 1. 令牌唯一真源收口

**问题**：`src/tokens/index.ts`（326 行）+ `src/tokens/spacing.ts`（38 行）是一份**自动提取的旧快照**，与真实生效的 `src/index.css` 全面脱节：

| 令牌 | `tokens/index.ts` | `index.css`（真实生效） |
|---|---|---|
| light 背景 | `#F7F9FC` | `#F5F5F5` |
| light 强调色 | `#5B9ED6` | `#0078D4` |
| radius md | `6px` | `8px` |
| radius lg | `10px` | `8px` |
| radius xl | `14px` | `12px` |
| radius 2xl | `20px` | **不存在**（实际有 `--radius-xs` / `--radius-pill`） |
| 主题数量 | 4 | 5（多 `ocean`） |

**处置**：

1. **先拆死导入**。`src/stories/Introduction.stories.mdx:2` 有一行 `import { tokens } from '../tokens'`，但整个文件从未使用它（下面全是硬编码字面量）。直接删目录会让 `build-storybook` 失败。
2. **重写该 Storybook 页**：删除死导入；主题表从 4 套补成 5 套；色值全部换成 `index.css` 的真实值；radius 表换成真实值；并在页首显著声明「**设计令牌的唯一真源是 `src/index.css`**，本页只做展示」。
3. **删除 `src/tokens/`**。删除前已确认全库无其它引用（`grep` 命中的其余 `tokens` 全是 LLM token 计数等无关内容）。git 可完整回退：`git checkout HEAD -- src/tokens`。

---

## 2. 硬编码颜色收口（61 → 15）

按审计报告的优先级执行：

### 2.1 浮层阴影（7 处，5 个文件）

`boxShadow: '0 8px 24px rgba(0,0,0,0.25)'` 在 `AgentInputBox`（×3）/ `SlashCommandMenu` / `AgentHeader` / `MentionMenu` 重复，`NovelConfigEditor` 另有 `0 4px 16px rgba(0,0,0,0.25)`。

→ 前者改 `var(--shadow-popover)`，后者改 `var(--shadow-tooltip)`。**收益**：`--shadow-*` 在 5 个主题下各有定义，深色主题下还会额外获得一层微妙描边，浮层不再在深色背景上"糊成一团"。

### 2.2 `src/styles/agent-tools.css`（16 处）

工具调用区块的配色全部硬编码（`#3b82f6` / `#a855f7` / `#22c55e` / `#ef4444` / `#f59e0b` / `#16a34a` / `#fff`）。

→ 按语义映射到既有令牌：来源徽章 `--color-info` / `--color-violet` / `--color-mint`；状态色 `--color-success` / `--color-error` / `--color-warning`；确认卡 `--color-warning`；通过按钮 `--color-success` + `--color-on-accent`（hover 用 `color-mix` 加深）。

半透明底一律用 `color-mix(in srgb, var(--color-x) N%, transparent)` —— 因为 `--color-info-rgb` 并不存在（只有部分颜色令牌带 `-rgb` 变体），而 `color-mix` 在项目里已有先例。

顺带把该文件里硬编码的 `font-family: 'JetBrains Mono', ...` 改为 `var(--font-mono)`。

### 2.3 其余零散处

| 文件 | 改动 |
|---|---|
| `ui/Toast.tsx` | success / error / warning 的渐变底改用 `rgba(var(--color-*-rgb), …)` —— 同文件的 `info` 分支**本来就是这么写的**，属明显遗漏 |
| `onboarding/FeatureTour.tsx` | 遮罩 `rgba(0,0,0,.42)` → `var(--color-backdrop)`；气泡阴影 → `var(--shadow-popover)`；光晕 → `rgba(var(--color-accent-rgb), .3)` |
| `pages/KnowledgeOverview.tsx` | 三处语义色底 → `-rgb` 变体 |
| `dialogs/ImportNovelDialog.tsx` | 错误底 / 提示底 → `-rgb` 变体（旁边已有 `var(--color-error)`） |
| `editor/ChapterCardEditor.tsx` | 绿色底与文字 → `--color-success`（同文件另两处**已是**令牌写法） |
| `editor/WorldBuildingEditor.tsx` | 失败态底 → `rgba(var(--color-error-rgb), .03)` |
| `panels/BottomPanel.tsx` | 错误底 → `rgba(var(--color-error-rgb), .08)` |
| `panels/agent/AgentInputBox.tsx` | 禁用态按钮底 → `color-mix(…var(--color-text-muted) 30%…)` |
| `settings/SettingsModal.tsx` | 全屏遮罩 → `var(--color-backdrop)` |
| `shared/draft-status.ts` | `revised` / `reviewed` 的 hex → `--color-accent` / `--color-violet`（该映射表其余项**本来就是** `var(--color-*)`） |

### 2.4 保留的 15 处（不是违规）

- **`RelationshipGraph.tsx` 的 7 个 hex**：canvas 画布拿不到 CSS 变量，代码用 `getComputedStyle` 读取、读不到才回退到硬编码值 —— 这是正确做法（另有 2 处是扫描正则的误报）。
- **`Switch.tsx` 的 6 个 `rgba`**：`rgba(255,255,255,.18)` 高光与 `rgba(0,0,0,.12/.24/.06)` 内阴影，表达的是**立体感而非主题配色**，故意不随主题变化。
- 另有 1 处 `var(--color-editor-selection, rgba(99,102,241,.2))` 是 CSS 变量 fallback。

→ 前两项已回填修正到审计报告 4.1 节（初稿把它们误判为违规）。

---

## 3. 层级规范修正

`src/shared/z-index.ts` 规定 `modal` 层为 60（`--z-modal`），但：

- `ui/Dialog.tsx` 的遮罩与内容用 `z-50`（= `dropdown` 层）
- `settings/SettingsModal.tsx` 的全屏遮罩同样用 `z-50`

→ 三处改为 `z-[var(--z-modal)]`。**影响**：同页面同时出现下拉菜单（`z-50`）与弹窗时，弹窗终于能正确盖住下拉菜单。

顺带把 `Dialog` 遮罩的 `bg-black/25` 改为 `bg-[var(--color-backdrop)]` —— 现在 Dialog / SettingsModal / FeatureTour 三处遮罩统一走同一令牌，深色主题下不再是一块死黑。

**保留**：`AgentHeader` / `AgentInputBox` / `SlashCommandMenu` / `MentionMenu` / `CodeMirrorEditor` / `SettingsModal` 下拉区的 `z-50` 是**正确的**（它们本就是 dropdown 层）。`FeatureTour` 的 `z-[10000]` 属引导层，超出 `z-index.ts` 现有层级，建议后续在规范里补一档（本阶段未动）。

---

## 4. 文档同步

`rule.md` 技术栈表 5 处版本号过时，已按 `package.json` 实际依赖修正：

| 行 | 原 | 现 |
|---|---|---|
| 框架 | Electron 30 + Vite 5 | Electron 41 + Vite 8 |
| 前端 | React 18 + TypeScript 5 | React 19 + TypeScript 6 |
| 样式 | TailwindCSS 3 | TailwindCSS 4 |

---

## 5. 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint`（`--max-warnings 0`） | 0 problem |
| `npm run test` | **83 文件 / 1026 用例全通过**（令牌收口后 82/1018，编辑器外观 +1 文件 / +8 用例） |
| `npx vite build` | 成功（含 `z-[var(--z-modal)]` / `bg-[var(--color-backdrop)]` 等任意值类） |

颜色扫描（脚本口径与审计一致，已排除 `rgba(var(--x-rgb), a)` 与 `var(--x, 字面量)` fallback）：**61 → 15**。

产物抽检：`data-editor-appearance=paper` / `=dark` 已进入 `dist/assets/index-*.css`，`#F8F3EA`（纸稿底色）在产物中命中 1 处，`editor-font-size` 分别命中 CodeMirrorEditor 与 EditorArea 两个 chunk。

---

## 6. 编辑器外观设置（任务书 6.4）

### 6.1 作用范围的关键约束

`--color-editor-bg` 在 `src/` 下被 **16 处非编辑器页面**引用（欢迎页、知识库、故事圣经、设置弹窗、`MarkdownContent`……）。因此外观覆盖**绝不能**挂在 `html` / `body` 上 —— 那会把欢迎页和知识库一起染成纸稿色。

**做法**：属性挂在 `EditorArea` 的「编辑区主体」容器（`EditorArea.tsx` 的 `flex-1 overflow-hidden` 那层），CSS 用 `[data-editor-appearance='paper'] { … }` 就地覆盖变量。自定义属性沿子树继承，覆盖自然只影响编辑画布。

**刻意不覆盖的两项**：
- **Tab 条留在容器之外**，保持工作台主题 —— 于是"深色编辑器"呈现为「工作台 chrome 照旧、编辑画布变暗」，而不是整列翻黑；
- **`--color-accent` 不覆盖**，光标、选区高亮与画布内按钮继续用工作台品牌色。

### 6.2 改动清单

| 文件 | 改动 |
|---|---|
| `stores/theme-store.ts` | 新增 `EditorAppearance` 类型、`editorAppearance` / `editorFontSize` 字段、两个 setter，并加入 `partialize`（持久化） |
| `index.css` | 新增两组预设规则（`paper` / `dark`），各覆盖 9 个变量：`--color-editor-bg` / `-line-highlight` / `-selection`、`--color-text` / `-secondary` / `-muted`、`--color-border` / `--color-hover` / `--color-active` |
| `panels/EditorArea.tsx` | 主体容器挂 `data-editor-appearance`，并注入 `--editor-font-size` |
| `editor/CodeMirrorEditor.tsx` | prose 模式字号由硬编码 `16px` 改为 `var(--editor-font-size, 16px)` |
| `settings/SettingsModal.tsx` | `EditorSection` 新增「编辑画布外观」三选一分段控件 + 「正文字号」滑杆（14–24px，实时读数） |
| 三语 `settings.json` | `appearance.*` 新增 7 个键 |

`follow` **刻意不写任何 CSS 规则**，直接沿用当前主题的值 —— 少一组规则就少一处可能与主题定义脱节的地方。

### 6.3 防御性处理

`setEditorFontSize` 会先 `Number.isFinite` 过滤再钳制到 `[14, 24]` 并取整。原因：该值会被拼进 CSS 变量（`NaNpx` 会让整条声明失效）**并写入 localStorage**，一旦污染就会持久化。这条行为有单测锁定。

新增 `src/stores/__tests__/theme-store.test.ts`（8 用例）：默认值、三种外观取值、上下限钳制、区间内原样接受、小数取整、非有限值被忽略、以及**持久化字段回归**（防止以后有人加字段却忘了改 `partialize`）。

> 测试环境是 `node`（无 DOM）。踩到一个坑：zustand v5 的 persist 默认存储是 `createJSONStorage(() => window.localStorage)`，读的是 **`window.localStorage`** 而非裸 `localStorage`；只替身后者会让 persist 静默退化成"storage 不可用"并刷告警。用例里两者都装了。

---

## 7. ⚠️ 未做与原因

### 7.1 `GlobalConfig.editorFontFamily` 未接线（有意为之）

审计报告原判断是"两个字段只需接线，不用改契约"。实际核查后：

1. **通道确实都在**：`config:get` / `config:set` 已在 `ipc-channels.ts` 声明、在 `electron/controllers/config-controller.ts` 注册，`DEFAULT_GLOBAL_CONFIG` 里也有 `editorFontSize: 16` / `editorFontFamily: 'Noto Serif SC'`。
2. **但渲染进程从未调用过**：`getGlobalConfig` / `setGlobalConfig` 在 `src/` 下零命中，也没有任何持有 `GlobalConfig` 的 store。所以"接线"实际要新增一条异步 IPC 读取路径 + 一个新 store，比原判断的工作量大。
3. **`editorFontFamily` 与既有 `theme-store.writingFont` 语义重复** —— 后者已经通过 `--font-writing` 驱动正文字体，并已持久化、已有设置界面。再接一个 `GlobalConfig.editorFontFamily` 就会形成任务书第五节明令避免的"**两套语义相同的变量**"，且两者会互相覆盖。

→ **只激活 `editorFontSize`**，且**不放进 `GlobalConfig`**，而是与 `theme/zoom/writingFont/uiFont` 一起放进 `theme-store`：编辑器外观设置区的所有项因此共用同一套持久化机制，不必为一个滑杆给 store 引入异步 IPC 依赖。

→ `GlobalConfig.editorFontSize` / `editorFontFamily` 两个字段**保持原样未动**（删除字段属于改 IPC 契约，任务书第十二节禁止）。建议后续单独提一个"契约清理"批次处理。

### 7.2 本阶段发现、未处置

- `FeatureTour` 的 `z-[10000]/[10001]/[10002]` 未纳入 `z-index.ts` 规范；
- `KnowledgeOverview.tsx:164` 等仍在用 Tailwind 调色板类（`border-amber-500/20`），这类**类名形式的硬编码色**不在本次扫描口径内，数量未统计；
- `novel-editor.css` 里的 `.vela-editor-content` / `.novel-editor-content` / `.arch-editor-content` 系列规则在 `src/` 下**无任何 tsx 引用**（正文编辑器实际是 `CodeMirrorEditor`，属 Tiptap 时期遗留）。因任务书第十二节禁止"以清理旧代码为由删除尚未完全理解的实现"，本阶段未动，仅记录。

---

## 8. 下一步

- **阶段 D（编辑器）**：专注模式（依赖阶段 C 已落地的布局能力）；阅读设置接入本阶段新增的 `editorFontSize`。
- **阶段 E（业务页面）**、**阶段 F（组件一致性）**、**阶段 G（回归与交付）** 按任务书顺序推进。

### 需手动验证（无法自动化）

1. 三种外观切换后，**欢迎页 / 知识库 / 设置弹窗的背景不受影响**（这是本次作用域设计的核心断言）；
2. 深色编辑器下光标、选区高亮仍清晰可见；
3. 正文字号滑杆调整后草稿与终稿同步生效，且**重启后保持**。
