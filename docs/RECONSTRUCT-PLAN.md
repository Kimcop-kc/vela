# 拆书创作系统 —— 现状对照与实施计划

依据：《Vela 拆书创作系统开发任务》文档。原则与上一份优化计划一致：先读代码再动手，复用现有服务与数据库，不新开平行体系，功能先本地做完并验证。

## 一、现有可复用的东西

| 能力 | 现状 | 本次怎么用 |
|---|---|---|
| 参考小说导入 | `kb:deconstruct-book` 分章后写入 LanceDB，并在 `.vela/books/*.json` 留拆书档案（`BookRecord`，含每章 `docId`） | 直接复用，分析按 `docId` 逐章取正文 |
| 章节正文读取 | `kb:get-document-text-page`（分块分页） | 逐章取全文，按 token 预算截断 |
| 项目数据库 | SQLite（`user_version` 幂等迁移，现已到 v8） | 新增 v9：`book_analyses` / `plot_outlines` / `similarity_reports` |
| 模型调用与路由 | `llm:generate` / `llm:generate-stream`，用途类别 `generation`/`refinement`/`summary`/`embedding` | 拆书分析走 `book_analysis`（归入 summary 类别），正文生成走 generation |
| token 预算与切段 | `resolveGenerationBudgets` / `splitTextByTokenBudget` / `resolveJsonChunkBudget` | 分析、重构、正文生成统一按模型窗口推导预算 |
| 模型输出容错 | `parseLooseJson`（截断修补 + 片段提取） | 分析结果解析再叠一层「补括号」抢救，保住已写完的字段 |
| 事实库与确认流 | canon facts（`tentative/active/contradicted/outdated` + 作者确认 + 变更历史） | 正文生成后的新事实进「待确认」，不直接写正式库 |
| 一致性闸门 | `buildCanonContext` / `runConsistencyGate` | 正文生成后直接调用，产出「无明显冲突 / 需作者确认 / 明确冲突」 |
| 草稿与版本 | `draft-repository`（版本、状态、定稿保护） | 生成正文先落草稿，不覆盖已有正文 |
| 审稿增量记忆 | `chapter_review_digests`（按 canon 指纹失效） | 参考它的思路，分析结果按「正文指纹」判断是否需要重跑 |

## 二、模块与落点

### 1. 拆书分析（已完成）

- 数据：`book_analyses`（`book_id` + `chapter_number` + `analysis_type` 唯一，重跑覆盖；`source_hash` 记录正文指纹）
- 服务：`src/services/reconstruct/analysis-prompt.ts`（提示词 + 归一化）、`analysis-service.ts`（批量、跳过、取消、重试）、`json-repair.ts`（补括号式抢救）
- 界面：`src/components/pages/books/BookAnalysisPanel.tsx`，拆书页「拆书分析」页签
- 测试：`electron/__tests__/reconstruct-repository.test.ts`、`src/services/__tests__/reconstruct-analysis.test.ts`

### 2. 剧情重构（待做）

- 输入：选中的分析结论 + 本作题材/世界观/人物/时间线 + 创作目标、阶段、预期冲突、排除项、目标章数与篇幅、想借鉴的叙事技巧
- 输出：`plot_outlines` 记录（前提、主角目标、核心冲突、人物变化、伏笔、连续性说明、原创性说明、剧情节点数组、来源分析 id）
- 规则：只借通用技法（结构、冲突升级、悬念、信息释放节奏），不照搬人物关系与事件组合；不得靠换名换词改写
- 界面：节点可编辑、可增删、可调序、可单节点重生成；来源章节可回查

### 3. 正文生成（待做）

- 复用现有写稿上下文（架构 / Canon / 上一章结尾 / 知识库 / 文风 / 硬约束）与分段生成
- 以大纲节点或章节大纲为生成骨架；产出落草稿（`draft-repository`），作者确认后才谈覆盖
- 支持指定字数、续写、重新生成指定段、改对话、调节奏、补细节

### 4. 事实库联动（待做）

- 生成前：按本章涉及的人物 / 地点 / 事件筛选事实注入（复用 canon 上下文组装）
- 生成后：跑一致性闸门，结果分「无明显冲突 / 需作者确认 / 明确冲突」
- 新事实：提取候选 → 冲突检查 → 去重 → 进待确认队列（复用现有事实状态与作者确认）

### 5. 相似度辅助检查（待做）

- 文本层：本地算法（最长公共片段、n-gram 命中、近重复句）优先，模型只做辅助
- 情节层：人物关系对应度、事件顺序一致度、冲突与解决方式接近度、独特组合对应关系
- 报告：`similarity_reports`（overallRisk / findings / category / severity / 两侧位置 / 建议 / 说明）
- 红线：风险等级不是法律结论；没有足够依据时显示「无法判断」，不硬给分数

### 6. 界面集成（进行中）

拆书页签：参考小说 / 拆书分析（已交付）、剧情重构 / 正文生成 / 一致性检查 / 相似度报告（待做）。

## 二·补：实际交付状态（全部六个模块已交付）

| 模块 | 落点 | 界面 |
|---|---|---|
| 拆书分析 | `src/services/reconstruct/analysis-{prompt,service}.ts`、`json-repair.ts` | 拆书 → 拆书分析 |
| 剧情重构 | `outline-service.ts` | 拆书 → 剧情重构 |
| 正文生成 | `draft-service.ts` | 拆书 → 正文生成 |
| 事实库联动 | `canon-adapter.ts` | 正文生成页的「检查设定冲突」+ 一致性检查页签 |
| 相似度检查 | `similarity.ts` | 拆书 → 相似度报告 |
| 持久化与 IPC | `electron/repositories/reconstruct-repository.ts`、`electron/database.ts`（v9）、`src/shared/reconstruct.ts` | — |

测试：`electron/__tests__/reconstruct-repository.test.ts`（迁移 + 三张表读写）、
`src/services/__tests__/reconstruct-analysis.test.ts`（截断截取、目标挑选、归一化）、
`src/services/__tests__/reconstruct-similarity.test.ts`（相似度分级、情节对应、脱敏、提示词）。

## 三、红线（沿用上一份计划）

- 不重写项目、不换框架、不新建平行的事实库或知识库；
- 不把 AI 推测当既定事实；未经作者确认不覆盖已有正文；
- 不把整本参考小说一次性发给模型；
- 不用假数据冒充功能；本地跑不通的验证要写明。
