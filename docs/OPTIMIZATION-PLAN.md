# Vela 长篇小说优化 · 现状对照与实施计划

> 对应需求文档：《Vela 小说创作工具优化开发》（2026-10-11）
> 本文是该需求第 13 节要求的「先分析、后动手」交付物：逐项对照 + 第一阶段方案 + 风险 + 测试计划。
> 结论先行：**方向可行，但不需要新建任何平行体系**——需求里最核心的三件事（事实库、动态上下文、一致性校验）在 Vela 里已有六到七成实现，真正的缺口只有三个：**事实的作者确认、上下文预览、修改影响分析**。

---

## 一、现有资产盘点（可直接复用）

| 层 | 资产 | 位置 |
|---|---|---|
| 事实库 | `canon_facts`（category / statement / introduced_at / characters / evidence / status / created_at） | `electron/database.ts` |
| 时间线 | `canon_timeline_events`（chapter / sequence / characters / location / time_flow / summary / impact） | 同上 |
| 剧情线（伏笔雏形） | `canon_plot_lines`（name / status / started_at / last_advanced_at / resolved_at / characters / current_state / description） | 同上 |
| 事实抽取 | 本地启发式优先 + 可选 LLM 增强，失败不阻塞定稿 | `src/services/narrative-consistency/fact-extractor.ts` |
| 冲突检测 | 保守策略：同类目 + 共享角色 + 否定线索 → 标 `contradicted` 交作者 | `src/services/narrative-consistency/fact-conflict.ts` |
| 注入规则 | 跳过 `outdated`；`contradicted` / `tentative` 带「矛盾待确认 / 暂定」标记注入 | `src/services/narrative-consistency/context-builder.ts` |
| 一致性 Gate | 地点 / 知识授权 / 关系 / 时间线 / 物品归属 / 上一章衔接 + 自动修复 | `src/services/narrative-consistency/consistency-gate.service.ts` |
| 定性审稿 | 六维观察（角色记忆 / 物资连续性 / 伏笔回收 / 大纲偏离 / 叙事节奏 / 情感弧线）+ AI 痕迹 8 类 | `src/services/review/` |
| 迁移机制 | `PRAGMA user_version` + 逐列 `PRAGMA table_info` 检查 + `ALTER TABLE ADD COLUMN` | `electron/database.ts` `migrateProjectDatabase` |
| 事实相关 IPC | `db:canon-fact-list / add / clear-chapter / mark-status`，外加 timeline / character-state / plot / summary 全套 | `src/shared/ipc-channels.ts` |
| 事实界面 | `StoryBibleOverview` 已按「概览 / 角色 / 时间线 / 剧情线 / 事实」分区，事实按类别分组、显示 `Ch.N` 来源章节、支持搜索 | `src/components/pages/StoryBibleOverview.tsx` |
| 修稿与撤回 | 修稿前后内容 + 撤回、三栏合并逐块采用、剧情调整记录 | `src/services/workflows/commands/`、`ThreeWayMerge.tsx` |

---

## 二、逐项对照

图例：**已实现** / **部分** / **未实现**

### 需求 1：小说事实库

| 需求项 | 状态 | 说明 |
|---|---|---|
| 事实字段（ID / 类别 / 内容 / 关联人物 / 来源章节 / 原文片段 / 状态 / 创建时间） | **已实现** | `canon_facts` 全中，界面已展示类别与 `Ch.N` |
| 冲突标记 | **已实现** | `fact-conflict.ts` 标 `contradicted`，注入时带「矛盾待确认」 |
| 状态区分（待确认 / 已确认 / 被修正 / 废弃 / 争议） | **部分** | 现有 `tentative / active / outdated / contradicted` 可覆盖四类；缺「作者确认」这个动作本身——写回是自动的，没有任何人工闸门 |
| 作者确认流程 | **未实现** | 界面只能看不能确认或驳回；`db:canon-fact-mark-status` 通道已就绪但无人调用 |
| 修改历史与最后更新时间 | **未实现** | 无 `updated_at`，事实自身没有版本链（章节正文有，事实没有） |
| 客观事实 vs 人物认知（A 知道不等于 B 知道） | **部分** | 有 `facts.characters` + 知识授权检查 + 角色状态，但没有显式的「谁知道 / 谁怀疑 / 谁不知道」 |

### 需求 2：动态上下文组装

| 需求项 | 状态 | 说明 |
|---|---|---|
| 分层上下文（全局规则 / 当前状态 / 当前剧情 / 历史检索 / 约束） | **已实现** | 架构与梗概按长度截断 → Canon 动态段（角色状态 / 时间线 / 剧情线 / 事实，按章节窗口与出场角色过滤）→ 本章蓝图 / 上一章结尾 / 后续预告 → 知识库 3 条 → 硬约束 |
| 多路检索（语义 / 实体 / 章节 / 事实 / 时间线 / 伏笔） | **部分** | 语义、章节窗口、事实/时间线/剧情线查询都在；实体检索与伏笔状态查询未成体系 |
| 上下文预览（看这次用了什么、可增删锁定） | **未实现** | 目前只有一行日志「架构 X 字 / Canon Y 字 约 N tokens」 |
| 资料不足时提示而非编造 | **部分** | Gate 会拦「无依据的设定改动」，但没有「检索无结果就明确提示」 |

### 需求 3：章节修改影响分析

| 需求项 | 状态 | 说明 |
|---|---|---|
| 依赖关系追踪（人物出场 / 死亡 / 修为 / 物品 / 功法 / 关系 / 伏笔 / 秘密 / 事件 / 时空 / 大纲） | **未实现** | 没有「事实被哪些章节使用」的记录 |
| 影响分析报告（相关章节 + 原因 + 原文 + 分级） | **未实现** | 只有审稿的「大纲偏离」观察与剧情调整记录 |
| 只报告、不自动改后续 | 待办 | 现有修稿记录的原子写入 + 撤回机制可直接承载 |

### 需求 4：分层写作风格

| 需求项 | 状态 | 说明 |
|---|---|---|
| 全书风格 | **已实现** | `novelConfig.writingStyle` + 从已写章节提炼文风 + 文风仿写技能 |
| 场景风格（战斗 / 探索 / 日常 / 悬疑 / 悲剧） | **部分** | 无独立字段；章节蓝图已有 `userGuidance` 可承载，无需新建体系 |
| 章节级微调 | **部分** | 同上（`userGuidance` + 修稿的额外指导） |
| 作者风格样本库 | **部分** | 有分析文风流程与 `style-imitation` 技能，但没有「标记某章为样本」的管理界面 |
| 防止过度去 AI 化 | **部分** | 方法里已写明自然处不动、字数幅度受限、不得为降痕迹加废话；缺机器可检的护栏 |

### 需求 5：生成与校验流水线

| 需求项 | 状态 | 说明 |
|---|---|---|
| 读取本章任务 | **已实现** | 蓝图 + 前文 + Canon |
| 章节执行计划 | **部分** | 章节蓝图（role / purpose / keyEvents / suspenseHook）实质就是计划，但没有「先生成计划再写」这一步 |
| 生成正文（长章分场景） | **已实现** | 分段生成 + 截断续写 + 字数闸门 |
| 一致性检查 | **已实现** | 写前占位符校验 → Gate（含自动修复） |
| 文风检查 | **部分** | AI 痕迹 8 类；缺「对话是否符合人物性格」这类语义项 |
| 报告 → 定点修订 → 确认更新事实库 | **部分** | 报告与定点修订都有；「确认」缺失（见第一节） |

### 需求 6：大纲与正文一致性

| 需求项 | 状态 | 说明 |
|---|---|---|
| 对比（原大纲 / 修版大纲 / 正文 / 已确认事实 / 已发生 / 未完成） | **部分** | 审稿的「大纲偏离」维度已在做，但没有按六类（已完成 / 未完成 / 偏差 / 遗漏 / 合理创新 / 冲突）输出 |
| 偏差不等于错误、支持更新大纲 | **部分** | 有剧情调整（可改大纲并留记录），但没有「确认新方向同步大纲」的引导 |

### 需求 7：长篇专项管理

| 需求项 | 状态 | 说明 |
|---|---|---|
| 人物状态追踪 | **已实现** | `character_states` + 定稿写回 + 按章节窗口注入 |
| 时间线管理 | **已实现** | `canon_timeline_events`（含 time_flow / impact） |
| 伏笔管理 | **部分** | 审稿有伏笔回收观察；`plot_lines` 可承载，但缺「预计回收阶段 / 埋设与回收」台账视图 |
| 物品流转追踪 | **部分** | 有物品归属检查与事实条目，但没有「获得 / 丢失 / 转交 / 消耗」流水 |
| 境界与能力约束 | **部分** | Gate 能拦「使用未掌握能力」，但没有境界表（能力范围 / 越级条件 / 突破条件） |
| 地图与空间关系 | **未实现** | 只有地点连续性检查，没有地图 / 距离 / 路线数据 |

### 需求 8：质量测试集 / 界面清单 / 技术约束

- 质量测试集：**未实现**（只有代码测试，没有「同一大纲跑优化前后」的对比机制）。
- 界面清单：事实库页面 **已实现**（StoryBible 四个分区 + 搜索）、正文差异对比 **已实现**（三栏合并）、生成后检查报告 **已实现**（定性审稿报告）；缺「事实冲突处理」「章节影响分析」「生成前上下文预览」「大纲偏差报告」「时间线与伏笔独立页」。
- 技术约束（复用现有栈、迁移、可撤销、可追溯、不得用模拟数据）：**已满足**，迁移机制现成。

---

## 三、实施计划（六阶段，按建议顺序）

### 阶段零（建议先做）：回归样本集骨架

理由：没有固定样本，「优化有没有用」只能靠感觉。这轮开发里已经出现过多次「改了 A 影响 B」。

1. 目录 `samples/novel-regression/`：5 到 10 章的固定蓝图 + 参考正文 + 「不许出现的问题」清单（人物认知错误、物品凭空出现、时间线冲突、大纲遗漏、AI 痕迹类别）。
2. 脚本 `scripts/run-novel-regression.mjs`：本地手动运行（需要真实模型 key），跑写稿 + 审稿全流程，输出指标对比表：设定错误数、矛盾数、认知错误数、遗漏数、物品错误数、时间线错误数、检索无关率、人工返工次数。
3. **不进 CI**：CI 既没有模型 key 也不该承担费用；它定位为本地回归工具，结论由人核对。

### 阶段一：给事实库补上「作者确认」

目标：让「AI 提取的事实」和「作者确认的事实」真正分开。这是需求文档的核心，也是当前最大缺口。

1. `electron/database.ts`：`SCHEMA_VERSION` +1，幂等迁移新增两列：`canon_facts.updated_at`、`canon_facts.confirmed_at`（NULL 表示未经作者确认）；新增 `canon_fact_history` 表（fact_id / action / before / after / at）。
2. `electron/repositories/canon-repository.ts`：`addFact()` 支持写入确认状态；定稿写回产生的新事实默认 `tentative`（受开关控制，见风险 R1）；新增 `setFactConfirmed()`、`listFactsByReview()`、`appendFactHistory()`。
3. `src/shared/ipc-channels.ts`：新增 `db:canon-fact-confirm`、`db:canon-fact-history`。
4. `src/components/pages/StoryBibleOverview.tsx`（事实分区）：每条显示状态徽标（待确认 / 已确认 / 争议 / 已废弃）与原文证据；顶部筛选「待确认 N / 冲突 N」；按钮「确认」「标记争议」「标记废弃」；冲突条目并排对照。

验收：定稿后新事实进「待确认」；确认后转「已确认」，来源章节与原文证据可追溯；状态流转有历史记录；注入时待确认事实带「暂定」标记（现成行为）。

成本：不新增模型调用（复用现有写回）；确认是人工操作。

### 阶段二：上下文预览

1. `src/services/workflows/commands/generate-draft.command.ts`：把 canon 组装中间结果（各段条目数、字数、token 估算、来源章节、被过滤条目及原因）整理为结构化摘要，写入 `context.data.contextPreview`。
2. `src/stores/workflow-store.ts`：保存最近一次预览。
3. 新增 `src/components/panels/ContextPreviewPanel.tsx`，挂在底部面板或独立 Tab。
4. 二期可选：允许作者锁定或排除某条事实、某个人物状态，写入 `novelConfig.contextOverrides`。

验收：不翻日志就能看到本次注入的全部片段与来源，字数与 token 估算和实际提示词一致。

### 阶段三：伏笔台账

1. `canon_plot_lines` 新增 `kind TEXT DEFAULT 'plot'`（区分剧情线与伏笔）与 `planned_resolve_at TEXT`（预计回收阶段）。
2. 把审稿的「伏笔回收」观察与事实里的伏笔类目接入台账；写作前提示「本章是否有待推进的伏笔」。
3. `StoryBibleOverview` 新增「伏笔」分区（复用现有剧情线渲染）。

### 阶段四：修改影响分析（本需求里唯一的大工程）

核心思路：把依赖关系变成数据，而不是每次靠检索猜。

1. 新增 `canon_fact_usage (fact_id, chapter_number, evidence, used_at)`。定稿写回时，让**现有那次**写回调用顺带输出「本章沿用或改动了哪些既有事实 ID」，写入该表 —— 不新增模型调用。
2. 新增 `src/services/narrative-consistency/impact-analysis.service.ts`：输入被修改章节号与改动前后内容（或 `story_revisions` 记录）；差分出事实变化；查 `canon_fact_usage` 找引用章节；结合剧情线与时间线补充关联；输出分级报告（高 / 中 / 低），每条带章节号、原因、原文、建议。
3. 界面：新增 `src/components/pages/ImpactAnalysisOverview.tsx`，或作为定性审稿报告的新分区。

验收：改掉「第 20 章获得法宝」后，能列出引用该事实的后续章节并说明原因；报告只读，后续修改仍走现有修稿记录（原子写入 + 可撤回）。

### 阶段五：大纲偏差分类报告与场景文风

1. 定性审稿的「大纲偏离」输出改为六类（已完成 / 未完成 / 偏差 / 遗漏 / 合理创新 / 冲突），并支持一键「确认新方向」→ 更新大纲（走 `story_revisions`，可撤回）。
2. 场景文风不新建字段：把章节蓝图的 `userGuidance` 明确为「场景风格与本章微调」，并在提示词里标注用法；全书风格仍用 `writingStyle`。

---

## 四、风险与红线

| 编号 | 风险 | 处理方式 |
|---|---|---|
| R1 | 新事实默认状态由 `active` 改为 `tentative` 会改变注入与 Gate 行为 | 项目级开关控制；默认只对新写回生效；老数据保持原样；迁移不改历史行 |
| R2 | 加字段必须走迁移，绝不能重建表 | 沿用 `migrateProjectDatabase` 的 `user_version` + `PRAGMA table_info` + 逐列 `ALTER TABLE`；迁移前自动备份数据库文件 |
| R3 | 每项新功能都可能增加模型调用 | 阶段一、二为零新增调用；影响分析复用写回调用；任何新增调用都要带 token 上限、开关、分批与进度 |
| R4 | 影响分析被误用成自动重写后续章节 | 只产出报告；批量修改必须走 `story_revisions`（原子 + 可撤回） |
| R5 | 再建平行事实来源 | 禁止：一律建在 `canon_*` 之上，只加列与关联表，不新开事实表 |
| R6 | 长篇事实体量膨胀导致注入过长 | 注入按章节窗口 + 出场角色 + 每类条数上限收敛（现有机制），确认后的新事实同样受限 |
| R7 | 回归样本被当作自动质量保证 | 明确定位为人工核对清单，不自动判定通过或失败 |

---

## 五、测试计划

1. 单测（现有 vitest 体系，进 CI）：迁移幂等（对已有数据的库重复执行不报错不丢字段）；事实状态流转与历史成对；注入过滤（`outdated` 不注入，`tentative` 与 `contradicted` 带标记注入）；影响分析纯函数按事实使用记录列出依赖章节并分级。
2. 集成（沿用 story-revision 与 vector-store 的测试模式）：写回 → 待确认 → 确认 → 注入全链路；冲突检测到标注的闭环。
3. 回归样本（本地手动）：每阶段完成后跑一遍指标对比，重点看「引入的新错误」而不只是「修好了几个」。
4. 性能：用 300 章的模拟 Canon 库验证上下文组装耗时、注入字数与 token 估算、影响分析查询耗时。

---

## 六、明确不做

- 不重写项目、不引入新框架、不新建平行的事实库 / 知识库 / 文风体系。
- 不自动改写后续章节；不把 AI 推断当既定事实。
- 不用模拟数据或硬编码结果冒充功能。
- 不在没有测试的前提下声称功能完成；本地跑不通的验证要明确说明。

---

## 七、交付进度

六阶段与长篇专项已全部落地（本文档写在动手之前，上面「二、逐项对照」保留当时的状态，不作为现状）。

| 项 | 状态 | 落点 |
|---|---|---|
| 阶段零 回归样本集 | 已交付 | `samples/novel-regression/` + `src/services/__tests__/novel-regression.test.ts` |
| 阶段一 事实库作者确认 | 已交付 | `canon_facts.confirmed_at` + `canon_fact_history`（v3） |
| 阶段二 生成前上下文预览 | 已交付 | `src/services/workflows/context-preview.ts` + AI 输出面板 |
| 阶段三 伏笔台账 | 已交付 | `plot_lines.kind` / `planned_resolve_at`（v4） |
| 阶段四 修改影响分析 | 已交付 | `canon_fact_usage`（v5）+ `impact-analysis.ts` |
| 阶段五 大纲偏差六类 + 场景文风 | 已交付 | `OutlineClass` + 写稿提示词的「场景风格 / 本章微调」 |
| 专项 物品流转台账 | 已交付 | `canon_item_events`（v6） |
| 专项 境界阶梯 | 已交付 | `canon_realms`（v7） |
| 专项 地图与空间关系 | 已交付 | `canon_locations`（v8） |
| 专项 上下文窗口 / 输出上限拆分 | 已交付 | `resolveGenerationBudgets(window, maxOutput)` + 设置页两个字段 |
| 需求 6 · 确认新方向写回大纲 | 已交付 | 审稿观察「写回大纲」→ 章节「作者微操指导」（走剧情调整，可撤回） |

### 未做（需要作者拍板，不擅自动手）

- 物品流转 / 境界 / 地图的**自动告警**（例如「正文写到某件已损毁的道具」时弹提示）：等角色状态链路稳定后再加，否则误报会淹没真问题。
- 影响分析的**独立页面**：目前结论呈现在定稿日志里，够用但需要跳转。
- 作者**风格样本库**的标记界面（阶段四的「分层文风」只做了场景文风这一段）。
