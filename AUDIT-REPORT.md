# Vela 长篇记忆系统审计报告

## 审计范围

| 模块 | 文件路径 | 行数 |
|------|----------|------|
| 数据库层 | `electron/database.ts` | 701 |
| Canon 仓储 | `electron/repositories/canon-repository.ts` | 1043 |
| Canon Store (IPC 门面) | `src/services/narrative-consistency/canon-store.ts` | 432 |
| 上下文构建器 | `src/services/narrative-consistency/context-builder.ts` | 465 |
| 事实提取器 | `src/services/narrative-consistency/fact-extractor.ts` | 424 |
| 章节要点解析 | `src/services/narrative-consistency/notes-parser.ts` | 188 |
| Canon 适配层 | `src/services/reconstruct/canon-adapter.ts` | 194 |
| 草稿服务 | `src/services/reconstruct/draft-service.ts` | 238 |
| 定稿命令 | `src/services/workflows/commands/finalize-chapter.command.ts` | 643 |
| 生成命令 | `src/services/workflows/commands/generate-draft.command.ts` | 488 |
| 验证器 | `src/services/narrative-consistency/validator.ts` | 613 |
| 一致性门禁 | `src/services/narrative-consistency/consistency-gate.service.ts` | 203 |
| 事实冲突检测 | `src/services/narrative-consistency/fact-conflict.ts` | 62 |
| 影响分析 | `src/services/narrative-consistency/impact-analysis.ts` | 73 |
| 回填服务 | `src/services/narrative-consistency/canon-backfill.ts` | 128 |
| 类型定义 | `src/services/narrative-consistency/types.ts` | 317 |

---

## 一、调用链路确认

### 1.1 章节生成链路（生成前注入）

```
GenerateDraftCommand.execute()
  → buildCanonContext()               // context-builder.ts:329
    → canonStore.getTimeline()          // IPC → CanonRepository.getTimelineUpTo()
    → canonStore.getRecentSummaries()   // IPC → CanonRepository.getRecentSummaries()
    → canonStore.getActivePlotLines()   // IPC → CanonRepository.getPlotLines('active')
    → canonStore.getFacts()             // IPC → CanonRepository.getFacts()
    → canonStore.getAllCharacterStates()// IPC → CanonRepository.getAllCharacterStates()
    → canonStore.getRealms()            // IPC → CanonRepository.getRealms()
    → canonStore.getLocations()         // IPC → CanonRepository.getLocations()
    → canonStore.getItemEvents()        // IPC → CanonRepository.getItemEvents()
  → buildPromptCanon()                 // generate-draft.command.ts:351 — 按聚焦角色+近5章窗口过滤
  → renderCanonContext()              // context-builder.ts:441 — 按固定优先级拼装 prompt
  → LLM 生成草稿
  → runConsistencyGate()               // consistency-gate.service.ts:53
    → validateChapter()                // validator.ts:516
    → tryAutoFix()                     // auto-fix.ts
  → 存入 drafts 表
```

**结论：生成前注入链路完整，所有 Canon Store 数据均可被检索并注入。**

### 1.2 章节定稿链路（定稿写回）

```
FinalizeChapterCommand.execute()
  → buildCanonContext()               // 重建上下文
  → runConsistencyGate()              // 定稿门禁（BLOCK 则中止）
  → db:chapter-rollback-capture       // 快照
  → db:draft-update-status('finalized')
  → runPostProcessPipeline()
    步骤1: kb_import                   // 导入知识库（critical: true）
    步骤2: chapter_notes              // LLM 生成章节要点 → blueprint.notes + canon_summary（critical: true）
    步骤3: canon_writeback            // ⚠️ critical: false
      → extractAndWriteback()
        → extractCanonWriteback()     // fact-extractor.ts:335
          → parseChapterNotes()        // notes-parser.ts:68 (优先)
          → extractEvents()            // 启发式兜底
          → extractCharacterDeltas()   // 启发式兜底
          → extractFacts()             // 启发式兜底
          → extractSummary()           // 首尾+最长句
        → canonStore.writeback()
          → IPC db:canon-writeback-atomic
          → CanonRepository.writebackAtomically()  // 单次事务
            1. 清本章 timeline + facts + fact_usage
            2. 写入新 timeline events
            3. upsert 角色状态（knowledge union merge）
            4. 追加/推进/解决剧情线
            5. 写入新 facts（INSERT OR IGNORE）
            6. 冲突检测 + 标记 contradicted
            7. recordFactUsage() — 本章沿用了哪些既有事实
            8. 影响候选：消失事实 + 被引用的后续章节
    步骤4: (每5章) canon_compression  // ⚠️ 写入 chapter_number=-1，无人读取
    步骤5: character_cards            // LLM 更新角色卡（critical: false）
    步骤6: (每5章) style_analysis
```

**结论：定稿写回链路基本完整，但存在关键缺陷（见下文）。**

### 1.3 拆书创作链路（reconstruct）

```
generateDraftSegments()                // draft-service.ts:99
  → loadChapterCanon()                 // canon-adapter.ts:28
    → canonStore.getTimeline()         // 独立 IPC 调用
    → canonStore.getFacts()            // 独立 IPC 调用
    → buildCanonContext()              // ⚠️ 再次 IPC 调用，数据重复获取
    → filterRelevantFacts()            // 按关键词过滤事实
  → buildBeatDraftPrompt()             // 逐节点生成
  → saveAsDraft()                      // 落库（不覆盖已有正文）
```

**结论：拆书链路的 Canon 注入可用，但与正常生成链路重复获取数据。**

---

## 二、问题清单

### P0 级（高优先级 — 影响记忆系统核心功能）

| # | 问题 | 文件:行号 | 原因 | 影响 |
|---|------|-----------|------|------|
| P0-1 | **角色知识（knowledge）从未被提取** | `fact-extractor.ts:111-172` | `extractCharacterDeltas()` 从不写入 `after.knowledge` | 验证器的知识越权检查（`checkKnowledgeAuthorization`）永远无法正确判断，因为 knowledge 列表始终为空 |
| P0-2 | **canon_writeback 步骤非关键步骤** | `finalize-chapter.command.ts:228` | `critical: false` | 写回失败时管道继续执行，记忆丢失且无重试 |
| P0-3 | **提取失败被静默吞掉** | `fact-extractor.ts:417-424` | `extractAndWriteback()` catch all → `{ ok: false }` → 只 log 不重试 | 空结果被当成"提取成功但没提取到东西" |
| P0-4 | **事实引用匹配过于保守** | `canon-repository.ts:736-758` | `recordFactUsage()` 只用 evidence/statement 精确子串匹配 | 中文改写/同义表达几乎全部漏记，影响分析链路断裂 |
| P0-5 | **事实注入无优先级排序** | `context-builder.ts:300-313` | `formatFacts()` 取 `slice(-30)`（最近30条） | 长篇小说中早期关键设定事实被挤掉 |
| P0-6 | **压缩摘要写入 chapter_number=-1** | `finalize-chapter.command.ts:315` | hack 式存储 | `getSummariesUpTo()` 查询 `WHERE chapter_number <= ?` 会包含 -1，污染时间线 |
| P0-7 | **摘要提取策略粗糙** | `fact-extractor.ts:317-330` | `extractSummary()` 取首句+最长2句+末句 | 丢失剧情结构、角色弧光、关键揭示 |
| P0-8 | **无上下文注入清单** | `context-builder.ts:329-379` | `buildCanonContext()` 不记录注入来源、截断情况、排除原因 | 无法审计"为什么这章没记住某个事实" |
| P0-9 | **事实提取模式覆盖面极窄** | `fact-extractor.ts:268-311` | 只匹配 "X是Y"、"X位于Y"、"X拥有Y"、"X与Y是Z" | 世界规则、魔法体系、能力限制、势力关系等几乎全部遗漏 |

### P1 级（中优先级 — 影响长篇场景下的记忆质量）

| # | 问题 | 文件:行号 | 原因 | 影响 |
|---|------|-----------|------|------|
| P1-1 | **canon-adapter 重复获取数据** | `canon-adapter.ts:34-42` | `loadChapterCanon()` 先独立 IPC 获取 timeline/states/plotLines/facts/summaries，再调 `buildCanonContext()` 又获取一遍 | IPC 翻倍，影响生成速度 |
| P1-2 | **非生成命令不做 Canon 过滤** | `finalize-chapter.command.ts:561`、`refine-draft.command.ts:70`、`review-chapter.command.ts:66` | 这些命令调 `buildCanonContext()` 但不做 `buildPromptCanon()` 过滤 | 长篇小说上下文爆炸 |
| P1-3 | **事实冲突检测过于保守** | `fact-conflict.ts:49-62` | 只检测：同类别+共享角色+一方有否定线索+Jaccard≥0.5 | 同义不同字的矛盾完全无法检测 |
| P1-4 | **伏笔无过期检测** | `context-builder.ts:349` | `getActivePlotLines()` 只取 `status='active'`，不检测长期未推进 | 第1章埋的伏笔到第200章仍在注入，但无提醒"该回收了" |
| P1-5 | **时间线全量注入（非生成场景）** | `context-builder.ts:330-334` | `timelineWindow` 默认 = `chapterNumber - 1`，获取全部历史事件 | 定稿/审稿场景下长篇时间线撑爆上下文 |

### P2 级（低优先级 — 代码质量与可维护性）

| # | 问题 | 文件:行号 | 原因 |
|---|------|-----------|------|
| P2-1 | evidence 被截断为 500 字符 | `canon-repository.ts:647` | `fact.evidence.slice(0, 500)` 可能截断关键原文 |
| P2-2 | 角色状态 knowledge 只做 union 不做过期 | `canon-repository.ts:295-298` | 角色遗忘了某信息后无法从 knowledge 列表移除 |
| P2-3 | extractSummary 硬编码 300 字截断 | `fact-extractor.ts:329` | `.slice(0, 300)` 可能截断关键信息 |
| P2-4 | 物品台账只取最近 20 件 | `context-builder.ts:291` | `byItem.entries().slice(-20)` 早期重要道具被丢弃 |

---

## 三、现有测试覆盖分析

### 已有测试
- `narrative-consistency.test.ts`：验证器单元测试（地点连续性、知识越权、关系连续性、时间线、rewrite 安全性、物品归属）
- `standalone.test.ts`：提取器与解析器单元测试
- `chapter-notes-parse.test.ts`：章节要点解析测试
- `perf-regression.test.ts`：性能回归测试

### 缺失的测试场景（需求第三节要求）
| 测试场景 | 是否覆盖 | 说明 |
|----------|----------|------|
| 相隔数百章的事件仍能被正确检索 | ❌ | 无跨章节检索测试 |
| 角色不会知道自己尚未获知的秘密 | ❌ | 只有单元测试，无端到端 |
| 已死亡角色不会无故复活 | ❌ | `checkRewriteFactSafety` 有单元测试，但无端到端 |
| 重要物品不会凭空出现/消失/转移 | ❌ | 无物品流转端到端测试 |
| 已确认的世界规则不会被覆盖 | ❌ | 无世界规则覆盖测试 |
| 长期伏笔不因最近未提及而被遗忘 | ❌ | 无伏笔持久性测试 |
| 修改历史章节后能识别受影响的后续剧情 | ❌ | `buildImpactReport` 有单元测试，但无端到端 |
| 记忆提取失败时不静默当作成功 | ❌ | 无失败处理测试 |

---

## 四、闭环完整性评估

| 环节 | 状态 | 说明 |
|------|------|------|
| 定稿写入 | ⚠️ 基本可用 | 链路完整但 writeback 步骤非 critical，失败静默丢失 |
| 持久化 | ✅ 可用 | SQLite 事务，schema 迁移兼容旧库 |
| 检索 | ⚠️ 有缺陷 | 事实按关键词过滤，无相关性排序；时间线全量获取 |
| 生成前注入 | ✅ 可用 | 生成命令做了 `buildPromptCanon()` 过滤 |
| 生成后更新 | ❌ 不完整 | 草稿生成不触发写回，只有定稿才写回（设计如此，但草稿生成的一致性检查用的 canon 可能已过期） |
| 知识提取 | ❌ 严重缺陷 | knowledge 从不被提取，导致知识越权检查形同虚设 |
