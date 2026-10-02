/**
 * ChapterRollbackRepository — 定稿前动态设定快照。
 *
 * 定稿后处理会改角色动态状态、时间线、事实、剧情线、摘要和章节要点。
 * 解除定稿或重置章节时，从定稿前快照恢复这些内容，避免留下“幽灵设定”。
 */
import { gzipSync, gunzipSync } from 'node:zlib'
import { getProjectDb } from '../database'

interface ChapterRollbackPayload {
  version: 1
  chapterNumber: number
  capturedAt: string
  blueprintNotes: { notes: string; notesUpdatedAt: string } | null
  projectWritingStyle: string | null
  characters: Record<string, unknown>[]
  canonTimeline: Record<string, unknown>[]
  canonCharacterState: Record<string, unknown>[]
  canonPlotLines: Record<string, unknown>[]
  canonFacts: Record<string, unknown>[]
  canonSummaries: Record<string, unknown>[]
  summarySnapshots: Record<string, unknown>[]
}

function insertRows(
  db: ReturnType<typeof getProjectDb>,
  table: string,
  rows: Record<string, unknown>[],
): void {
  if (!db || rows.length === 0) return
  const columnNames = Object.keys(rows[0])
  if (columnNames.length === 0) return
  const columns = columnNames.map(name => `"${name}"`).join(', ')
  const placeholders = columnNames.map(() => '?').join(', ')
  const statement = db.prepare(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`)
  for (const row of rows) {
    statement.run(...columnNames.map(name => row[name] ?? null))
  }
}

export class ChapterRollbackRepository {
  /** 在正式定稿写入前保存当前动态设定。 */
  static capture(chapterNumber: number): { success: boolean; size: number } {
    const db = getProjectDb()
    if (!db) throw new Error('[ChapterRollbackRepository] 数据库未连接')

    const blueprint = db.prepare(`
      SELECT notes, notes_updated_at FROM blueprints WHERE chapter_number = ?
    `).get(chapterNumber) as { notes?: string; notes_updated_at?: string } | undefined
    const projectCore = db.prepare(
      'SELECT writing_style FROM project_core WHERE id = ?'
    ).get('main') as { writing_style?: string } | undefined
    const payload: ChapterRollbackPayload = {
      version: 1,
      chapterNumber,
      capturedAt: new Date().toISOString(),
      blueprintNotes: blueprint
        ? { notes: blueprint.notes ?? '', notesUpdatedAt: blueprint.notes_updated_at ?? '' }
        : null,
      projectWritingStyle: projectCore?.writing_style ?? null,
      characters: db.prepare('SELECT * FROM characters').all() as Record<string, unknown>[],
      canonTimeline: db.prepare(
        'SELECT * FROM canon_timeline_events WHERE chapter_number = ?'
      ).all(chapterNumber) as Record<string, unknown>[],
      canonCharacterState: db.prepare('SELECT * FROM canon_character_state').all() as Record<string, unknown>[],
      canonPlotLines: db.prepare('SELECT * FROM canon_plot_lines').all() as Record<string, unknown>[],
      canonFacts: db.prepare(
        'SELECT * FROM canon_facts WHERE introduced_at = ?'
      ).all(chapterNumber) as Record<string, unknown>[],
      canonSummaries: db.prepare(
        'SELECT * FROM canon_chapter_summaries WHERE chapter_number = ? OR chapter_number = -1'
      ).all(chapterNumber) as Record<string, unknown>[],
      summarySnapshots: db.prepare(
        'SELECT * FROM summary_snapshots WHERE chapter_number = ?'
      ).all(chapterNumber) as Record<string, unknown>[],
    }

    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
    db.prepare(`
      INSERT INTO chapter_rollback_snapshots (chapter_number, created_at, payload)
      VALUES (?, datetime('now'), ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        created_at = excluded.created_at,
        payload = excluded.payload
    `).run(chapterNumber, compressed)

    return { success: true, size: compressed.length }
  }

  static hasSnapshot(chapterNumber: number): boolean {
    const db = getProjectDb()
    if (!db) return false
    return !!db.prepare(
      'SELECT 1 FROM chapter_rollback_snapshots WHERE chapter_number = ?'
    ).get(chapterNumber)
  }

  /** 恢复定稿前动态设定；快照保留给后续整章重置使用，下次定稿时覆盖。 */
  static restore(chapterNumber: number): { restored: boolean; size: number } {
    const db = getProjectDb()
    if (!db) throw new Error('[ChapterRollbackRepository] 数据库未连接')

    const row = db.prepare(
      'SELECT payload FROM chapter_rollback_snapshots WHERE chapter_number = ?'
    ).get(chapterNumber) as { payload: Buffer } | undefined
    if (!row) return { restored: false, size: 0 }

    const payload = JSON.parse(
      gunzipSync(Buffer.from(row.payload)).toString('utf8')
    ) as ChapterRollbackPayload
    if (payload.version !== 1 || payload.chapterNumber !== chapterNumber) {
      throw new Error('章节回滚快照格式不兼容。')
    }

    const tx = db.transaction(() => {
      if (payload.blueprintNotes) {
        db.prepare(`
          UPDATE blueprints
          SET notes = ?, notes_updated_at = ?, updated_at = datetime('now')
          WHERE chapter_number = ?
        `).run(payload.blueprintNotes.notes, payload.blueprintNotes.notesUpdatedAt, chapterNumber)
      }
      if (payload.projectWritingStyle !== null) {
        db.prepare(`
          UPDATE project_core SET writing_style = ?, updated_at = datetime('now') WHERE id = 'main'
        `).run(payload.projectWritingStyle)
      }

      const snapshotNames = new Set(payload.characters.map(row => String(row.name ?? '')))
      const currentCharacters = db.prepare('SELECT name FROM characters').all() as Array<{ name: string }>
      const deleteCharacter = db.prepare('DELETE FROM characters WHERE name = ?')
      for (const current of currentCharacters) {
        if (!snapshotNames.has(current.name)) deleteCharacter.run(current.name)
      }

      const updateCharacterState = db.prepare(`
        UPDATE characters SET
          cs_location = ?, cs_power_level = ?, cs_physical_state = ?,
          cs_mental_state = ?, cs_key_items = ?, cs_recent_events = ?,
          cs_updated_at_chapter = ?, updated_at = ?
        WHERE name = ?
      `)
      const existingNames = new Set(
        (db.prepare('SELECT name FROM characters').all() as Array<{ name: string }>).map(row => row.name)
      )
      for (const character of payload.characters) {
        const name = String(character.name ?? '')
        if (!name) continue
        if (!existingNames.has(name)) {
          insertRows(db, 'characters', [character])
          continue
        }
        updateCharacterState.run(
          character.cs_location ?? '',
          character.cs_power_level ?? '',
          character.cs_physical_state ?? '',
          character.cs_mental_state ?? '',
          character.cs_key_items ?? '',
          character.cs_recent_events ?? '',
          character.cs_updated_at_chapter ?? 0,
          character.updated_at ?? new Date().toISOString(),
          name,
        )
      }

      db.prepare('DELETE FROM canon_character_state').run()
      insertRows(db, 'canon_character_state', payload.canonCharacterState)

      db.prepare('DELETE FROM canon_plot_lines').run()
      insertRows(db, 'canon_plot_lines', payload.canonPlotLines)

      db.prepare('DELETE FROM canon_timeline_events WHERE chapter_number = ?').run(chapterNumber)
      insertRows(db, 'canon_timeline_events', payload.canonTimeline)

      db.prepare('DELETE FROM canon_facts WHERE introduced_at = ?').run(chapterNumber)
      insertRows(db, 'canon_facts', payload.canonFacts)

      db.prepare('DELETE FROM canon_chapter_summaries WHERE chapter_number = ? OR chapter_number = -1').run(chapterNumber)
      insertRows(db, 'canon_chapter_summaries', payload.canonSummaries)

      db.prepare('DELETE FROM summary_snapshots WHERE chapter_number = ?').run(chapterNumber)
      insertRows(db, 'summary_snapshots', payload.summarySnapshots)

    })
    tx()
    return { restored: true, size: Buffer.byteLength(JSON.stringify(payload), 'utf8') }
  }

  static clear(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM chapter_rollback_snapshots WHERE chapter_number = ?').run(chapterNumber)
  }
}
