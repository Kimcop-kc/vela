# Vela 第二阶段审计报告 — 分层记忆与精准检索

> 审计时间：2026-10-12
> 审计范围：SQLite Canon Store、LanceDB 向量库、所有检索入口、记忆管理 UI、章节正文关联

---

## 一、现有记忆类型盘点

| 层级 | 数据载体 | 表/文件 | 现状 |
|------|----------|---------|------|
| 全书级 | `project_core` 架构字段 | `project_core` 表 | ✅ 有 premise/worldbuilding/charactersArch/synopsis，但无分层标记，注入时统一 clamp 截断 |
| 分卷级 | **无** | — | ❌ 不存在。无卷/阶段划分，无"本卷矛盾/人物发展/阶段性目标"概念 |
| 剧情线级 | `canon_plot_lines` | SQLite 表 | ✅ 有 active/resolved/paused + kind(plot/foreshadow) + plannedResolveAt |
| 人物级 | `canon_character_state` + `characters` | SQLite 表 | ✅ 有 location/powerLevel/physicalState/mentalState/keyItems/currentGoal/knowledge/relationships，但 knowledge 只做 union 无过期 |
| 章节级 | `canon_chapter_summaries` + `canon_timeline_events` | SQLite 表 | ✅ 有摘要+时间线事件，摘要与正文无直接外键关联 |
| 原文证据层 | `drafts` + `contents` | SQLite 表 | ✅ 有正文（contents.body），但 canon 表与正文之间**无外键关联**，事实的 evidence 字段是截断文本片段而非章节定位指针 |

## 二、检索能力审计

### 2.1 向量检索（LanceDB）

| 维度 | 现状 |
|------|------|
| 基础设施 | ✅ `electron/vector-store.ts` 基于 `@lancedb/lancedb`，有完整 schema + CRUD |
| Embedding | ✅ `electron/embedding.ts` 支持 OpenAI/Gemini/Ollama，`canUseEmbedding()` 判断可用性 |
| 检索模式 | ✅ 混合检索：向量近邻优先 → 关键词 LIKE 兜底 |
| **与 Canon 的关联** | ❌ **完全割裂**。LanceDB 只服务知识库 RAG，Canon Store 的 facts/timeline/characters 完全不走向量检索 |
| 检索对象 | 仅知识库文本块（ChunkRecord），不含 canon 事实/事件/人物 |

### 2.2 关键词检索

| 入口 | 实现 | 问题 |
|------|------|------|
| `filterRelevantFacts()` (canon-adapter.ts:98) | `statement.includes(keyword) \|\| evidence.includes(keyword) \|\| characters.includes(keyword)` | 纯子串包含，无分词、无别名、无相关性排序、无置信度因子 |
| `includesQuery()` (StoryBibleOverview.tsx:31) | `value.toLowerCase().includes(q)` | UI 搜索只做大小写不敏感子串匹配 |
| `recordFactUsage()` (canon-repository.ts:749) | P0-4 修复后 3 策略匹配 | 已改进但仍以子串/关键词为主，无语义检索 |

### 2.3 全文检索

| 维度 | 现状 |
|------|------|
| SQLite FTS | ❌ 未启用。所有 canon 表检索走 `SELECT * WHERE ... LIKE` 或全量加载后内存过滤 |
| LanceDB Tantivy | ⚠️ 存在但对中文分词支持有限，实际降级为 DataFusion LIKE |

## 三、事实元数据审计

| 需求 | 字段 | 现状 |
|------|------|------|
| 来源章节 | `introduced_at` | ✅ 有 |
| 来源段落 | — | ❌ **无**。evidence 是截断文本（≤500 字符），不记录段落在原文章节中的偏移位置 |
| 置信度 | `confirmed_at` | ✅ 有（null = AI 提取未确认；非 null = 作者确认） |
| 状态 | `status` | ✅ active/outdated/contradicted/tentative |
| 时间信息 | `introduced_at` + `updated_at` + `created_at` | ✅ 有 |
| 冲突标记 | `canon_fact_history` + `findConflictingFacts()` | ✅ 有变更历史表 + 冲突检测（bigram Jaccard ≥0.5） |
| 过期处理 | `status='outdated'` | ✅ 有状态标记，但 knowledge 列表只 union 不移除（P2-2） |

## 四、冲突与重复审计

| 问题 | 现状 |
|------|------|
| 重复事实 | ✅ `idx_canon_facts_unique` UNIQUE 索引 + `INSERT OR IGNORE`，按 `LOWER(TRIM(statement))` 去重 |
| 冲突事实 | ✅ `findConflictingFacts()` + bigram Jaccard 相似度检测，矛盾时标 `contradicted` |
| 过期状态 | ⚠️ facts 有 `outdated` 状态；但 `canon_character_state` 只存最新快照（`PRIMARY KEY character`），**无历史状态链** |
| 人物状态历史 | ❌ `canon_character_state` 表设计为 `character TEXT PRIMARY KEY`，每次 upsert 覆盖，不保留"第 50 章时林轩受了重伤，第 80 章已痊愈"这种历史链 |

## 五、检索排序与降级审计

| 入口 | 排序逻辑 | 数量限制 | 降级逻辑 |
|------|----------|----------|----------|
| `buildCanonContext()` → `formatFacts()` | P0-5 修复后：confirmed > active(近章优先) > contradicted > tentative，outdated 不注入 | top 40 | 无降级：40 条用完即止，不动态扩展 |
| `filterRelevantFacts()` (canon-adapter) | 无排序（命中即取），无关键词时 `slice(0, 40)` | 40 | 有匹配用匹配，无匹配用全量前 40 |
| `getTimelineUpTo()` | `chapter_number ASC, sequence ASC` | 无限制 | ❌ **全量返回**，300 章时间线一次性注入 |
| `getRecentSummaries()` | `chapter_number DESC LIMIT N` | 默认 3-5 | 无降级 |
| LanceDB 检索 | 向量距离 ASC | 默认 top-10 | 向量失败 → 关键词 LIKE 兜底 |

## 六、章节摘要与原文关联审计

| 维度 | 现状 |
|------|------|
| 摘要存储 | `canon_chapter_summaries` 表（chapter_number, title, summary, created_at） |
| 正文存储 | `drafts.content_id → contents.body`（通过 content_id 外键关联） |
| **摘要→正文关联** | ❌ **无直接关联**。摘要表只存 chapter_number，不存 draft_id 或 content_id。要从摘要回到原文，需要 `DraftRepository.getFinalizedByChapter(chapterNumber)` 再 → `ContentRepository.getBody(contentId)`，两跳查询 |
| evidence→原文 | ❌ facts.evidence 是截断文本片段，无法定位到原文章节和段落 |
| 交叉检索 | ❌ 无法从"某个事实"直接跳转到"引入该事实的章节正文" |

## 七、记忆管理 UI 审计

| 功能 | StoryBibleOverview 现状 | 缺失 |
|------|--------------------------|------|
| 按人物检索 | ❌ 只能在 characters section 浏览全部 | 无按人物名跨表检索（事实+事件+伏笔+状态） |
| 按事件检索 | ❌ 无 | 无事件维度检索 |
| 按章节检索 | ❌ 无 | 无法检索"第 N 章涉及的所有记忆" |
| 按伏笔检索 | ✅ plots section 可浏览+标记伏笔 | 但无"伏笔→埋设章节原文"跳转 |
| 命中原因 | ❌ `includesQuery` 只返回 boolean | 不显示为什么命中 |
| 查看来源章节 | ❌ 无跳转 | 事实/事件不链接到正文 |
| 查看原文 | ❌ 无 | 无法从记忆条目跳到原文章节正文 |
| 事实状态/来源/时间 | ✅ 有 confirmedAt + status + history | 有基础 |
| 冲突提示 | ✅ 有 `contradicted` 标记 + 变更历史 | 有基础 |
| 作者纠正 | ✅ 可确认/标状态/编辑伏笔回收阶段 | 有基础 |

## 八、综合问题清单

### P0（阻塞第二阶段目标）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 2P0-1 | **无统一检索入口** | canon-adapter.ts / context-builder.ts | 人物/事件/物品/伏笔无法交叉检索，各表独立查询 |
| 2P0-2 | **Canon 与 LanceDB 完全割裂** | vector-store.ts 只服务 RAG | 事实/事件/人物不走向量检索，长篇无法语义召回 |
| 2P0-3 | **事实无段落级来源定位** | canon_facts.evidence 截断文本 | 无法从事实跳回原文段落，"摘要替代原文"问题 |
| 2P0-4 | **角色状态无历史链** | canon_character_state PRIMARY KEY character | 无法区分"历史状态"和"当前状态"，多阶段状态查询无解 |
| 2P0-5 | **无分卷/阶段记忆层** | 不存在 | 长篇无法按卷过滤记忆，全量注入导致上下文爆炸 |
| 2P0-6 | **时间线全量注入无截断** | context-builder.ts:359 `timelineWindow = chapterNumber - 1` | 300 章时间线一次性注入 |
| 2P0-7 | **检索不区分置信度/状态/时效** | filterRelevantFacts 无加权 | "较新不等于正确"无法体现 |

### P1（影响检索质量）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 2P1-1 | **无人物别名/称谓映射** | characters 表无 aliases 字段 | "林轩/林公子/林少侠"检索不到同一个人 |
| 2P1-2 | **无 FTS 全文索引** | 全部 LIKE 查询 | 中文检索效率低，无分词 |
| 2P1-3 | **物品台账只取最近 20** | context-builder.ts formatItemLedger | 早期重要道具被丢弃 |
| 2P1-4 | **伏笔无过期提醒** | getActivePlotLines 只取 active | 第 1 章伏笔到第 200 章仍注入但无"该回收"提醒 |
| 2P1-5 | **UI 无命中原因显示** | StoryBibleOverview includesQuery | 作者无法理解为什么检索到了某条记忆 |

---

## 九、第二阶段实施与验证报告（本次交付）

> 说明：审计（第一~八节）提交后进入实施。实施前工作区已存在一份**后端骨架**（schema v10 迁移、`searchCanon`/分卷/状态历史/原文定位的仓储与 IPC、类型定义）。本次先逐项核实其可用性，发现并补齐了 4 处关键缺口，再完成渲染端门面、上下文注入、UI 与测试。

### 9.1 修改文件及原因

| 文件 | 原因 |
|------|------|
| `electron/database.ts` | v10 迁移：新增 `canon_character_state_history`、`canon_arcs`；`canon_facts` 加 `source_paragraph_index`、`arc_id`；`characters` 加 `aliases_json`（向后兼容，`SCHEMA_VERSION=10`） |
| `electron/repositories/canon-repository.ts` | **本次核心修复**：①`addFact` 落库段落定位与分卷关联（含缺列兜底）；②`writebackAtomically` 写回时**真正**追加角色状态历史快照（此前 `appendCharacterStateHistory` 从未被调用）+ 计算事实段落定位；③`searchCanon` 纳入 **arc** 检索、填充 **conflictsWith**、空查询无过滤时返回空；④`getCharacterAliases`/`resolveCharacterName` 修复"无别名角色无法解析"（此前只收录有别名的角色） |
| `electron/controllers/db-controller.ts` | 补齐 `MemoryHitType` 类型导入（修复遗留类型错误） |
| `src/shared/ipc-channels.ts` | 新增 `db:canon-search`、分卷、状态历史、章节段落等 IPC 通道定义 |
| `src/services/narrative-consistency/types.ts` | 新增 `Arc`、`CharacterStateHistoryEntry`、`MemoryHitType`、`MemorySearchHit`、`MemorySearchParams`、`MemorySearchResult`；`CanonContext` 加 `currentArc` |
| `src/services/narrative-consistency/canon-store.ts` | 渲染端门面暴露 `searchCanon`/`getArcs`/`upsertArc`/`getCharacterStateHistory`/`getCharacterStateAtChapter`/`getChapterParagraphs` |
| `src/services/narrative-consistency/context-builder.ts` | 注入分卷记忆（`formatArc` → 新增 `【本卷阶段记忆】` 区块）；注入清单加 `arcInjected` |
| `src/components/pages/StoryBibleOverview.tsx` | 新增「记忆检索」分区：统一检索、命中原因、状态/冲突提示、点击查看原文 |
| `src/stores/layout-store.ts` | `StoryBibleSection` 增加 `search` |
| `src/i18n/locales/{zh-CN,en,ru}/pages.json` | 新增检索分区与文案 |
| `vitest.config.ts` | 纳入新测试文件；放宽 `testTimeout`（SQLite 并行争用） |
| `src/services/narrative-consistency/__tests__/layered-memory-search.test.ts` | **新增**：第二阶段 7 场景 + 后端修复验证，共 12 用例 |

> 另：`fact-extractor.ts`、`finalize-chapter.command.ts`、`index.ts` 的改动属第一阶段（P0 修复）遗留，本次一并纳入回归验证。

### 9.2 新增 / 修复的检索流程

**统一检索入口 `CanonRepository.searchCanon(params)`**（单一入口，跨表交叉检索）：

1. 查询文本 → `extractSearchTerms` 拆词；
2. 角色名解析（含**别名/称谓**，来自 `characters.aliases_json` + canon 中出现的角色）；
3. 逐表打分：事实 / 时间线 / 角色当前状态 / 角色历史状态 / 剧情线伏笔 / 物品流转 / 章节摘要 / **分卷**；
4. 每类命中都产出 `matchReasons`（人类可读命中原因）、`isCurrent`、`sourceLocation`（章节+段落）、`conflictsWith`；
5. 排序：分数降序，同分按章节号升序；**不因"较新"加分**（新 ≠ 正确）；
6. 结果携带 `degraded`/`degradeReason`/`elapsedMs`，便于降级审计。

**修复的具体缺陷：**

| 缺陷 | 修复 |
|------|------|
| 角色状态历史从未写入（`appendCharacterStateHistory` 死代码） | 写回事务内 upsert 后追加快照；重写同章先清该章历史，保证幂等 |
| 事实段落定位从未落库（`source_paragraph_index` 只读不写） | 写回时按 evidence → statement → 关键词重叠三级匹配定位段落 |
| `conflictsWith` 永远为空 | 检索时一次性两两检测（`detectFactConflict`，规模≤2000），互相标注冲突陈述 |
| `arc` 类型在枚举中但检索不返回 | 新增分卷检索分支（关键词 + 章节范围覆盖） |
| 无别名角色无法解析 | `getCharacterAliases` 收录全部角色（含空别名）并合并 canon 角色名 |
| 空查询返回全量 canon | 空查询且无过滤条件时返回空 |

### 9.3 数据迁移与兼容性

- **迁移**：`SCHEMA_VERSION` 9 → 10，`database.ts` 中 `if (currentVersion < 10)` 幂等执行；全部用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`（先 `PRAGMA table_info` 判存在），**老库零数据损失、可重复执行**。
- **向后兼容**：`addFact` 通过 `hasColumn()` 探测 `source_paragraph_index`/`arc_id`，缺列时退回不含这两列的写入；`writebackAtomically` 的历史写入与段落定位均在 `hasColumn` 保护下执行；`getArcForChapter` 在无 `canon_arcs` 表时返回 null。**旧库即使迁移未完成也能正常定稿**。
- **不删除用户数据**：所有新增均为"追加/标记"，未删除任何既有正文或事实；`markFactStatus` 仍走 `canon_fact_history` 留痕。

### 9.4 测试结果

- **类型检查**：`npm run typecheck` → **0 error**（同时修复了 5 个遗留类型错误）。
- **第二阶段测试**：`layered-memory-search.test.ts` → **12/12 通过**，覆盖任务书 7 个必测场景 + 分卷检索 + 4 项后端修复验证。
- **完整套件**：`npx vitest run` → **710/710 通过（64 文件）**。
- **构建**：`npx vite build` → renderer + main + preload **构建成功**。

7 场景对应关系：

| 任务书场景 | 测试用例 |
|-----------|----------|
| 久远人物检索 | 第 3 章出场、300 章未提及仍可检索 |
| 长期伏笔检索 | 第 1 章伏笔、第 200 章仍未回收，标记当前有效 |
| 物品持有者变化 | 获得/转交/丢失按章可追溯，丢失不再视为当前持有 |
| 人物多阶段状态 | 写回留痕形成历史链，可按章回溯伤势/境界 |
| 旧事实不作当前 | outdated 默认不返回；含历史时 `isCurrent=false`；冲突对互相标注 |
| 回溯原文 | 段落定位落库，检索命中带 `sourceLocation` 并可取回正确段落 |
| 证据不足 | 不存在关键词/空查询返回空结果，不编造 |

### 9.5 已知问题

1. **向量检索未接入 canon**：LanceDB 仅服务知识库 RAG，`searchCanon` 为纯 SQLite + 关键词；`degraded` 字段预留但当前恒为 false。语义召回（同义改写）仍弱于向量方案，属任务书"评估后确有必要再引入"的范围，本次未做。
2. **无 FTS5 全文索引**：仍走内存过滤 + `LIKE`；十万级 canon 规模下检索为全表扫描。当前长篇规模（数百~数千条）可接受。
3. **中文分词仍为启发式**：`extractSearchTerms` 为字符级/词表切分，非成熟分词器；生僻同义表达召回有限。
4. **`canon_arcs` 无自动生成**：分卷目前需作者手工维护（`upsertArc`），未从章节摘要自动推断卷边界。
5. **别名需手工录入**：`characters.aliases_json` 无自动抽取（未从正文/角色卡自动发现称谓）。
6. **`testTimeout` 放宽至 30s**：属测试基础设施调整（SQLite 并行争用），非掩盖真实缺陷——所有用例单独运行均通过。

### 9.6 是否可以进入第三阶段

**可以。** 判定依据：

- 分层记忆六层中，全书级（project_core）、分卷级（canon_arcs）、剧情线级（canon_plot_lines）、人物级（canon_character_state + 历史链）、章节级（摘要+时间线）、原文证据层（段落定位 + `getChapterParagraphs`）**均已具备**；
- 统一检索入口可用，且能回答任务书要求的五个问题（为什么命中 / 来源章节 / 有无原文 / 是否过期 / 是否冲突）；
- 冲突处理满足"保留历史、标注生效章节、不删除旧状态、无法判定标冲突待确认、推测不自动升级"；
- 类型检查、测试、构建全部通过，迁移向后兼容。

**进入第三阶段前建议补齐（非阻塞）**：接入 canon 向量检索以提升语义召回、引入 FTS5、分卷自动生成、别名自动抽取。

