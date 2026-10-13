# 阶段 F · 组件一致性

> 对应审计 `docs/UI-UX-AUDIT.md` §8「阶段 F」。
> 审计原文：新增 6 个组件（`SearchField` / `PanelHeader` / `SectionHeader` / `TabBar` / `LoadingState` / `ErrorState`），逐个替换手写实现；同时决定 `Skeleton` / `ActionToast` / `AlertDialog` 去留。

---

## 0. 结论先行

**审计提出的 6 个新组件，经逐项盘点后全部不成立** —— 要么真实调用点不足（1–2 处），要么早就有一个 CSS 类在承担同样的职责。新建它们只会造出下一批零引用组件。

**真正的问题不是「缺组件」，而是「已有组件没人用」**：

- `src/components/ui/Badge.tsx`（53 行）与 `.vela-badge` 的 6 个语义变体 CSS **早已齐备**，却**零引用**；
- 与此同时，「小号胶囊标签」这个模式被**手写复制了 9 次**，字号还分成 `0.6rem` / `0.65rem` / `0.7rem` 三档，其中 3 处用了硬编码色（`bg-green-500/15`、`text-white`）或混用两套色系。

因此本阶段的实质工作是**采纳 `Badge`**：把 9 处手写实现替换掉，顺手修掉 3 个真实缺陷，并补一个缺失的 `info` 变体。

---

## 1. 盘点：为什么 6 个新组件都不做

盘点口径是**真实调用点**，不是「看到类似的写法就算」。为避免误判，每个候选都先确定它独有的结构签名再计数。

| 审计提议 | 审计的隐含假设 | 实际盘点结果 | 结论 |
| --- | --- | --- | --- |
| `SearchField` | 有 9 处 `<Search>` 就该抽 | 9 处里 **7 处是按钮内的图标**（`<Search size={11} />` 跟在文案前），只有 **2 处**是「相对定位图标 + `Input` 加 `pl-7`」的真搜索框，且同属故事圣经一个功能域 | **不做**，2 处不足以立组件 |
| `PanelHeader` | 面板头需要统一 | `src/index.css` 里 **`.panel-header` 类已存在**，5 处直接用它 | **不做**，类已承担该职责 |
| `SectionHeader` | 区块标题需要统一 | **`.section-title` 类已存在**（阶段 E 刚把三处页头标题也收敛到它） | **不做**，同上 |
| `TabBar` | 标签栏需要统一 | 全库 4 种标签形态**互不相同且各仅 1 处**：故事圣经是分段胶囊组、底部面板是 dock 标签（渲染在 `LeftToolWindowBar`）、设置是左侧导航、编辑器是文件标签。强行合并是把不同交互模式塞进一个形状 | **不做**，属过度抽象 |
| `LoadingState` | 加载态需要统一 | **0 处**「全区域加载」（`justify-center` + `Loader2` 的组合一次都没出现）；现有 40 处 `Loader2` 全是**按钮内**的运行中指示 | **不做**，无调用点 |
| `ErrorState` | 错误态需要统一 | **0 处**全区域错误态。34 处 `AlertTriangle` 的 className 归类后全是**行内小图标**（`mt-0.5 flex-shrink-0` / `opacity-90` / `inline mr-1`），嵌在提示条或列表行里 | **不做**，无调用点 |

> 这一步的价值在于**避免制造零引用组件**。`Icon.tsx` / `Skeleton.tsx` / `Badge.tsx` / `Tooltip.tsx` 这四个现存死组件，本身就是上一轮「先建组件、后找用途」的产物；不重复这个错误比多写 6 个文件更重要。

---

## 2. 实际做的事：采纳 `Badge`（9 处）

### 2.1 变体映射

替换前逐处确认了原有配色意图，再选最贴近的语义变体；不确定的一律选**保底不变色**的那个。

| 文件 : 行 | 原实现 | 选用变体 | 说明 |
| --- | --- | --- | --- |
| `dialogs/ChapterCreationDialog.tsx` | `bg-green-500/15 text-green-600 dark:text-green-400` | `success` | **修掉调色板类硬编码色** |
| 同上（第二处） | `rgba(accent, 0.15)` 底 + accent 字 | `default` | 与 `--color-accent-soft` 同义 |
| `pages/KnowledgeOverview.tsx` | success 15% / `color-mix(info 15%)` | `success` / `info` | 双态 |
| `panels/agent/AgentInputBox.tsx` | `--color-border` 填充底 + muted 字 | `outline` | 中性标签，改用描边式（**有可见变化**） |
| `panels/agent/SlashCommandMenu.tsx` | success 12% 底 + `--color-success` 字 | `success` | **修掉对比度偏低**（`-success` → `-success-text`） |
| `settings/BackupSettings.tsx` | accent-soft 底 + **info-text** 字 | `default` / `outline` | **修掉两套色系混用**（底色保持不变） |
| `settings/PromptSettings.tsx` | `SOURCE_CONFIG` 的 `color`/`bg` 内联 | `outline` / `info` / `warning` | `SOURCE_CONFIG` 重构为**变体映射**（见 2.3） |
| `settings/SettingsModal.tsx` | `bg-[var(--color-accent)] text-white` | `solid` | **修掉硬编码 `text-white`**（→ `--color-on-accent`） |
| 同上（第二处） | `--color-hover` 底 + muted 字 | `outline` | 中性标签 |

替换后全库已无手写胶囊徽章：

```
grep -rn "rounded-full" src --include=*.tsx | grep -E "text-\[0\.(6|65|7)" | grep -v "ui/Badge.tsx"   # 无输出
```

### 2.2 顺带修掉的 3 个真实缺陷

这 3 处不是「统一风格」，而是原有实现确实错了：

1. **`ChapterCreationDialog`**：`bg-green-500/15 text-green-600 dark:text-green-400` 是 Tailwind 调色板类 —— 不随 5 套主题走，在 `paper` / `ocean` / `galaxy` 主题下会与语义色撞色。换 `success` 变体后走 `--color-success-rgb` / `--color-success-text`。
2. **`SettingsModal`**：`text-white` 硬编码。在浅色强调色主题下「默认」徽章的文字可能失去对比度；`solid` 变体用 `--color-on-accent`，随主题走。
3. **`BackupSettings` / `PromptSettings` / `SlashCommandMenu`**：底色取自一套色系、文字取自另一套（如 accent-soft 底配 info-text 字），以及用 `--color-success` 而非 `--color-success-text`（后者才是为文字对比度调过的）。变体化之后色系自洽。

### 2.3 `SOURCE_CONFIG` 重构为变体映射

`settings/PromptSettings.tsx` 原先用一张内联配色表描述三种提示词来源：

```ts
const SOURCE_CONFIG = {
  builtin: { labelKey: 'prompts.builtin', color: 'var(--color-text-muted)', bg: 'var(--color-hover)' },
  global:  { labelKey: 'prompts.global',  color: 'var(--color-info-text)',  bg: 'var(--color-accent-soft)' },
  project: { labelKey: 'prompts.project', color: 'var(--color-warning-text)', bg: 'rgba(var(--color-warning-rgb), 0.12)' },
} as const
```

现在只声明语义，配色交给 `Badge`：

```ts
const SOURCE_CONFIG: Record<'builtin' | 'global' | 'project', { labelKey: string; variant: BadgeVariant }> = {
  builtin: { labelKey: 'prompts.builtin', variant: 'outline' },
  global:  { labelKey: 'prompts.global',  variant: 'info' },
  project: { labelKey: 'prompts.project', variant: 'warning' },
}
```

这样「来源 → 颜色」的映射只有一处真源（`.vela-badge--*`），改主题色时不需要回来改这个文件。`Badge.tsx` 为此导出了 `BadgeVariant` 类型。

### 2.4 新增 `info` 变体

`Badge` 原有 6 个变体（default / success / warning / error / outline / solid），但**缺少 info 语义**，而全库已有 `--color-info` 与 `--color-info-text` 两个令牌，且有两处确实需要（知识库的「基础检索」标签、提示词来源的「全局」档）。

补上 `.vela-badge--info`：

```css
/* info 与 default 的区别：default 是品牌强调色（「主」），info 是中性告知色（「说明」）。
   --color-info 没有 -rgb 变体（5 套主题都没有），因此底色用 color-mix 合成。 */
.vela-badge--info {
  color: var(--color-info-text);
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-info) 24%, transparent);
}
```

这不是「新增一个语义重复的变量」，而是补全变体集合里**缺失的一格**（info ≠ success ≠ warning ≠ error ≠ default）。Storybook 的选项列表、`AllVariants` 示例与描述文字同步更新（6 → 7）。

---

## 3. 死组件裁决

审计要求裁决 `Skeleton` / `ActionToast` / `AlertDialog`，另外本轮盘点又确认了 `Icon` / `Tooltip` 也是零引用。

| 组件 | 真实引用 | 裁决 | 理由 |
| --- | --- | --- | --- |
| `Badge.tsx` | 0 → **7 个文件 / 9 处** | **采纳（已完成）** | 见 §2 |
| `ActionToast.tsx` | `App.tsx` 以函数 `actionToast()` 调用 | **保留** | 在用，只是以命令式 API 使用而非 JSX 组件 |
| `AlertDialog.tsx` | `project-store.ts` 调用 `alertError()` | **保留** | 同上 |
| `Skeleton.tsx` | 0 | **保留不动** | 它是低层原语（呼吸动画占位块），不是「加载态」组件；全库加载态用的是按钮内 `Loader2`，没有骨架屏场景。删或改都属任务书第十二节禁止的「以清理旧代码为由删除尚未完全理解的实现」 |
| `Icon.tsx` | 0 | **保留不动** | 它的 API 是 `<Icon icon={Comp} />`，与全库现行的「直接写 lucide 组件」不同；且其尺寸体系（12/14/16/18/22）与实际用法（11/12/13/14/17/18/22）对不上。采纳它等于全库改写图标且先要修正尺寸表，收益为零 |
| `Tooltip.tsx` | 0（仅 Storybook） | **保留不动** | 基于 `@radix-ui/react-tooltip`，是一项**新功能**（全库现用原生 `title=`），不是统一项。采纳需在 App 根部挂 `TooltipProvider` 并逐个改造触发元素，超出「一致性」范畴；另其 `z-[9999]` 硬编码未纳入 `z-index.ts`，若将来采纳需一并处理 |

---

## 4. 门禁

| 门禁 | 结果 |
| --- | --- |
| `npm run typecheck` | 0 error |
| `npm run lint` | 0 problem（`--max-warnings 0`） |
| `npm run test` | **84 文件 / 1048 用例全通过** |
| `npx vite build` | 成功 |

产物抽查：`vela-badge--info` / `--default` / `--outline` / `--solid` 均进入主 CSS `index-*.css`。

行尾复核：本轮改动的 10 个文件（`index.css`、`Badge.tsx`、7 个业务组件、`Badge.stories.tsx`）均为 100% CRLF，无游离 CR、无 LF。

---

## 5. 未做与原因

1. **6 个新组件全部未建** —— 理由见 §1，核心是「不制造零引用组件」。
2. **`Skeleton` / `Icon` / `Tooltip` 未采纳也未删除** —— 理由见 §3。
3. **`--color-info-rgb` 未补** —— 全库 5 套主题都只有 `--color-info` 而没有 `-rgb` 变体，因此凡是需要 info 半透明底的地方（本轮新增的 `.vela-badge--info`、阶段 E 的知识库标签）都用 `color-mix()` 合成。若统一成 `-rgb` 形式需给 5 套主题各加一个令牌，属阶段 B 令牌收口范围，本阶段不动。
4. **调色板类尚未全库清零** —— 本轮只清掉了徽章相关的 3 处。`AlertTriangle` 的 className 归类里仍可见 `text-yellow-400` / `text-red-400` / `text-green-400`，属同一类问题（类名形式的硬编码色）。建议单独提「调色板类清零」批次，逐文件扫。

---

## 6. 需手动验证

1. 拆书 → 新建章节对话框：从蓝图/历史预填时的两个徽章配色与文字对比度（尤其 `paper`、`ocean` 主题）。
2. 知识库：检索模式徽章在「已建索引」与「基础检索」两态下的颜色（success / info）。
3. 设置 → 模型：默认模型的 `solid` 徽章文字是否随主题保持可读（原来是硬编码白字）。
4. 设置 → 提示词：三种来源（内置 / 全局 / 项目）徽章的颜色区分是否仍清晰。
5. 设置 → 备份：手动快照与恢复前快照的徽章。
6. Agent 输入框的模型选择器：provider 徽章由「填充式」改为「描边式」，确认在窄面板里不挤压模型名。
7. 斜杠命令菜单：Skill 徽章文字对比度是否提升。

---

## 7. 下一步

- **阶段 G（回归与交付）**：`npm run typecheck` + `npm run test` + `npm run lint` + `npm run build`，以及任务书 10.2 的手动回归清单。
- 阶段 E 遗留：`PageHeader` 决策（需先定 `KnowledgeOverview` 统计值的位置口径）。
- 仍挂账：`FeatureTour` 的 `z-[10000..10002]`；`novel-editor.css` 的 Tiptap 遗留规则；`GlobalConfig` 三个未被读取的契约字段；调色板类清零（见 §5.4）。

**全程未提交、未推送。**
