# Vela 全局 UI/UX 改造 —— 阶段 A 审计报告

> 对应《Vela 全局 UI/UX 改造任务书》第二节与第十一节「阶段 A」。>   
> **本阶段未修改任何 UI 代码**，只做只读扫描与量化统计。>   
> 审计时间：2026-10-13　审计对象：`C:\Users\86177\WorkBuddy AI\2026-10-11-23-01-13\vela-src`（`master @ 1f343c0`）

---

## 0. 审计方法与可复现性

所有结论来自可重跑的扫描，不依赖肉眼观察：

| 手段                                | 用途              |
| --------------------------------- | --------------- |
| 文件清单 + 行数统计                       | 页面/组件清单与规模      |
| CSS 变量集合差集对比                      | 5 个主题的变量完整性     |
| 引用点 grep（含排除条件）                   | 死代码、死状态、未使用依赖   |
| 正则统计                              | 硬编码颜色、原生控件、内联样式 |
| 与 `rule.md` / `rule.lite.md` 逐条核对 | 项目自身规范符合度       |

**先给结论**：现有代码的底子比任务书假设的**好得多**。真正需要修的是**少数具体缺陷 + 缺失的能力**，而不是「重建一套 UI 体系」。下面每一条都附数字。

---

## 1. 页面与组件清单

### 1.1 总量

| 层                                 |  文件 |     行数 |
| --------------------------------- | --: | -----: |
| `src/components`（全部）              | 104 | 26,505 |
| ├ `ui/`（通用组件）                     |  21 |  2,458 |
| ├ `panels/`（含 agent/、sidebar/）    |  26 |  6,925 |
| ├ `editor/`（编辑器实现）                |  17 |  6,736 |
| ├ `pages/`（含 books/、story-bible/） |  18 |  4,533 |
| ├ `settings/`                     |   7 |  2,711 |
| ├ `dialogs/`                      |   8 |  2,070 |
| ├ `layout/`（标题栏/状态栏/左右工具栏）        |   4 |    721 |
| └ `onboarding/` + `ErrorBoundary` |   3 |    351 |
| `src/stores`                      |  12 |  3,108 |
| `src/services`                    | 120 | 30,180 |
| `src/shared`                      |  15 |  2,749 |
| `electron`                        |  68 | 13,428 |

`.tsx` 组件共 **101 个**。

### 1.2 任务书 2.3 清单之外的**实际页面**（任务书要求「补齐实际清单」）

任务书列了 15 项，实际还有以下**未被列出但真实存在**的页面/视图：

| 区域                                 | 文件                                             |    行数 |
| ---------------------------------- | ---------------------------------------------- | ----: |
| 创作流水线                              | `pages/books/WritingPipelinePanel.tsx`         |   667 |
| 故事圣经·记忆检索                          | `pages/story-bible/MemorySearchSection.tsx`    |   229 |
| 故事圣经·事实（含物品流转台账）                   | `pages/story-bible/FactsSection.tsx`           |   380 |
| 故事圣经·境界 / 地点 / 剧情线 / 总览 / 人物 / 时间线 | `pages/story-bible/` 其余 6 个分区                  |   512 |
| 拆书·相似度检查                           | `pages/books/ReconstructChecksPanels.tsx`      |   481 |
| 拆书·剧情重构                            | `pages/books/PlotReconstructPanel.tsx`         |   353 |
| 三栏合并（修稿）                           | `editor/ThreeWayMerge.tsx`                     |   242 |
| 版本历史                               | `editor/VersionHistory.tsx`                    |   228 |
| 审稿报告                               | `editor/ReviewReport.tsx`                      | 1,078 |
| 关系图谱                               | `editor/RelationshipGraph.tsx`                 |   281 |
| Skill 流水线 / 调用 / 输入表单              | `editor/SkillPipelineDialog.tsx` 等 3 个         |   738 |
| 后处理状态面板                            | `ui/PostProcessStatusPanel.tsx`                |   217 |
| 引导：功能导览 / 安装向导                     | `onboarding/FeatureTour.tsx`、`SetupWizard.tsx` |   255 |
| 崩溃兜底                               | `components/ErrorBoundary.tsx`                 |     — |

**弹窗 8 个**：`ArchitectureConfirmDialog` / `ChapterCreationDialog` / `DirectoryConfigDialog` / `ExportDialog` / `GenerateConfigDialog` / `ImportNovelDialog` / `NewProjectDialog` / `StoryRehearsalDialog`。

### 1.3 视图枚举（全部来自真实类型定义，非推测）

- **左侧活动栏 → 侧栏视图（6）**：`home` / `project` / `knowledge` / `books` / `story-bible` / `characters`（`SidebarView`，`layout-store.ts:4`）
- **右侧面板视图（2）**：`agent`（AIPanel）/ `ai-output`（AIOutputPanel）（`RightView`）
- **底部工具窗口 Tab（3）**：`tasks` / `log` / `models`（`BottomTab`），可停靠 `sidebar` / `agent` / `full`（`BottomDock`）
- **编辑器 Tab 类型（11）**：`chapter` / `outline` / `character` / `config` / `diff` / `chapter-card` / `world-building` / `arch-file` / `version-history` / `review-report` / `style-guide`（`EditorTab.type`，`editor-store.ts:6`）

---

## 2. 现有功能与状态流

### 2.1 状态管理（12 个 Zustand store）

| Store              |  行数 | 持久化                                               | 职责                 |
| ------------------ | --: | ------------------------------------------------- | ------------------ |
| `agent-store`      | 741 | ✅ `vela-author-conversations-v1`（600ms 去抖 + 串行写盘） | Agent 对话、流式生成、工具调用 |
| `workflow-store`   | 508 | ❌                                                 | 工作流状态机（并发多任务）      |
| `llm-store`        | 347 | ❌                                                 | 模型池、用途绑定、流式通道      |
| `theme-store`      | 269 | ✅ `vela-theme`                                    | 主题、缩放、界面/写作字体      |
| `draft-store`      | 267 | ❌                                                 | 草稿列表与状态            |
| `project-store`    | 214 | ❌                                                 | 当前项目、文件树、最近项目      |
| `mcp-store`        | 190 | ❌                                                 | MCP 服务与工具          |
| `layout-store`     | 172 | ❌                                                 | **布局与全局弹窗开关**      |
| `editor-store`     | 135 | ❌                                                 | 编辑器 Tab            |
| `character-store`  | 134 | ❌                                                 | 角色卡                |
| `log-store`        |  64 | ❌                                                 | 应用日志（上限 1000 条）    |
| `onboarding-store` |  48 | ❌                                                 | 引导状态               |

**数据流**：`IPC（211 invoke + 6 event 通道）` → `services/`（仓储与命令）→ `stores/` → 组件。跨模块事件统一走 `shared/event-bus.ts`（`globalEventBus`），**已无 `window.dispatchEvent`**。

### 2.2 布局状态流（`layout-store` 是关键）

```
App.tsx
 └ TitleBar（40px，WebkitAppRegion: drag）
 └ flex row
    ├ LeftToolWindowBar（44px，全高）
    ├ PanelGroup[vertical]
    │   ├ Panel "top"
    │   │   └ PanelGroup[horizontal]
    │   │       ├ Panel "sidebar"(20%)  ─┐ 若 dockSide，内部再 vertical 切出 BottomPanel
    │   │       ├ Panel "editor"(60%)
    │   │       └ Panel "ai-panel"(20%)  ─┘ 若 dockAgent，内部再 vertical 切出 BottomPanel
    │   └ Panel "bottom"(28%)  ← 仅 dockFull 时渲染
    └ RightToolWindowBar（44px，全高）
 └ StatusBar（28px，全宽）
```

底部面板的「三态停靠」（侧栏下方 / Agent 下方 / 底部全宽）是**现有实现中设计得最好的一处**：`dockSide`/`dockAgent`/`dockFull` 三个派生布尔量保证了宿主列被收起时自动回退为全宽，不会出现面板消失。**阶段 C 应保留这个模型，不要重做。**

### 2.3 编辑器实现（重要修正）

- 实际编辑器是 **CodeMirror 6**（`@codemirror/*` + `@uiw/react-codemirror`），**项目里没有 Monaco**。
- `monaco-editor@^0.55.1` 与 `@monaco-editor/react@^4.7.0` **已安装但全库零引用**（`grep monaco src/ electron/` 无结果）。
- `EditorArea.tsx` 已对 14 个编辑器/页面做 `lazy()` 懒加载 + `Suspense`，**懒加载能力已具备**。
- CodeMirror 主题用 `EditorView.theme({...})` 内联定义，颜色全部走 `var(--color-*)` → **自动跟随主题切换，无需单独同步**（任务书 4.2 担心的「Monaco/CodeMirror 主题不同步」在 CodeMirror 侧不存在；Monaco 侧无代码可改）。

---

## 3. 现有主题与设计令牌

### 3.1 主题体系（5 个，全部真实可用）

`src/index.css` 的 `@layer base` 内：

| 主题        | 选择器       |  行号 | 变量数 |
| --------- | --------- | --: | --: |
| light（默认） | `:root`   | 149 | 104 |
| galaxy    | `.galaxy` | 297 |  77 |
| paper     | `.paper`  | 385 |  77 |
| dark      | `.dark`   | 473 |  77 |
| ocean     | `.ocean`  | 561 |  77 |

**变量完整性结论（实测差集）**：4 个非默认主题相对 `:root` 各「缺」27 个变量，逐个核对后**全部是主题无关量**（`--font-*` / `--height-*` / `--width-*` / `--radius-*` / `--transition-*` / `--z-*`），只在 `:root` 定义一次是正确的。  
→ **颜色变量在 5 个主题下 100% 齐备，无遗漏。** 这一项无需返工。

### 3.2 已存在的语义令牌（直接复用，不要另起一套）

```
--color-bg / --color-sidebar / --color-panel / --color-titlebar / --color-activity-bar
--color-hover / --color-active
--color-surface-raised / --color-surface-sunken / --color-surface-card
--color-text / --color-text-secondary / --color-text-muted
--color-border
--color-accent / --color-accent-hover / --color-accent-soft / --color-accent-glow / --color-on-accent
--color-success / --color-warning / --color-error / --color-info（各带 -rgb 与 -text 变体）
--color-violet / --color-mint / --color-amber / --color-rose / --color-cyan（各带 -rgb）
--color-tab-bg / --color-tab-active / --color-tab-border / --color-tab-indicator
--color-statusbar / --color-statusbar-text / --color-titlebar-text
--color-activity-icon / --color-activity-icon-active / --color-activity-indicator
--color-editor-bg / --color-editor-line-highlight / --color-editor-selection
--color-sash / --color-sash-hover / --color-focus-ring / --color-backdrop
--color-tooltip-bg / --color-tooltip-text / --color-skeleton / --color-badge-bg / --color-badge-text
```

**与任务书 3.1 建议命名的对照**：任务书建议 `--color-app-bg` / `--color-panel-bg` / `--color-panel-elevated` / `--color-text-primary` / `--color-focus-ring` / `--color-success|warning|danger`。现有体系已用 `--color-bg` / `--color-panel` / `--color-surface-raised` / `--color-text` / `--color-focus-ring` / `--color-error` 覆盖了同样语义。  
→ **建议沿用现有命名，不新增同义变量**（任务书自己也要求「尽量兼容现有体系，避免出现两套语义相同的变量」）。

### 3.3 ⚠️ 发现两套冲突的令牌定义

`src/tokens/index.ts`（326 行）+ `src/tokens/spacing.ts`（38 行）**是死代码**：全库 `grep "from '.*tokens"` 共 3 处命中 —— 2 处是 JSDoc 用法示例，剩下 1 处 `src/stories/Introduction.stories.mdx:2` 是**未被使用的导入**（该文件其余部分全是硬编码字面量，从未引用 `tokens` 变量）。

> ⚠️ **审计后核实修正**：初稿写的是「零引用」，漏了 Storybook 那一处。结论不变（仍是死代码），但**删除前必须先拆掉这个死导入**，否则 `build-storybook` 会失败。同时该 Introduction 页自身已过时（写「4 套主题」实际 5 套；色值是 `tokens/index.ts` 的旧值 `#F7F9FC`，真实生效的是 `index.css` 的 `#F5F5F5`）。

更严重的是它的值与 `index.css` **不一致**：

| 令牌        | `tokens/index.ts` | `index.css`（真实生效） |
| --------- | ----------------- | ----------------- |
| light 背景  | `#F7F9FC`         | `#F5F5F5`         |
| light 强调色 | `#5B9ED6`         | `#0078D4`         |
| 主题数量      | 4（无 `ocean`）      | 5                 |

→ **唯一真源必须明确为 `src/index.css`**。阶段 B 需决定：删除 `src/tokens/`，或将其改为从 CSS 变量生成的只读镜像。**在明确之前，任何实现都不得引用 `src/tokens/`。**

### 3.4 编辑器外观（任务书 4.2 的现状）

- 已有 `--color-editor-bg` / `--color-editor-line-highlight` / `--color-editor-selection`，**5 个主题全部定义**，且已被 19 处组件使用。
- **不存在**「编辑器外观」独立设置：`theme-store` 只有 `theme` / `zoom` / `writingFont` / `uiFont`，编辑器只能跟随工作台主题。
- **不存在专注模式**：全库无 `focusMode` / `专注模式` 相关代码。
- ⚠️ **死配置**：`GlobalConfig`（`src/shared/ipc-channels.ts:76-78`）声明了 `editorFontSize` / `editorFontFamily` / `autoSaveInterval`，`electron/utils/config-utils.ts:45` 给了默认值 `editorFontSize: 16`，但**渲染进程从未读取**，设置界面也没有对应项。
- ⚠️ **审计后核实修正（阶段 B 实施时发现）**：通道本身是齐的 —— `config:get` / `config:set` 已声明且已在 `electron/controllers/config-controller.ts` 注册，渲染进程可用 `ipc.invoke('config:get')` 直接调用。但 `src/` 下**没有任何 `getGlobalConfig` / `setGlobalConfig` 调用点，也没有持有 `GlobalConfig` 的 store**，所以"只需接线"实际要新增异步读取路径 + 新 store，工作量大于初判。更关键的是 **`editorFontFamily` 与既有 `theme-store.writingFont` 语义重复**（后者已通过 `--font-writing` 驱动正文字体并已持久化），再接一个就形成任务书第五节明令避免的"两套语义相同的变量"。→ 阶段 B 实际只激活了字号，且放进 `theme-store` 而非 `GlobalConfig`；这两个契约字段保持原样未动。

→ 阶段 B/D 的「编辑器纸稿模式 + 阅读设置」= **新增能力**，但有现成的 `--color-editor-*` 令牌与 `editorFontSize` 配置位可复用。

---

## 4. 重复样式、硬编码颜色、重复组件

### 4.1 硬编码颜色：**61 处**（组件层，已排除 `rgba(var(--color-x-rgb), a)` 这类合法令牌用法）

| 文件                               |  处数 | 主要色值                                                                 |
| -------------------------------- | --: | -------------------------------------------------------------------- |
| `src/styles/agent-tools.css`     |  16 | `#3b82f6` `#a855f7` `#22c55e` `#ef4444` `#f59e0b` `#16a34a` `#fff`   |
| `editor/RelationshipGraph.tsx`   |   8 | `#10b981` `#ef4444` `#3B82F6` `#8B5CF6` `#94a3b8`×2 `#0f172a`        |
| `ui/Switch.tsx`                  |   6 | `rgba(255,255,255,.18)` `rgba(0,0,0,.12/.24/.06)`                    |
| `ui/Toast.tsx`                   |   6 | `rgba(16,185,129,.12/.04)` `rgba(244,63,94,…)` `rgba(245,158,11,…)`  |
| `onboarding/FeatureTour.tsx`     |   4 | `rgba(0,0,0,.42)`×2 `rgba(126,200,227,.3)` `rgba(0,0,0,.35)`         |
| `panels/agent/AgentInputBox.tsx` |   4 | `rgba(0,0,0,.25)`×3 `rgba(128,128,128,.3)`                           |
| `dialogs/ImportNovelDialog.tsx`  |   3 | `rgba(220,38,38,.08)` `rgba(107,164,220,.06/.15)`                    |
| `editor/ChapterCardEditor.tsx`   |   3 | `rgba(34,197,94,.15)` `rgb(34,197,94)` `rgba(34,197,94,.04)`         |
| `pages/KnowledgeOverview.tsx`    |   3 | `rgba(245,158,11,.06)` `rgba(16,185,129,.12)` `rgba(59,130,246,.12)` |
| 其余 8 个文件                         | 各 1 | 见明细                                                                  |

**最值得先处理的一处**：`rgba(0,0,0,0.25)` 在 **5 个文件重复 7 次**（`AgentInputBox` ×3、`SlashCommandMenu`、`MentionMenu`、`AgentHeader`、`NovelConfigEditor` 各 1），语义统一是「浮层阴影」→ 应提为 `--shadow-*` 令牌。

**注**：`src/index.css` 自身有 335 处字面色值 —— 这是**令牌定义文件，属于正确用法**，不计入违规。

### 4.2 项目规范符合度（对照 `rule.md` / `rule.lite.md`）

| 规则                           | 实测                                            | 判定       |
| ---------------------------- | --------------------------------------------- | -------- |
| 禁用 `window.alert/confirm`    | 0 处真实调用（1 处命中在注释里）                            | ✅ 完全合规   |
| 禁用 `window.dispatchEvent`    | 0 处真实调用（5 处命中均为「已迁移」的说明注释）                    | ✅ 完全合规   |
| 相对路径导入（不用 `@/`）              | 0 处真实违规（11 处命中全在 JSDoc 示例里）                   | ✅ 完全合规   |
| 颜色用 CSS 变量                   | 61 处违规                                        | ❌ 见 4.1  |
| 按钮用 `<Button>` / `<IconBtn>` | 原生 `<button>` **134 处**，原生 `<input>` **35 处** | ⚠️ 一致性缺口 |

`rule.md:23` 写「TailwindCSS 3」，实际是 **Tailwind 4.2.2** —— 文档陈旧，需同步。

### 4.3 两套并行样式体系

- `className=`（Tailwind 工具类）：99 个组件文件使用
- `style={{ }}`（内联对象）：**1,136 处**

实际写法是**两者混用**，且内联 style 里大量写 `var(--color-*)`（如 `style={{ backgroundColor: 'var(--color-editor-bg)' }}`）。这是当前最主要的样式一致性来源问题，但**不建议在阶段 B 批量迁移** —— 1,136 处的机械替换回归风险远大于收益。建议**只在新代码与本次触及的组件上统一**。


### 4.4 重复组件 / 未使用组件

| 组件                          | 现状                                                                              | 结论                   |
| --------------------------- | ------------------------------------------------------------------------------- | -------------------- |
| `ui/Skeleton.tsx`           | **定义后零使用**（唯一命中是提示词模板里的无关文本）                                                    | 死组件；任务书要求的「加载骨架」实际缺失 |
| `ui/ActionToast.tsx`（292 行） | 仅 `App.tsx` 用 1 次                                                               | 投入产出严重失衡             |
| `ui/EmptyState.tsx`         | 16 处 / 13 个文件使用                                                                 | ✅ 采纳良好，保留            |
| `ui/Toast.tsx`              | 152 处调用                                                                         | ✅ 采纳极好，保留            |
| `ui/Confirm.tsx`            | 25 处调用                                                                          | ✅ 保留                 |
| `ui/AlertDialog.tsx`        | 1 处调用                                                                           | 基本被 Toast 取代         |
| `panel-header` CSS 类        | 仅 5 个文件用（`AgentHeader`/`AIOutputPanel`/`BottomPanel`/`Sidebar`/`ModelSettings`） | 其余面板各写各的头部           |
| 搜索框                         | **7 个文件手写**（含 `<Search>` 图标 + input）                                            | 有明确复用价值              |
| Storybook                   | 7 个 story + 1 篇 Introduction，覆盖 21 个 `ui/` 组件中的 7 个                             | 覆盖率 ~33%             |

---

## 5. 当前布局问题（逐条对应任务书 2.1 的检查项）

| 任务书检查项           | 实测结果                                                                                                                                                                                                                                    | 严重度   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 拖动分隔线时状态是否持久化    | **不持久化**。`App.tsx` 全部面板只用 `defaultSize`，`react-resizable-panels` 的 `autoSaveId` 零使用 → 重启后所有宽度回到默认                                                                                                                                       | 🔴 高  |
| 面板宽度状态如何管理       | `layout-store` 有 `sidebarWidth` / `aiPanelWidth` / `bottomPanelHeight` 三个字段 + 三个 setter，在 `src/` 下**没有任何调用方**（唯一引用是 `src/stores/__tests__/layout-store.test.ts` 的钳位用例）。真实宽度由 PanelGroup 内部持有，从未回写 store。⚠️ 审计后核实修正：初稿写「全部零引用」，漏了自身测试的引用 | 🔴 高  |
| 窗口缩小时布局如何处理      | 仅靠 `minSize`（10% / 15% / 8%）。**没有折叠策略**，窄窗口下三栏会被挤到极限                                                                                                                                                                                    | 🟠 中  |
| 隐藏/展开/切换边界问题     | 底部面板三态停靠有正确的回退保护（`dockSide`/`dockAgent`/`dockFull`）。但 `dockFull` 时上层 `defaultSize` 硬编码 72%                                                                                                                                              | 🟡 低  |
| 全局快捷键是否冲突        | **存在真实冲突**：`App.tsx:101-118` 全局拦截 `Cmd/Ctrl+N` 与 `Cmd/Ctrl+O`，**不判断事件焦点** → 在正文编辑器或任意输入框里按 `Cmd+N` 会弹出「新建项目」并 `preventDefault()`，吞掉浏览器/编辑器默认行为。`TitleBar.tsx:81-98` 的 `Cmd+=/-/0` 同理                                                    | 🔴 高  |
| 哪些组件负责业务、哪些负责布局  | 分层清晰：`layout/` 纯布局、`panels/` 容器 + 路由、`pages/` 业务页、`editor/` 编辑器实现、`ui/` 无业务                                                                                                                                                             | ✅ 无需改 |
| 当前主题是否覆盖所有组件     | 颜色变量 5 主题 100% 齐备；61 处硬编码颜色是仅有的漏点                                                                                                                                                                                                       | 🟡 低  |
| ErrorBoundary 覆盖 | **只有 3 处**（App.tsx 的 Sidebar / EditorArea / AIPanel）。BottomPanel、8 个弹窗、SettingsModal、RightToolWindowBar 均无兜底                                                                                                                            | 🟠 中  |

**三栏布局现状**：`侧栏 | 编辑区 | 右栏` 三栏已存在且可拖拽。但右栏只有 `agent` / `ai-output` 两个视图，任务书 5.2 要求的「当前章节相关资料面板、人物/设定/上下文入口」**尚不存在**，需要新增视图（不是新建第二套导航 —— 应扩 `RightView` 联合类型）。

---

## 6. 可复用组件清单

### 6.1 直接复用（不要重写）

`Button`（7 个 variant + 4 个 size）、`IconBtn`、`Input`、`Textarea`、`NativeSelect`、`Label`、`Switch`、`Badge`、`Tooltip`、`Dialog`、`AlertDialog`、`Confirm`、`Toast`、`ActionToast`、`EmptyState`、`ContextMenu`、`MenuItem`、`Icon`（lucide 封装）、`Skeleton`、`MarkdownContent`、`PostProcessStatusPanel`、`ErrorBoundary`

### 6.2 需要新增（有复用证据支撑）

| 组件              | 复用证据                                                            |
| --------------- | --------------------------------------------------------------- |
| `SearchField`   | 7 个文件手写搜索框                                                      |
| `PanelHeader`   | `panel-header` 类只覆盖 5 个文件，其余面板手写                                |
| `SectionHeader` | 故事圣经/知识库/拆书多个分区各自手写小标题                                          |
| `TabBar`        | 编辑器标签栏、拆书标签页、故事圣经分区切换、底部工具窗口四处各写一套                              |
| `LoadingState`  | `Skeleton` 未使用 → 加载态目前是 `animate-pulse` 文本（`EditorArea.tsx:38`） |
| `ErrorState`    | 仅有 `ErrorBoundary`（崩溃兜底），缺少「加载失败的可见错误态」                         |

**不建议新增**：任务书提到的 `Toast`/`ActionToast` 二选一合并、`Input`/`Textarea`/`Select` 重做 —— 现有实现已被大量调用，重做属于「为了统一而破坏调用方」。

---

## 7. 改动风险（按阶段 B–G 预判）

| 风险                      | 位置                                                                                                                            | 等级   | 规避                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------- |
| 主题标识改名导致用户设置丢失          | `theme-store.ts:140-171` 有 `'system'`→解析、`'night'`→`'dark'`、`'dark'`→`'galaxy'`（配合 `localStorage['vela-theme-migrated']`）三段迁移 | 🔴 高 | **禁止改名**；新能力只能加字段             |
| 全局样式波及全库                | `index.css` 1,471 行含 `@layer base` + 两个 `@layer components`                                                                   | 🔴 高 | 只**新增**变量/类，不改既有变量语义          |
| 面板嵌套结构改错 → 空白区/内容重叠     | `App.tsx:142-214` 的嵌套 PanelGroup + 三态 dock                                                                                    | 🟠 中 | 保留 dock 模型；改尺寸只加 `autoSaveId` |
| 批量替换 1,136 处内联 style    | 全组件层                                                                                                                          | 🟠 中 | 不做全量迁移，仅新代码与触及文件              |
| 未保存正文丢失                 | `EditorArea.tsx:205-260` 的 tab 关闭确认（`dirty` → `setCloseConfirm`）                                                              | 🔴 高 | 任何布局/编辑器改动后**必须回归这一条**        |
| 新增 `RightView` 值破坏穷尽性检查 | `RightView` 是联合类型，`App.tsx:187` 用三元判断                                                                                         | 🟡 低 | 改 `switch` + `never` 兜底       |
| 死代码误用                   | `src/tokens/` 与 `index.css` 值冲突                                                                                               | 🟠 中 | 阶段 B 先定唯一真源                   |

---

## 8. 推荐实施顺序（对任务书第十一节的细化）

任务书的 A–G 顺序**总体正确**，但基于实测数据建议做三处调整：

### 阶段 A（本报告）✅ 已完成

审计 + 清单 + 令牌基线 + 风险清单。

### 阶段 B：设计令牌与主题（建议**缩小**范围）

1. **先定唯一真源**：明确 `index.css` 为准，处理 `src/tokens/` 死代码（删除或改为镜像）。
2. **补 61 处硬编码颜色** → 优先 `rgba(0,0,0,0.25)` ×7（5 个文件）提取阴影令牌，再处理 `agent-tools.css` 16 处与 `RelationshipGraph` 8 处。
3. **新增编辑器外观设置**（跟随工作台 / 浅色纸稿 / 深色编辑器）：复用现成的 `--color-editor-*` 三件套，在 `theme-store` **新增字段**（不动既有字段），并激活已有的 `editorFontSize` 死配置。
   > 实施修正：`editorFontFamily` **未激活**（与 `writingFont` 语义重复，见 §3.4 修正）；字号也未放进 `GlobalConfig`，而是与其余外观项一起进 `theme-store`。另外 `--color-editor-bg` 被 16 处非编辑器页面共用，覆盖**只能挂在编辑画布容器上**，不能挂 `html` / `body`。以上均已在阶段 B 完成。
4. **不改** 5 个主题的标识与既有变量语义。
5. 顺带同步 `rule.md` 的 Tailwind 版本号。

### 阶段 C：主框架与布局（建议**提前**做，收益最高）

1. 修快捷键冲突：`Cmd+N/O` 与 `Cmd+=/-/0` 增加「焦点在可编辑元素时跳过」判断。
2. 面板尺寸持久化：⚠️ **审计后核实修正** —— `react-resizable-panels@4` **已移除 v3 的 `autoSaveId`**，改为 `useDefaultLayout({ id, panelIds })` hook（返回 `defaultLayout` 交给 `Group`、`onLayoutChanged` 负责回存，默认写 localStorage）。其中 `panelIds` 正是为「条件渲染的 Panel」设计的，与本案（侧栏 / 右栏 / 底部面板都可收起）完全吻合，应优先用它；回写 `layout-store` 死字段的方案要自行在像素与百分比之间换算，反而更绕。
3. 小窗口折叠策略：窄于阈值时自动收起侧栏/右栏。
4. 扩大 `ErrorBoundary` 覆盖到 BottomPanel / 弹窗 / 设置。
5. 保留 dock 三态模型不动。

### 阶段 D：编辑器

1. 接入**专注模式**（新增 `layout-store` 字段 + 进入前快照布局，退出时恢复 —— 必须做到「不改变文档内容、不清空编辑器状态」）。
2. 三栏编辑器信息栏整理（现有 `ProseEditorWrapper` 已含字数/dirty/保存，仅需统一视觉）。
3. 阅读设置（字体/字号/行高/纸面宽度/段落间距）接入阶段 B 新增的字段。
4. 回归 tab 关闭确认与 dirty 保护。

> **实施结果（见 `docs/UI-UX-PHASE-D.md`）**：第 1、3 条已完成。第 2 条经核查**现状已满足**（`ProseEditorWrapper` 的文件名/字数/dirty/保存 + `DraftEditor` 的工具栏齐全，且现状本就没有会挤压正文的统计卡片），故未改动。第 4 条属回归项，三条 dirty 路径经核查完好，改动未触碰 `editor-store`。
> 补充发现：`--font-writing` 已由既有 `theme-store.writingFont` 承担，阅读设置里的「字体」**不需要新增字段**，只新增了行高 / 纸面宽度 / 段落间距三项；四项默认值刻意等于改造前的硬编码值（16px / 1.8 / 800px / 0），保证升级后排版不静默变化。

### 阶段 E：业务页面（**按页面独立提交，可单独回退**）

顺序建议：欢迎页 → 项目概览 → 知识库 → 故事圣经 → 拆书 → 设置。  
每页只统一「标题 / 内容宽度 / 工具栏 / 筛选器 / 列表 / 详情 / 空状态」，**不动业务行为**。

> **实施结果（见 `docs/UI-UX-PHASE-E.md`）**：欢迎页、拆书、设置三页的可见项已收口；知识库、故事圣经两页的调色板类与内容宽度已收口。
> **口径澄清**：本报告沿用任务书的页面清单，但「项目概览」在本项目里**没有对应的独立页面组件** —— `SidebarView = 'project'` 的侧栏渲染 `ProjectTree`，主内容区则落回 Tab 工作区（`EditorArea.tsx` 只对 `home` / `characters` / `knowledge` / `books` / `story-bible` 做固定分派）。因此该视图不存在页面级标题 / 宽度 / 空状态可统一，其可见一致性问题归属阶段 C（侧栏）与阶段 F（`ProjectTree` 行样式）。
> 额外完成两项跨页统一：① 页头标题由三处硬编码 `text-[0.82rem] font-semibold`（13.12px）收敛到既有 `.section-title`（13px）—— 两者本是同一视觉规格的两套写法，属任务书第五节明令避免的重复；② 全库原生 `<select>` 清零（拆书 4 处改走 `NativeSelect`，另 2 处新发现的一并收口），现「除 `NativeSelect.tsx` 内部外无原生 select」可由 grep 直接验证。
> 本阶段**新发现并修复**的真实缺陷：`welcome-helpers.shortenPath` 对三段以内路径残留尾部斜杠；`src/utils/time.ts` 的俄语回退到中文日期格式。
> 顺带修正文档自身两处格式问题：`UI-UX-AUDIT.md` 有 6 处畸形硬换行（`文本<CR>␣␣<CRLF>`，游离 CR 会被当作换行符，把「同行内换行」渲染成「分段」）；`UI-UX-PHASE-C.md` 整个文件是 LF，违反仓库 CRLF 约定。
> 明确**未做**（连同原因写入阶段文档）：故事圣经 20 处密集行内 `<input>` 的 DRY 抽取（可见层面彼此已一致，抽取有排版位移风险）；`PageHeader` 组件化（三页页头容器虽同构，但右侧内容结构不同，且 `KnowledgeOverview` 的统计值位置与另两页不一致，需单独决策）。

### 阶段 F：组件一致性

新增 6 个组件（`SearchField` / `PanelHeader` / `SectionHeader` / `TabBar` / `LoadingState` / `ErrorState`），逐个替换手写实现，**每次替换后跑全量门禁**。同时决定 `Skeleton` / `ActionToast` / `AlertDialog` 的去留。

> **实施结果（见 `docs/UI-UX-PHASE-F.md`）**：**上述 6 个组件经逐项盘点后全部不成立，一个都没建。** 原因分两类 —— ① 真实调用点不足：`SearchField` 只有 2 处真搜索框（9 处 `<Search>` 里 7 处是按钮内图标）、`LoadingState` 0 处、`ErrorState` 0 处（34 处 `AlertTriangle` 全是行内小图标）；② 已有 CSS 类承担该职责：`PanelHeader` ↔ `.panel-header`（5 处使用）、`SectionHeader` ↔ `.section-title`；`TabBar` 则是 4 种形态各异、各仅 1 处的标签 UI，强行合并属过度抽象。
> **本报告此处的判断有误**：它把「看到类似写法」当成了「存在重复实现」，没有核实调用点。真正的重复在别处 —— `ui/Badge.tsx` 与 `.vela-badge` 的 6 个变体 CSS 早已齐备却**零引用**，而「小号胶囊标签」被手写复制了 **9 次**（字号分 0.6/0.65/0.7rem 三档，3 处用硬编码色或混用两套色系）。
> **实际完成**：采纳 `Badge` 替换全部 9 处手写实现；顺带修掉 3 个真实缺陷（`bg-green-500/15` 调色板类、`text-white` 硬编码、accent 底配 info 字的色系混用）；把 `PromptSettings` 的 `SOURCE_CONFIG` 从内联配色表重构为**变体映射**；补上缺失的 `info` 变体（全库已有 `--color-info`/`--color-info-text` 令牌，非新增重复语义）。
> **死组件裁决**：`ActionToast`（`App.tsx` 以 `actionToast()` 调用）与 `AlertDialog`（`project-store.ts` 调用 `alertError()`）**在用**，只是命令式 API；`Skeleton` / `Icon` / `Tooltip` 均零引用，**保留不动**（理由见阶段文档 §3：低层原语无对应场景、`Icon` 的尺寸体系与实际用法对不上、`Tooltip` 是新功能而非统一项）。

### 阶段 G：回归与交付

`npm run typecheck` + `npm run test` + `npm run lint` + `npm run build`，以及任务书 10.2 的手动回归清单。

> **实施结果（见 `docs/UI-UX-FINAL-REPORT.md`，按任务书第十三节 10 项要求组织）**：10.1 的 8 项自动化检查全部完成 —— `tsc` 0 error、`eslint --max-warnings 0` 0 problem、**84 文件 / 1048 用例全通过**（无跳过、无屏蔽、未删任何测试）；主题切换（`theme-store.test.ts`）、布局状态（`layout-store.test.ts`）、编辑器保存与切换（`editor-store.test.ts` 9 用例，且 `editor-store.ts` 全程未改动）三项均有测试覆盖。
> **构建**：`npm run build` 作为单条命令在 `vite:prepare-out-dir` 处失败 —— 环境的 `node-safe-delete-shim` 拦截了对 `dist/assets`（252 个文件 > 阈值 50）的清理，**不是项目缺陷**。改为分两步执行并全链路跑通：`npx vite build` 成功（产物 18:06）+ `npx electron-builder` 成功（**安装包 18:13**，Setup 236,214,989 B / Portable 235,589,563 B），并用各阶段特征串在 asar 中核验打包的是当前代码（`vela-badge--info`、`editor-paragraph-spacing`、`focusSnapshot`、`NativeSelect`、`data-editor-appearance` 均 FOUND）。
> **10.2 手动回归**：本环境为无头命令行，无法启动 Electron、无法截图，因此 17 项中必须在真实界面上完成的**全部未验证**，已按 10.3 逐项列明「待验证项 / 关联阶段 / 自动化已覆盖的部分」。**不得仅以代码编译成功代替界面验收。**
> 阶段 F 的范围调整与阶段 E 的未完成部分，均在此文档 §5 如实记录；已知问题 8 项归档于最终报告 §9.1。

---

## 9. 与任务书不一致、需要调整计划的地方

1. **Monaco 不存在**。任务书 2.3 / 4.2 假设有 Monaco 需要同步主题；实际只有 CodeMirror 6，且其主题已全量使用 CSS 变量、自动跟随主题。→ 4.2 中「重点检查 Monaco 和 CodeMirror 的主题同步」应改为「CodeMirror 主题已合规；另需决策 `monaco-editor` 依赖是否卸载（已安装、零引用）」。
2. **页面清单不完整**。任务书 2.3 列了 15 项，实际另有 14 项（见本报告 1.2）。
3. **令牌命名建议与现状冲突**。任务书 3.1 的 `--color-app-bg` 等建议名与现有 `--color-bg` / `--color-panel` / `--color-surface-raised` 同义。按任务书自己的「避免两套语义相同的变量」原则，**应沿用现有命名**。
4. **`src/tokens/` 是任务书没提到的坑**。它与 `index.css` 值冲突且零引用，必须在阶段 B 之前处理。
5. **`editorFontSize` 等已是死配置**。任务书 6.4 要求的阅读设置，一半的数据结构已经存在（IPC 契约 + 主进程默认值），只需接线，**不需要改 IPC 契约**（符合第十二节约束）。
   > 实施修正：通道齐备，但渲染进程**零调用点、无持有 `GlobalConfig` 的 store**，接线需新增异步 IPC 读取路径，并非"只需接线"；且 `editorFontFamily` 与 `writingFont` 重复，不应激活。详见 §3.4。
6. **Storybook 覆盖率低**。任务书 10.1 提到「受影响的组件测试」，但 21 个 `ui/` 组件只有 7 个有 story；且仓库**没有 jsdom / testing-library**，组件渲染测试不可行（只能测纯函数与 store，见既有测试约定）。→ 组件层验证需依赖 Storybook 手测 + 纯函数单测，**这一点必须如实记录为「无法自动化验证的部分」**。

---

## 10. 数据与业务保护确认

- 本阶段**零代码改动**：未修改任何 `.ts/.tsx/.css`，未动 SQLite / LanceDB / IPC 契约。
- 仓库状态：分支 `master`，HEAD `1f343c0`，工作区有 **72 项未提交改动**（来自前序「安全与清理 / 拆上帝文件 / 补测试护栏 / 性能与渲染」四个代码优化批次）。
- **未推送**。
- 既有质量基线（最近一次全量门禁）：`tsc --noEmit` 0 error；`eslint . --max-warnings 0` 全项目 0 problem；完整测试套件 **81 文件 / 1006 用例全通过**；性能套件 2 文件 / 6 用例通过；`vite build` 成功。    
  → 阶段 B 起每个阶段的验收基准即此。

---

## 附：下一步建议

按本报告第 8 节，**阶段 B（令牌收口）与阶段 C（布局与快捷键修复）风险最低、收益最高，且互不冲突，可并行推进**；阶段 D 的专注模式依赖阶段 C 的布局快照能力，应排在其后。

请确认：是否按「B + C 先行」开工，或需要调整优先级。
