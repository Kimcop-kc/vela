# 阶段 E · 业务页面逐页统一

> 对应任务书 §七（7.1–7.7）。审计方案见 `docs/UI-UX-AUDIT.md` §8「阶段 E」。
> 总纲：**逐页检查真实页面，统一标题 / 内容宽度 / 工具栏 / 筛选器 / 列表 / 详情 / 空状态 —— 不动业务行为。**
> 每页可独立回退（本阶段全程未提交、未推送）。

---

## 0. 本阶段做了什么

| 页面 | 改动 | 用户可见变化 |
| --- | --- | --- |
| 欢迎页 | 新增「继续创作」真实入口；最近项目显示真实相对时间；空状态改为可操作；页脚版本号改为构建期注入 | 是 |
| 拆书 | 4 处原生 `<select>` → `NativeSelect` | 轻微（下拉高度与同排输入框对齐、箭头统一） |
| 设置 | 模型空状态 → `EmptyState`；2 处 Tailwind 调色板类 → 语义令牌 | 是 |
| 知识库 | 10 处 Tailwind 调色板类 → 语义令牌；页头标题改走 `.section-title` | 是 |
| 故事圣经 | 内容宽度 960 → 880；页头标题改走 `.section-title`；1 处原生 `<select>` → `NativeSelect` | 是 |
| 项目概览 | —— | 见 §7.1：**本项目不存在该独立页面** |

跨页另做两件统一（§6）：页头标题写法收敛、全库原生 `<select>` 清零。

---

## 1. 欢迎页（`src/components/pages/WelcomePage.tsx`）

### 1.1 为什么要新增「继续创作」

改造前该页只有三个平级入口：新建项目 / 打开项目 / 导入小说。**已打开项目时**（用户从左侧栏点「主页」也会落到本页）没有任何回到当前工程的路径 —— 只能再点一次「打开项目」重走目录选择。

现在：`currentProject` 存在时主操作变为「继续创作」，点击执行 `setSidebarView('project')`（与侧栏「项目」入口同一动作），**不新建页面、不复制编辑器状态**；同时把「新建项目」降级为次级操作，避免与主操作抢注意力。

> 刻意**没有**做「最近编辑到第 N 章」「完成度 62%」这类展示：任务书 7.2 明确「不要添加没有真实来源的字数、完成百分比或创作天数」。本页只呈现主进程真实写入过的数据。

### 1.2 最近项目的真实时间

`recentProjects` 的元素是 `{ name, path, updatedAt }`，其中 `updatedAt` 由主进程 `project-controller.ts` 在打开 / 保存时写入 `new Date().toISOString()`，是**真实来源**。此前列表只显示名称与路径，时间信息被丢弃。

现在每条显示相对时间，且**解析失败时不显示**（而不是显示 `Invalid Date` 或编造的「刚刚」）—— 由 `parseUpdatedAt()` 返回 `null` 表达「不可用」。

### 1.3 空状态

改造前是手写的一段文字，没有任何可操作项。现在改用统一的 `EmptyState` 组件，并把「新建项目」「打开项目」两个按钮作为 children 传入。

### 1.4 页脚版本号

原文案硬编码 `Vela v0.1.0 · …`，而应用实际版本是 `0.2.7`。现改为 `` `Vela v${__APP_VERSION__} · ${t('welcome.footer')}` ``，取构建期注入值，不再需要人工同步。

### 1.5 抽出的纯函数与单测

新增 `src/components/pages/welcome-helpers.ts`（`shortenPath` / `parseUpdatedAt`）与 7 个单测。

拆出来的理由与既有 `story-bible/helpers.ts` 一致：仓库没有 jsdom，组件渲染不了，但这两个函数承载了真实边界（Windows 路径、主进程可能写入空值 / 畸形时间串），放在组件里就只能靠肉眼回归。该模块不依赖 i18n，可在 node 环境直接测。

**这组测试当场抓到一个真实缺陷** —— 见 §8.1。

---

## 2. 拆书（`src/components/pages/books/`）

### 2.1 真实的不一致是「高度」，不是「颜色」

4 处下拉（`ReconstructChecksPanels.tsx` 2 处、`WritingPipelinePanel.tsx` 2 处）此前是原生 `<select>` + 一份复制粘贴的内联 `style`（`background: var(--color-bg-elevated)` 等）。它们与**紧挨着的** `Input` 之间真正肉眼可见的差异是：

- 高度：`Input` 是 `h-7`（28px），原生 select 靠 `py-1 + text-[0.7rem]` 撑出约 25px → 同一行里高低不齐；
- 下拉箭头：原生 select 用系统箭头，全库其它下拉用 `.vela-field` 注入的统一 SVG 箭头；
- 聚焦环：原生 select 无统一聚焦环。

改走 `NativeSelect` 后三点一并解决，且删除了两个文件的 `selectStyle` 常量（`WritingPipelinePanel.tsx` 的还是模块级的）。

### 2.2 为什么必须补 `w-auto`

`NativeSelect` 的基础类是 `w-full`，那是为**表单里独占一行**的场景准备的。放进 `flex flex-wrap` 的工具条后 `w-full` 会解析成容器全宽，把整行撑爆。因此每处都显式传 `className="w-auto"` 回到「按内容宽度」。

> `cn()` 是 `clsx` + `tailwind-merge`，后写的 `w-auto` 会正确覆盖组件内的 `w-full`。

---

## 3. 设置（`src/components/settings/SettingsModal.tsx`）

1. 模型列表的空状态由手写 dashed 边框块改为 `EmptyState`（`icon` + `message` + children 里的「添加第一个模型」按钮），与全库空状态统一。
2. 删除按钮的 hover 由 `hover:bg-red-500/10 hover:text-red-400` 改为 `hover:bg-[rgba(var(--color-error-rgb),0.1)] hover:text-[var(--color-error)]`。
3. 连接测试结果块由 Tailwind 类名模板改为内联 style 的 success / error rgb。

---

## 4. 知识库（`src/components/pages/KnowledgeOverview.tsx`）

### 4.1 调色板类收口（10 处）

`border-amber-500/20`、`bg-emerald-500/15`、`bg-blue-500/15`、`bg-green-500/20`、`bg-yellow-500/20`、`from-amber-500 to-amber-300` 等 **Tailwind 调色板类**是「类名形式的硬编码颜色」—— 它们不随主题切换，在深色主题下会与语义色撞色。全部换成语义令牌：

| 原写法 | 现写法 |
| --- | --- |
| `border-amber-500/20` | `style={{ border: '1px solid rgba(var(--color-warning-rgb), 0.25)' }}` |
| `bg-amber-500/15` | `rgba(var(--color-warning-rgb), 0.15)` |
| `text-amber-400` | `text-[var(--color-warning)]` |
| `bg-emerald-500/15 text-…` | `rgba(var(--color-success-rgb), 0.15)` + `var(--color-success-text)` |
| `bg-blue-500/15` | `color-mix(in srgb, var(--color-info) 15%, transparent)` |
| `from-amber-500 to-amber-300` | `from-[var(--color-warning)] to-[var(--color-amber)]` |

> `bg-blue-500/15` 一处**没有**用 `rgba(var(--color-info-rgb), …)`，因为全库 5 套主题都没有定义 `--color-info-rgb`（只有 `--color-info`）。改用 `color-mix()`，项目内已有先例。若要统一成 `-rgb` 形式，需先给 5 套主题补 `--color-info-rgb`，属阶段 B 的令牌收口范围，本阶段不动。
>
> 替换前已逐一核对：所用到的 `--color-warning-rgb` / `--color-success-rgb` / `--color-amber` / `--color-warning-text` / `--color-success-text` / `--color-info-text` 在 5 套主题中**全部存在**。

---

## 5. 故事圣经（`src/components/pages/story-bible/`）

1. **内容宽度**：`StoryBibleOverview.tsx` 的 `max-w-[960px]` → `max-w-[880px]`。同属一套页头下的「项目概览 / 知识库」都是 880px，只有它宽 80px，导致页头标题与内容左边缘对不齐。
2. **页头标题**：改走 `.section-title`（见 §6.1）。
3. **物品流转台账的下拉**（`FactsSection.tsx`）：原生 `<select>` → `NativeSelect`。这一行的输入框是刻意紧凑的密集编辑区，因此用 `className="w-auto h-6"` 把它压回与同排输入框齐平（组件默认 `h-7`）。

---

## 6. 跨页统一

### 6.1 页头标题写法收敛

三个业务页（拆书 / 知识库 / 故事圣经）的页头标题此前各自硬编码：

```tsx
<span className="text-[0.82rem] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
```

而 `src/index.css` 里**早已存在** `.section-title`（`font-size: 13px` / `font-weight: 600` / `letter-spacing: 0.01em` / `color: var(--color-text)`）—— 与 `0.82rem`（13.12px）是**同一个视觉规格的两套写法**，正是任务书第五节要求避免的「两套语义相同的变量」。

现三处统一为 `className="section-title truncate"`：字号差 0.12px（不可见），同时消掉三份重复，并额外获得 `letter-spacing` 与 `text-wrap: balance`。类里已含颜色，冗余的内联 `style` 一并删除。

> 仍**未**处理的语义问题：这些标题是 `<span>` 而非 `<h1>/<h2>`，三页的容器也一个是 `<div>`、一个是 `<header>`。这属于「用组件承载语义」的范畴，归 §11 的 `PageHeader` 决策，本阶段不引入新组件。

### 6.2 原生 `<select>` 清零

本阶段开始时审计只记录「4 处原生 `<select>` 未走 `NativeSelect`」。实际盘点后共 6 处，另 2 处（`story-bible/FactsSection.tsx`、`panels/BottomPanel.tsx` 的日志级别选择器）一并收口。

现在有一条**可由 grep 直接验证**的不变量：

```
grep -rn "<select" src --include=*.tsx | grep -v NativeSelect.tsx   # 无输出
```

---

## 7. 核查后未改动

### 7.1 「项目概览」没有对应的独立页面

任务书与审计的页面清单都写了「项目概览」，但本项目里**不存在这个页面组件**：

- `SidebarView = 'home' | 'project' | 'knowledge' | 'books' | 'story-bible' | 'characters' | 'settings'`；
- `Sidebar.tsx` 对 `'project'` 渲染 `ProjectTree`（侧栏树）；
- `EditorArea.tsx` 只对 `home` / `characters` / `knowledge` / `books` / `story-bible` 做**固定分派**，`'project'` 落回 Tab 工作区。

因此该视图没有页面级标题 / 内容宽度 / 空状态可统一；它的一致性问题分别在阶段 C（侧栏）与阶段 F（`ProjectTree` 行样式）。已在审计 §8 阶段 E 回填这条口径澄清。

### 7.2 其余核查项

- 三个业务页的**页头容器**（`flex items-center justify-between gap-3 px-4 h-11` + `borderBottom` + `var(--color-editor-bg)`）已彼此一致，未动。
- 知识库 / 拆书 / 故事圣经的**空状态**均已使用 `EmptyState`，未动。

---

## 8. 本阶段发现并修复的真实缺陷

### 8.1 `shortenPath` 对短路径残留尾部斜杠

由新写的单测暴露，**不是实现写错、而是原有实现确有缺陷**：

```
shortenPath('/a/b/c/')   // 期望 '/a/b/c'，实际 '/a/b/c/'
```

原因：三段以内的分支直接 `return normalized`，没有清理尾斜杠。修法：

```ts
return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
```

（根路径 `/` 单独保留。）同时测试里我自己的另一条断言也写错了 —— 把 5 段路径的尾部三段记成了 `…/vela/my-novel`，实际应是 `…/Documents/vela/my-novel`；已改正断言并补一条 4 段用例。

### 8.2 俄语界面回退到中文日期格式

`src/utils/time.ts` 的 locale 选择是：

```ts
i18n.language === 'en' ? 'en-US' : 'zh-CN'
```

于是**俄语**（`ru`）下，超过 7 天的时间会落到 `zh-CN` 的日期格式（「9月12日」）。抽出 `currentLocale()` 并补上 `ru` 分支：

```ts
i18n.language === 'en' ? 'en-US' : i18n.language === 'ru' ? 'ru-RU' : 'zh-CN'
```

`formatRelativeTime` 与 `formatDate` 同时改用它。已验证 `Intl.RelativeTimeFormat` 三语均可用。

---

## 9. 顺带修正的文档自身问题

排查行尾时发现两处（与代码无关，但同属「一致性」）：

1. `docs/UI-UX-AUDIT.md` 有 **6 处畸形 Markdown 硬换行**，形如 `文本<CR>␣␣<CRLF>`。游离的 CR 在 CommonMark 里同样算行结束符，因此原本想表达的「段内换行」被渲染成了「分段」。已删除全部游离 CR（`loneCR: 6 → 0`）。
2. `docs/UI-UX-PHASE-C.md` **整个文件是 LF**（`CRLF=0 / loneLF=139`），违反仓库统一的 CRLF 约定。已转换（现 `CRLF=139 / loneCR=0 / loneLF=0`）。

---

## 10. 门禁

| 门禁 | 结果 |
| --- | --- |
| `npm run typecheck` | 0 error |
| `npm run lint` | 0 problem（`--max-warnings 0`） |
| `npm run test` | **84 文件 / 1048 用例全通过** |
| `npx vite build` | 成功（2245 modules） |

产物抽查：主 CSS `index-*.css` 中 `w-auto` / `h-6` / `appearance-none` / `vela-field` / `data-editor-appearance` 均存在；`--editor-font-size` / `--editor-line-height` / `--editor-max-width` / `--editor-paragraph-spacing` / `focusSnapshot` 均在 JS 产物中（它们是 `EditorArea` 以 React 内联 style 注入的，本就不应出现在 CSS 里）。

行尾复核：本阶段改动的全部 `.tsx` / `.ts` / `.json` 文件均为 100% CRLF，无游离 CR、无 LF。

---

## 11. 未做与原因

### 11.1 故事圣经 20 处密集行内 `<input>` 未抽取

`FactsSection` / `LocationsSection` / `RealmsSection` / `PlotsSection` 共约 20 处原生 `<input>`，共用同一份复制粘贴的内联样式：

```
className="px-1.5 py-0.5 rounded text-[0.68rem] outline-none"
style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)', width: N }}
```

**为什么不动**：

1. 这些是**刻意紧凑**的行内编辑框（`0.68rem`、`py-0.5`），直接换成 `Input`（`h-7 px-3 text-xs`）会明显变大，破坏密集列表的排版 —— 那是**视觉回归**，不是统一。
2. 从**用户可见**角度，它们彼此已经一致；问题在代码层（同一份样式复制 20 次），属阶段 B「令牌收口」的范畴，不是阶段 E「逐页可见统一」。
3. 若要做，正确做法是新增一个 `.vela-field-inline` 紧凑变体类并逐处替换。但那必须**逐字节等价**才能保证密集列表不位移，而 `py-0.5 + text-[0.68rem]`（无显式 line-height）的实际高度依赖继承值，在**无法渲染验证**的前提下只能靠猜 —— 收益（代码整洁）与风险（排版位移）不成比例。

→ 建议单独提「行内字段样式收口」批次，与阶段 B 的令牌工作一起做，且需要有可视回归手段。

### 11.2 `PageHeader` 组件化未做

三个业务页的页头容器虽同构，但：

- `BooksOverview` / `StoryBibleOverview`：左侧 = 标题 + 副信息，右侧 = 操作按钮组；
- `KnowledgeOverview`：**没有操作按钮**，统计值放在**右侧**（另两页放在标题旁边）。

也就是说，三页里只有知识库的统计值位置不一致。要做 `PageHeader` 就必须先决策「统计值该在左还是右」，而那是**可见的布局改动**，需要在真实界面里比对 —— 同样受制于无法渲染验证。

→ 建议与阶段 F 的 `SectionHeader` 一起决策，或先单独确认知识库统计值的位置口径。

### 11.3 其它仍挂账

- `FeatureTour` 的 `z-[10000..10002]` 未纳入 `z-index.ts` 规范（阶段 C 遗留）。
- `novel-editor.css` 的 `.vela-editor-content` / `.novel-editor-content` / `.arch-editor-content` 系列规则在 `src/` 下无任何 tsx 引用（Tiptap 时期遗留，因任务书第十二节约束未动）。
- `GlobalConfig.editorFontSize` / `editorFontFamily` / `autoSaveInterval` 三个契约字段仍未被渲染进程读取（阶段 B 遗留，建议单独提「契约清理」批次）。

---

## 12. 需手动验证（本阶段无法在无头环境覆盖）

1. 欢迎页：已打开项目时主操作是否为「继续创作」，点击后侧栏切到「项目」且**正文与标签页不丢**。
2. 欢迎页：最近项目的时间文案随语言切换是否正确（尤其俄语下 >7 天应显示俄语日期，而非「9月12日」）。
3. 欢迎页：无最近项目时空状态的两个按钮可点。
4. 拆书两个面板：工具条里下拉与相邻数字输入框**同高**，下拉箭头样式与全库一致。
5. 故事圣经：页头标题与内容左边缘是否与知识库 / 拆书对齐（880px）。
6. 故事圣经 · 物品流转台账：新增行的下拉高度是否与同排输入框齐平。
7. 底部面板「日志」页签：级别下拉是否与右侧搜索框同高。
8. 设置 → 模型：无模型时的空状态与「添加第一个模型」按钮。
9. 深色主题下：知识库的提示条 / 检索模式标签 / 相似度分数标签是否仍清晰可辨（原调色板类在深色下会撞色）。

---

## 13. 下一步

- **阶段 E 剩余**：如 §11.2 决策后引入 `PageHeader`，再回填三页页头；`KnowledgeOverview` 统计值位置口径确认。
- **阶段 F（组件一致性）**：新增 `SearchField` / `PanelHeader` / `SectionHeader` / `TabBar` / `LoadingState` / `ErrorState` 并逐个替换；裁决 `Skeleton` / `ActionToast` / `AlertDialog` 去留；`Icon.tsx` / `Skeleton.tsx` 目前零引用，`Badge.tsx` / `Tooltip.tsx` 仅被 Storybook 引用 —— 需在本阶段一并裁决。
- **阶段 G**：四道门禁 + 任务书 10.2 手动回归清单。

**全程未提交、未推送。**
