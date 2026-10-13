# Vela 全局 UI/UX 改造 —— 阶段 C 实施记录

> 对应《Vela 全局 UI/UX 改造任务书》第十一节「阶段 C：主框架与布局」，
> 以及阶段 A 审计报告（`docs/UI-UX-AUDIT.md`）第 5 节与第 8 节的推荐顺序。
> 实施时间：2026-10-13　对象：`vela-src`（分支 `master`，基线 `1f343c0`）

---

## 0. 本阶段做了什么

四件事，全部来自审计报告已记录的问题，没有顺手扩大范围：

| # | 问题（审计报告出处） | 处置 |
|---|---|---|
| 1 | 全局快捷键不判断焦点，在输入框 / 正文编辑器里会吞键并弹窗（5 节，🔴） | 新增共享判定 `src/shared/keyboard.ts`，两处处理器接入 |
| 2 | 面板尺寸不持久化，重启回到默认（5 节，🔴） | 接入 `react-resizable-panels@4` 的 `useDefaultLayout` |
| 3 | `ErrorBoundary` 只覆盖 3 处（5 节，🟠） | 扩到底部工具窗口 + 全部全局弹窗 |
| 4 | 窄窗口无折叠策略，三栏被 `minSize` 顶到极限（5 节，🟠） | 新增 `useAutoCollapseOnNarrowWindow` |

**明确未动**：`App.tsx` 的 dock 三态模型（审计报告 2.2 节判定为「现有实现中设计得最好的一处」）、5 个主题的标识与既有变量语义、IPC 契约、任何业务逻辑。

---

## 1. 全局快捷键焦点冲突

**问题**：`App.tsx` 的 `Cmd/Ctrl+N`（新建项目）、`Cmd/Ctrl+O`（打开项目）与 `TitleBar.tsx` 的 `Cmd/Ctrl+= / - / 0`（界面缩放）都挂在 `window` 上，只判断修饰键、不判断事件来源。焦点在正文编辑器（CodeMirror 的 `contenteditable` 容器）或任意输入框里时，这些按键会先被全局处理器 `preventDefault()` 并触发应用级动作 —— 写作途中按 `Cmd+N` 会直接弹出「新建项目」。

**做法**：新增 `src/shared/keyboard.ts`，导出唯一判定 `isEditableTarget(event)`：

- 覆盖 `input` / `textarea` / `select` 与 `[contenteditable="true"]`；
- `input` 中不承载文本输入的类型（`checkbox` / `radio` / `button` / `range` / `file` 等）**不**视为可编辑，快捷键在这些控件上仍应生效；
- 取 `composedPath()[0]` 而不是 `event.target` —— 焦点元素若位于 shadow root 内，`target` 会被重定向到宿主元素；
- 只依赖 `closest` / `tagName` / `getAttribute` 三个成员，不依赖 `instanceof`，因此可以在 node 环境下用替身对象做单测（仓库没有 jsdom）。

两处处理器各加一行 `if (isEditableTarget(e)) return`，位置在修饰键判断之后、动作之前。

**证据**：`src/shared/__tests__/keyboard.test.ts`，10 个用例（含 shadow root 穿透、`type` 大小写、缺 `composedPath` 的降级、`target` 为 `null`）。

---

## 2. 面板尺寸持久化

**问题**：`App.tsx` 的四个 `PanelGroup` 只用 `defaultSize`，从不保存；`layout-store` 里那三个 `sidebarWidth` / `aiPanelWidth` / `bottomPanelHeight`（像素语义，260/320/200）从没被读过，而 `PanelGroup` 用的是百分比，两者语义本就不一致。

**做法**：用 `react-resizable-panels@4` 的 `useDefaultLayout({ id, panelIds })`。

> ⚠️ 审计报告初稿建议的 `autoSaveId` **在 v4 已被移除**（v4 同时把 `PanelGroup`/`PanelResizeHandle` 改名成 `Group`/`Separator`）。已回填修正到审计报告第 8 节。

关键点是 `panelIds`：v4 的类型注释明确写着它是为「含条件渲染 Panel 的 Group」准备的，用于分别保存多套布局。本项目的侧栏、右栏、底部面板都是条件渲染的，正好需要它 —— 否则「收起侧栏后再展开」会把尺寸错配到别的栏上。

四个 Group 各配一个 hook，`panelIds` 按当前实际渲染的 Panel 计算：

| Group | id | panelIds |
|---|---|---|
| 外层纵向 | `vela-rows` | `['top']` / `['top','bottom']`（取决于 `dockFull`） |
| 主三栏横向 | `vela-columns` | `['editor']` + 条件插入 `sidebar` / `ai-panel` |
| 侧栏列纵向 | `vela-sidebar-column` | `['sidebar-main']` / `+ 'bottom-docked-sidebar'` |
| 右栏列纵向 | `vela-agent-column` | `['ai-main']` / `+ 'bottom-docked-agent'` |

`Panel` 的 `defaultSize` 保留 —— 首次启动（localStorage 无记录）时 `defaultLayout` 为 `undefined`，由它兜底。

**未做**：`layout-store` 的三个像素字段与 setter 保留原样（唯一引用是自身测试的钳位用例）。删除它们要连测试一起改，而清理死字段不属于本阶段目标；已在审计报告 5 节记为待办。

---

## 3. ErrorBoundary 覆盖

**问题**：只有 `App.tsx` 的 Sidebar / EditorArea / AIPanel 三处有兜底。底部工具窗口、8 个弹窗、`SettingsModal` 在渲染期抛错会卸载整棵 React 树（白屏），用户只能重启。

**做法**：给 `ErrorBoundary` 增加两个可选属性：

- `variant?: 'panel' | 'overlay'` —— `panel`（默认）保持 `height: 100%` 撑满父容器；`overlay` 改为 `position: fixed; inset: 0` 并取 `Z_INDEX.modal`。弹窗崩溃后它自己的遮罩会一并卸载，兜底层必须自己盖住窗口，否则错误信息会掉进主布局里、把三栏结构撑乱。
- `onReset?: () => void` —— 在「重试」旁多一个「关闭」。没有它，`overlay` 兜底层会盖住整个窗口、用户点不动任何东西。

接入范围：`BottomPanel` 的 3 处渲染点（`bottom-docked-sidebar` / `bottom-docked-agent` / `bottom`，用 `bottomPanelRenderError`）+ 5 个全局弹窗与 `SettingsModal`（用 `dialogRenderError`，`onReset` 统一为 `closeAllDialogs`）。文案补进 `en` / `zh-CN` / `ru` 三份 `common.json`。

**未做**：

- **左右工具栏（各 44px）不加兜底**。`variant="panel"` 的兜底层是 `height:100%`，放进 `flex row` 会按内容撑宽，把 44px 的图标列变成一块很宽的报错区、挤压编辑区；而它们的失败模式只是图标不显示，代价远大于收益。
- **另外 4 个弹窗**（`ArchitectureConfirmDialog` / `DirectoryConfigDialog` / `GenerateConfigDialog` / `StoryRehearsalDialog`）不在 `App.tsx` 渲染，需要在各自宿主处单独接入，留给后续。
- `FeatureTour` / `SetupWizard` 未包 —— 它们的显示由 `onboarding-store` 的步骤状态驱动，`onReset` 关不掉，包了反而会出现「兜底层无法退出」。

---

## 4. 窄窗口自动折叠

**问题**：三栏只靠 `minSize`（10% / 15% / 8%）约束，窗口变窄时会被挤到极限，中间编辑区几乎不可用。

**做法**：新增 `src/components/layout/useAutoCollapseOnNarrowWindow.ts`，阈值 1100px。两条约束都是为了不跟用户抢控制权：

1. **只在跨过阈值这一次跃迁上动作** —— 不会在阈值附近反复收起 / 展开；
2. **只还原被自动收起的面板** —— 用户在窄窗口下自己收起来的面板，窗口变宽后不会被强行打开。

为此 `layout-store` 新增 `autoCollapsed: { sidebar: boolean; aiPanel: boolean }` 与 `setAutoCollapsed(patch)`（按字段合并，清一个不会带上另一个），以及 `setSidebarOpen(open)` —— 自动折叠必须用显式赋值，用现成的 `toggleSidebar` 会在状态漂移时翻错方向。

挂载时也会按当前宽度对齐一次，窄窗口直接以折叠态启动。

**证据**：`src/stores/__tests__/layout-store.test.ts` 新增 2 个用例（`setSidebarOpen` 的幂等赋值语义、`setAutoCollapsed` 的字段合并语义）。

---

## 5. 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint`（`--max-warnings 0`） | 0 problem |
| `npm run test` | **82 文件 / 1018 用例全通过**（本阶段 +12：keyboard 10、layout-store 2） |
| `npx vite build` | 成功 |

基线（阶段 A 记录）为 81 文件 / 1006 用例，本阶段无删减、无跳过。

新建文件已按仓库约定统一为 CRLF。

---

## 6. ⚠️ 无法自动化验证的部分

仓库没有 jsdom / testing-library（`environment` 固定为 `node`），以下三项**只能手动验证**，本报告不声称它们已被验证：

1. **面板尺寸持久化**：拖动分隔线 → 重启应用 → 尺寸是否保持；以及「收起侧栏再展开」时尺寸是否错配到别的栏。
2. **窄窗口折叠**：把窗口从 >1100px 拖到 <1100px，侧栏与右栏是否收起；拖回后是否只还原被自动收起的那些；在窄窗口下手动收起某栏，拖宽后它是否保持收起。
3. **弹窗兜底层**：需要人为触发一次渲染期异常，确认 `overlay` 覆盖窗口、「关闭」按钮能把弹窗关掉。

快捷键一项有单测覆盖判定逻辑，但「编辑器里按 `Cmd+N` 不再弹窗」仍建议在真实窗口里过一遍。

---

## 7. 下一步

按审计报告第 8 节：

- **阶段 B（令牌收口与编辑器外观）** —— 61 处硬编码颜色（优先 `rgba(0,0,0,0.25)` ×7 提取阴影令牌）、`src/tokens/` 死代码处置（先拆 Storybook 死导入）、编辑器外观与阅读设置接线（激活 `editorFontSize` / `editorFontFamily` 死配置）、同步 `rule.md` 的 Tailwind 版本号。
- **阶段 D（编辑器）** —— 专注模式依赖本阶段已落地的布局能力，可排在其后。

另外两处本阶段发现、尚未处置的既有问题：

- `Dialog` 的遮罩与内容用 `z-50`（Tailwind），而 `src/shared/z-index.ts` 规定 modal 层应为 60。同页面同时出现下拉菜单（z-50）与弹窗时存在层级冲突风险。
- `src/stories/Introduction.stories.mdx` 内容过时（主题数量、色值均与 `index.css` 不符）。
