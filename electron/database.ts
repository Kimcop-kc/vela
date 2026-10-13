/**
 * Vela SQLite 数据库服务 — 主进程使用
 *
 * 负责 SQLite 实例的连接、生命周期与建表。
 * 具体业务逻辑由 /repositories 提供。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
import type BetterSqlite3 from 'better-sqlite3'

let projectDb: BetterSqlite3.Database | null = null
let currentProjectPath: string | null = null

/** 初始化项目数据库（打开项目时调用） */
export function initProjectDatabase(projectPath: string): void {
  closeProjectDatabase()

  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  projectDb = new Database(dbPath)
  currentProjectPath = projectPath
  projectDb.pragma('journal_mode = WAL')
  projectDb.pragma('foreign_keys = ON')

  // 创建表结构
  createTables(projectDb)
  // 对老库执行 schema 迁移（加 UNIQUE 约束等）
  migrateProjectDatabase(projectDb)
  console.log(`[Vela DB] 项目数据库已打开: ${dbPath}`)
}

/** 关闭项目数据库 */
export function closeProjectDatabase(): void {
  if (projectDb) {
    projectDb.close()
    projectDb = null
  }
  currentProjectPath = null
}

/** 当前已打开项目路径；供需要清理项目投影文件的主进程服务使用。 */
export function getCurrentProjectPath(): string | null {
  return currentProjectPath
}

/** 已执行的 schema 迁移版本号（用于幂等迁移） */
const SCHEMA_VERSION = 11

/**
 * 拆书创作系统的三张表（迁移与建表共用同一份 SQL，避免两处漂移）。
 *
 * - book_analyses：参考小说逐章分析结论。唯一索引保证「同一本书同一章只留一条」，
 *   重新分析即覆盖，不会因为中途失败或重复点击堆出一堆半成品。
 * - plot_outlines：原创剧情大纲（含可编辑的剧情节点 JSON）。
 * - similarity_reports：相似度检查报告（只作提示，不作结论）。
 */
const RECONSTRUCT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS book_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    book_name TEXT DEFAULT '',
    chapter_number INTEGER NOT NULL,
    chapter_title TEXT DEFAULT '',
    doc_id TEXT DEFAULT '',
    analysis_type TEXT NOT NULL DEFAULT 'chapter',
    status TEXT NOT NULL DEFAULT 'done',
    result_json TEXT NOT NULL DEFAULT '{}',
    model_id TEXT DEFAULT '',
    error TEXT DEFAULT '',
    source_hash TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_book_analyses_target
    ON book_analyses(book_id, chapter_number, analysis_type);
  CREATE INDEX IF NOT EXISTS idx_book_analyses_book ON book_analyses(book_id, chapter_number);

  CREATE TABLE IF NOT EXISTS plot_outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    premise TEXT DEFAULT '',
    protagonist_goal TEXT DEFAULT '',
    central_conflict TEXT DEFAULT '',
    character_changes TEXT DEFAULT '',
    foreshadowing TEXT DEFAULT '',
    continuity_notes TEXT DEFAULT '',
    originality_notes TEXT DEFAULT '',
    techniques_json TEXT NOT NULL DEFAULT '[]',
    beats_json TEXT NOT NULL DEFAULT '[]',
    sources_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_plot_outlines_status ON plot_outlines(status, id);

  CREATE TABLE IF NOT EXISTS similarity_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_number INTEGER,
    draft_id INTEGER,
    outline_id INTEGER,
    book_ids TEXT DEFAULT '',
    overall_risk TEXT NOT NULL DEFAULT 'undetermined',
    report_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_similarity_reports_chapter ON similarity_reports(chapter_number, id);
`

/** 对老库执行 schema 迁移（加 UNIQUE/CHECK 约束等） */
function migrateProjectDatabase(db: BetterSqlite3.Database): void {
  const currentVersionRow = db.prepare(
    `PRAGMA user_version`
  ).get() as { user_version: number } | undefined
  const currentVersion = currentVersionRow?.user_version ?? 0
  if (currentVersion >= SCHEMA_VERSION) return

  // v0 → v1: 给 canon 表加约束（仅当索引不存在时）
  if (currentVersion < 1) {
    const timelineUnique = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_canon_timeline_unique'`
    ).get()
    if (!timelineUnique) {
      // 注意：先尝试 CREATE UNIQUE INDEX；若有重复数据会失败，需要清理
      try {
        // 清理重复 sequence，保留 id 最小的那条
        db.exec(`
          DELETE FROM canon_timeline_events
          WHERE id NOT IN (
            SELECT MIN(id) FROM canon_timeline_events
            GROUP BY chapter_number, sequence
          )
        `)
        db.exec(`CREATE UNIQUE INDEX idx_canon_timeline_unique ON canon_timeline_events(chapter_number, sequence)`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_timeline unique 约束失败（可能存在冲突数据）:', e)
      }
    }
    const factsUnique = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_canon_facts_unique'`
    ).get()
    if (!factsUnique) {
      try {
        db.exec(`
          DELETE FROM canon_facts
          WHERE id NOT IN (
            SELECT MIN(id) FROM canon_facts
            WHERE statement IS NOT NULL AND statement != ''
            GROUP BY LOWER(TRIM(statement))
          )
        `)
        db.exec(`CREATE UNIQUE INDEX idx_canon_facts_unique ON canon_facts(statement COLLATE NOCASE)`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts unique 约束失败:', e)
      }
    }
    const plotUnique = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_canon_plot_unique'`
    ).get()
    if (!plotUnique) {
      try {
        db.exec(`
          DELETE FROM canon_plot_lines
          WHERE id NOT IN (
            SELECT MIN(id) FROM canon_plot_lines
            GROUP BY LOWER(TRIM(name))
          )
        `)
        db.exec(`CREATE UNIQUE INDEX idx_canon_plot_unique ON canon_plot_lines(name COLLATE NOCASE)`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_plot unique 约束失败:', e)
      }
    }
  }
  // v1 → v2: canon_facts 增加 status 列（记忆状态：active / outdated / contradicted / tentative）
  if (currentVersion < 2) {
    const columns = db.prepare('PRAGMA table_info(canon_facts)').all() as Array<{ name: string }>
    if (!columns.some(column => column.name === 'status')) {
      try {
        db.exec(`ALTER TABLE canon_facts ADD COLUMN status TEXT DEFAULT 'active'`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts.status 列失败:', e)
      }
    }
  }
  // v2 → v3: 事实作者确认（confirmed_at）与变更时间（updated_at）+ 事实变更历史表
  if (currentVersion < 3) {
    const columns = db.prepare('PRAGMA table_info(canon_facts)').all() as Array<{ name: string }>
    const hasColumn = (name: string) => columns.some(column => column.name === name)
    if (!hasColumn('updated_at')) {
      try {
        db.exec(`ALTER TABLE canon_facts ADD COLUMN updated_at TEXT`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts.updated_at 列失败:', e)
      }
    }
    if (!hasColumn('confirmed_at')) {
      try {
        // NULL 表示「AI 提取、尚未经作者确认」
        db.exec(`ALTER TABLE canon_facts ADD COLUMN confirmed_at TEXT`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts.confirmed_at 列失败:', e)
      }
    }
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_fact_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fact_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          before_json TEXT DEFAULT '',
          after_json TEXT DEFAULT '',
          at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_fact_history_fact ON canon_fact_history(fact_id, id);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_fact_history 表失败:', e)
    }
  }
  // v3 → v4: 剧情线区分「剧情线 / 伏笔」，并记录伏笔的预计回收阶段
  if (currentVersion < 4) {
    const columns = db.prepare('PRAGMA table_info(canon_plot_lines)').all() as Array<{ name: string }>
    const hasColumn = (name: string) => columns.some(column => column.name === name)
    if (!hasColumn('kind')) {
      try {
        db.exec(`ALTER TABLE canon_plot_lines ADD COLUMN kind TEXT DEFAULT 'plot'`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_plot_lines.kind 列失败:', e)
      }
    }
    if (!hasColumn('planned_resolve_at')) {
      try {
        // 文本而非章节号：作者可能只想写「中期 / 第三卷末」这类阶段
        db.exec(`ALTER TABLE canon_plot_lines ADD COLUMN planned_resolve_at TEXT DEFAULT ''`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_plot_lines.planned_resolve_at 列失败:', e)
      }
    }
  }
  // v4 → v5: 事实引用关系（哪一章用了哪条既有事实）—— 修改影响分析的数据基础
  if (currentVersion < 5) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_fact_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fact_id INTEGER NOT NULL,
          chapter_number INTEGER NOT NULL,
          evidence TEXT DEFAULT '',
          used_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_fact_usage_fact ON canon_fact_usage(fact_id, chapter_number);
        CREATE INDEX IF NOT EXISTS idx_canon_fact_usage_chapter ON canon_fact_usage(chapter_number);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_fact_usage 表失败:', e)
    }
  }
  // v5 → v6: 物品流转台账（获得 / 转交 / 丢失 / 损毁 / 消耗），防止道具凭空出现或消失
  if (currentVersion < 6) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_item_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item TEXT NOT NULL,
          action TEXT NOT NULL,
          chapter_number INTEGER DEFAULT 0,
          actor TEXT DEFAULT '',
          note TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_item_events_item ON canon_item_events(item COLLATE NOCASE, chapter_number);
        CREATE INDEX IF NOT EXISTS idx_canon_item_events_chapter ON canon_item_events(chapter_number);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_item_events 表失败:', e)
    }
  }
  // v6 → v7: 境界阶梯（能力范围 / 限制 / 突破条件），生成战斗与突破时据此约束
  if (currentVersion < 7) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_realms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rank_order INTEGER DEFAULT 0,
          abilities TEXT DEFAULT '',
          limits TEXT DEFAULT '',
          breakthrough TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_realms_rank ON canon_realms(rank_order, id);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_realms 表失败:', e)
    }
  }
  // v7 → v8: 地点与空间关系（区域 / 势力 / 距离 / 通行耗时），避免人物凭空出现在远处
  if (currentVersion < 8) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          region TEXT DEFAULT '',
          faction TEXT DEFAULT '',
          distance_note TEXT DEFAULT '',
          travel_note TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_locations_name ON canon_locations(name COLLATE NOCASE);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_locations 表失败:', e)
    }
  }
  // v8 → v9: 拆书创作系统（逐章分析 / 原创剧情大纲 / 相似度报告）
  if (currentVersion < 9) {
    try {
      db.exec(RECONSTRUCT_SCHEMA_SQL)
    } catch (e) {
      console.warn('[Vela DB] 创建拆书创作系统表失败:', e)
    }
  }
  // v9 → v10: 第二阶段分层记忆与精准检索
  //   - canon_character_state_history: 角色状态历史链（每次写回留痕，不覆盖）
  //   - canon_arcs: 分卷/阶段记忆（卷名、起止章、本卷矛盾/人物发展/阶段性目标）
  //   - canon_facts 增加 source_paragraph_index（事实在原文章节中的段落定位）
  //   - canon_facts 增加 arc_id（所属分卷，可空）
  //   - characters 增加 aliases_json（别名/称谓数组）
  if (currentVersion < 10) {
    // 角色状态历史链
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_character_state_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character TEXT NOT NULL,
          chapter_number INTEGER NOT NULL,
          snapshot_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_csh_char_ch
          ON canon_character_state_history(character, chapter_number);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_character_state_history 表失败:', e)
    }
    // 分卷/阶段记忆
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canon_arcs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          start_chapter INTEGER DEFAULT 0,
          end_chapter INTEGER DEFAULT 0,
          main_conflict TEXT DEFAULT '',
          character_development TEXT DEFAULT '',
          key_events TEXT DEFAULT '',
          stage_goal TEXT DEFAULT '',
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_canon_arcs_range
          ON canon_arcs(start_chapter, end_chapter);
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 canon_arcs 表失败:', e)
    }
    // canon_facts 增加段落定位和分卷关联
    const factCols = db.prepare('PRAGMA table_info(canon_facts)').all() as Array<{ name: string }>
    const hasFactCol = (name: string) => factCols.some(c => c.name === name)
    if (!hasFactCol('source_paragraph_index')) {
      try {
        db.exec(`ALTER TABLE canon_facts ADD COLUMN source_paragraph_index INTEGER DEFAULT -1`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts.source_paragraph_index 列失败:', e)
      }
    }
    if (!hasFactCol('arc_id')) {
      try {
        db.exec(`ALTER TABLE canon_facts ADD COLUMN arc_id INTEGER DEFAULT NULL`)
      } catch (e) {
        console.warn('[Vela DB] 添加 canon_facts.arc_id 列失败:', e)
      }
    }
    // characters 增加别名/称谓
    const charCols = db.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>
    if (!charCols.some(c => c.name === 'aliases_json')) {
      try {
        db.exec(`ALTER TABLE characters ADD COLUMN aliases_json TEXT DEFAULT '[]'`)
      } catch (e) {
        console.warn('[Vela DB] 添加 characters.aliases_json 列失败:', e)
      }
    }
  }
  // v10 → v11: 第四阶段写作流水线任务状态
  //   - writing_pipeline: 按章节保存流水线任务（策划、场景、分段状态与错误信息），
  //     用于「中途关闭程序后恢复生成」；一个章节一行，避免多行互相覆盖。
  if (currentVersion < 11) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS writing_pipeline (
          chapter_number INTEGER PRIMARY KEY,
          outline_id INTEGER DEFAULT 0,
          outline_fingerprint TEXT DEFAULT '',
          mode TEXT DEFAULT 'outline-expand',
          target_words INTEGER DEFAULT 0,
          plan_json TEXT DEFAULT '{}',
          scenes_json TEXT DEFAULT '[]',
          segments_json TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `)
    } catch (e) {
      console.warn('[Vela DB] 创建 writing_pipeline 表失败:', e)
    }
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

/** 获取当前数据库实例 */
export function getProjectDb(): BetterSqlite3.Database | null {
  return projectDb
}

/** 创建完整表结构（9 张核心表 + 2 张沿用表） */
function createTables(db: BetterSqlite3.Database) {
  db.exec(`
    -- ============================================================
    -- 1. project_core — 项目主台账（NovelConfig + 架构四大件）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS project_core (
      id TEXT PRIMARY KEY DEFAULT 'main',
      project_name TEXT NOT NULL DEFAULT '',      -- 小说工程名
      -- [基础定位]
      genre TEXT DEFAULT '',                      -- 核心流派
      sub_genre TEXT DEFAULT '',                  -- 细分流派
      target_audience TEXT DEFAULT '',            -- 目标受众
      total_chapters INTEGER DEFAULT 100,         -- 预计总章数
      words_per_chapter INTEGER DEFAULT 3000,     -- 单章基准字数
      -- [写作技法]
      plot_structure TEXT DEFAULT 'three_act',    -- 故事模型
      narrative_pov TEXT DEFAULT 'third_limited', -- 叙事视角
      writing_style TEXT DEFAULT '',              -- 文风描述
      reference_works TEXT DEFAULT '',            -- 参考作品
      global_guidance TEXT DEFAULT '',            -- 全局行文指导
      golden_finger TEXT DEFAULT '',              -- 金手指设定
      -- [架构四大件]
      premise TEXT DEFAULT '',                    -- 故事前提
      worldbuilding TEXT DEFAULT '',              -- 世界观
      characters_arch TEXT DEFAULT '',            -- 人物群像网络
      synopsis TEXT DEFAULT '',                   -- 情节总大纲
      -- [系统缓存]
      character_states TEXT DEFAULT '',           -- 全书角色动态快照
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 2. blueprints — 章节蓝图
    -- ============================================================
    CREATE TABLE IF NOT EXISTS blueprints (
      chapter_number INTEGER PRIMARY KEY,         -- 章节序号
      title TEXT NOT NULL DEFAULT '',             -- 章节标题
      role TEXT DEFAULT '',                       -- 章节角色
      purpose TEXT DEFAULT '',                    -- 核心目的
      key_events TEXT DEFAULT '',                 -- 关键事件
      characters TEXT DEFAULT '[]',               -- 出场角色 (JSON Array)
      suspense_hook TEXT DEFAULT '',              -- 悬念钩子
      user_guidance TEXT DEFAULT '',              -- 用户预设指导
      notes TEXT DEFAULT '',                      -- 后处理提取的章节要点
      notes_updated_at TEXT DEFAULT '',           -- notes 提取时间
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 3. characters — 角色卡（currentState 拍平为 cs_* 列）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS characters (
      name TEXT PRIMARY KEY,                      -- 角色名
      role TEXT DEFAULT 'supporting',             -- protagonist/antagonist/supporting/minor
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      appearance TEXT DEFAULT '',                 -- 外貌
      personality TEXT DEFAULT '',                -- 性格
      background TEXT DEFAULT '',                 -- 背景
      abilities TEXT DEFAULT '',                  -- 能力
      motivation TEXT DEFAULT '',                 -- 动机
      relationships TEXT DEFAULT '',              -- 关系链
      arc TEXT DEFAULT '',                        -- 弧光
      notes TEXT DEFAULT '',                      -- 备忘录
      cs_location TEXT DEFAULT '',                -- 当前位置
      cs_power_level TEXT DEFAULT '',             -- 修为境界
      cs_physical_state TEXT DEFAULT '',          -- 身体状态
      cs_mental_state TEXT DEFAULT '',            -- 心理状态
      cs_key_items TEXT DEFAULT '',               -- 关键道具
      cs_recent_events TEXT DEFAULT '',           -- 最近事件
      cs_updated_at_chapter INTEGER DEFAULT 0,    -- 状态更新于第几章
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 4. contents — 文本内容池（正文与元数据分离）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL DEFAULT '',              -- 正文/报告内容
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 5. drafts — 草稿主线（finalized = 定稿）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,            -- 归属章节
      version INTEGER NOT NULL,                   -- v1, v2...
      status TEXT DEFAULT 'draft',                -- draft/revised/finalized/archived
      source TEXT DEFAULT 'write',                -- write/rewrite
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_chapter ON drafts(chapter_number);

    -- ============================================================
    -- 6. revisions — 修稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 父草稿 FK
      revision_index INTEGER NOT NULL,            -- r1, r2
      revision_type TEXT NOT NULL,                -- refine | review-fix | deai
      status TEXT DEFAULT 'pending',              -- pending/merged/discarded
      merged_to_draft_id INTEGER,                 -- 合并产出的新 draft
      user_prompt TEXT DEFAULT '',                -- 用户指导
      review_source_id INTEGER,                   -- 关联审稿 ID
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );

    -- ============================================================
    -- 7. reviews — 审稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 审查对象 FK
      review_index INTEGER NOT NULL,              -- 审阅顺位
      content_id INTEGER NOT NULL,                -- FK -> contents
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );

    -- ============================================================
    -- 7.1 chapter_review_digests — 定性审稿摘要（跨次审稿复用的连续性记忆）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS chapter_review_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL UNIQUE,      -- 摘要覆盖到第几章（即本次审稿章节）
      chapter_title TEXT DEFAULT '',
      content TEXT NOT NULL,                       -- 摘要 JSON（时间线摘要/伏笔/未解决观察）
      canon_fingerprint TEXT NOT NULL,             -- 摘要所依赖的 Canon 指纹，用于失效判断
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_review_digests_chapter
      ON chapter_review_digests(chapter_number);

    -- ============================================================
    -- 8. post_process_runs — 后处理跑批实例
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_runs (
      id TEXT PRIMARY KEY,                        -- UUID
      trigger_source_type TEXT NOT NULL,           -- chapter_finalize / arch_extract
      trigger_source_id TEXT NOT NULL,             -- 章节号 / draft_id
      source_label TEXT DEFAULT '',               -- UI 标签
      all_critical_passed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_runs_source
      ON post_process_runs(trigger_source_type, trigger_source_id);

    -- ============================================================
    -- 9. post_process_steps — 后处理步骤明细
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,                       -- FK -> post_process_runs
      step_key TEXT NOT NULL,                     -- 步骤标识
      label TEXT DEFAULT '',                      -- 展示名称
      critical INTEGER DEFAULT 0,                 -- 是否关键步骤
      ok INTEGER DEFAULT 0,                       -- 是否完成
      error_msg TEXT DEFAULT '',
      attempt_count INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT '',
      last_attempt_at TEXT DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES post_process_runs(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- 沿用表：LLM 调用记录
    -- ============================================================
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      model_name TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_message TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 沿用表：角色状态快照
    -- ============================================================
    CREATE TABLE IF NOT EXISTS summary_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      character_states TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 定稿回滚快照 — 记录章节定稿前的动态设定，供解除/重置时恢复
    -- ============================================================
    CREATE TABLE IF NOT EXISTS chapter_rollback_snapshots (
      chapter_number INTEGER PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      payload BLOB NOT NULL
    );

    -- ============================================================
    -- 叙事一致性 (Narrative Consistency) —— Canon Store
    -- ============================================================
    -- 结构化时间线事件
    CREATE TABLE IF NOT EXISTS canon_timeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      characters TEXT DEFAULT '[]',
      location TEXT DEFAULT '',
      time_flow TEXT DEFAULT 'sequential',
      summary TEXT DEFAULT '',
      impact TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_timeline_chapter_seq
      ON canon_timeline_events(chapter_number, sequence);

    -- 角色状态历史（每个角色每个章节一条最新）
    CREATE TABLE IF NOT EXISTS canon_character_state (
      character TEXT PRIMARY KEY,
      location TEXT DEFAULT '',
      power_level TEXT DEFAULT '',
      physical_state TEXT DEFAULT '',
      mental_state TEXT DEFAULT '',
      key_items TEXT DEFAULT '',
      current_goal TEXT DEFAULT '',
      knowledge_json TEXT DEFAULT '[]',
      relationships_json TEXT DEFAULT '{}',
      recent_events TEXT DEFAULT '',
      updated_at_chapter INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 长期未结剧情线
    CREATE TABLE IF NOT EXISTS canon_plot_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      started_at INTEGER DEFAULT 0,
      last_advanced_at INTEGER DEFAULT 0,
      resolved_at INTEGER,
      characters TEXT DEFAULT '[]',
      current_state TEXT DEFAULT '',
      description TEXT DEFAULT '',
      kind TEXT DEFAULT 'plot',                     -- plot=剧情线 / foreshadow=伏笔
      planned_resolve_at TEXT DEFAULT '',           -- 伏笔预计回收阶段（「中期」「第三卷末」这类）
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_plot_status ON canon_plot_lines(status);

    -- 客观事实条目
    CREATE TABLE IF NOT EXISTS canon_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      statement TEXT NOT NULL,
      introduced_at INTEGER DEFAULT 0,
      characters TEXT DEFAULT '[]',
      evidence TEXT DEFAULT '',
      status TEXT DEFAULT 'active',                -- active/outdated/contradicted/tentative
      confirmed_at TEXT,                           -- NULL = AI 提取、未经作者确认
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_facts_category ON canon_facts(category);

    -- 事实变更历史（作者确认 / 改状态 / 写回时留痕）
    CREATE TABLE IF NOT EXISTS canon_fact_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT DEFAULT '',
      after_json TEXT DEFAULT '',
      at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_fact_history_fact ON canon_fact_history(fact_id, id);

    -- 事实引用关系：哪一章沿用了哪条既有事实（写回时按正文匹配落库）
    CREATE TABLE IF NOT EXISTS canon_fact_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      evidence TEXT DEFAULT '',
      used_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_fact_usage_fact ON canon_fact_usage(fact_id, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_canon_fact_usage_chapter ON canon_fact_usage(chapter_number);

    -- 物品流转台账：某件道具在第几章被谁获得 / 转交 / 丢失 / 损毁 / 消耗
    CREATE TABLE IF NOT EXISTS canon_item_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      action TEXT NOT NULL,                -- obtained/transferred/lost/destroyed/consumed
      chapter_number INTEGER DEFAULT 0,
      actor TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_item_events_item ON canon_item_events(item COLLATE NOCASE, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_canon_item_events_chapter ON canon_item_events(chapter_number);

    -- 境界阶梯：各境界的能力范围、限制与突破条件
    CREATE TABLE IF NOT EXISTS canon_realms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rank_order INTEGER DEFAULT 0,        -- 由低到高的阶数
      abilities TEXT DEFAULT '',           -- 该境界能做到什么
      limits TEXT DEFAULT '',              -- 做不到什么 / 代价与限制
      breakthrough TEXT DEFAULT '',        -- 突破所需条件
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_realms_rank ON canon_realms(rank_order, id);

    -- 地点与空间关系：区域归属、势力、与别处的距离、通行方式与耗时
    CREATE TABLE IF NOT EXISTS canon_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      region TEXT DEFAULT '',
      faction TEXT DEFAULT '',
      distance_note TEXT DEFAULT '',        -- 与哪些地方相邻 / 有多远
      travel_note TEXT DEFAULT '',          -- 怎么去、大概要多久
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_locations_name ON canon_locations(name COLLATE NOCASE);

    -- 拆书创作系统：逐章分析 / 原创剧情大纲 / 相似度报告
    ${RECONSTRUCT_SCHEMA_SQL}

    -- 章节摘要（结构化）
    CREATE TABLE IF NOT EXISTS canon_chapter_summaries (
      chapter_number INTEGER PRIMARY KEY,
      title TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_llm_calls_time ON llm_calls(created_at);

    -- ============================================================
    -- 第二阶段分层记忆 (v10)
    -- ============================================================
    -- 角色状态历史链：每次写回留痕，不覆盖
    CREATE TABLE IF NOT EXISTS canon_character_state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_csh_char_ch
      ON canon_character_state_history(character, chapter_number);

    -- 分卷/阶段记忆
    CREATE TABLE IF NOT EXISTS canon_arcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_chapter INTEGER DEFAULT 0,
      end_chapter INTEGER DEFAULT 0,
      main_conflict TEXT DEFAULT '',
      character_development TEXT DEFAULT '',
      key_events TEXT DEFAULT '',
      stage_goal TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canon_arcs_range
      ON canon_arcs(start_chapter, end_chapter);

    -- ============================================================
    -- 第四阶段写作流水线 (v11)
    -- ============================================================
    -- 按章节保存流水线任务：策划、场景设计、分段状态与错误信息。
    -- 一个章节一行，中途关闭程序后可按章节号恢复，不会因为多行而产生覆盖歧义。
    CREATE TABLE IF NOT EXISTS writing_pipeline (
      chapter_number INTEGER PRIMARY KEY,
      outline_id INTEGER DEFAULT 0,
      outline_fingerprint TEXT DEFAULT '',
      mode TEXT DEFAULT 'outline-expand',
      target_words INTEGER DEFAULT 0,
      plan_json TEXT DEFAULT '{}',
      scenes_json TEXT DEFAULT '[]',
      segments_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
}
