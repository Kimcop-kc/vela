/**
 * 草稿状态标签/颜色完整性护栏
 *
 * 这两个 Map 是「状态 → 界面显示」的唯一映射，被 Sidebar、DraftEditor 等多处共用。
 * 新增一个 DraftStatus 却忘了补映射时，界面上会显示成空白或 undefined 而不是报错，
 * 所以这里用 DraftStatus 的完整清单反向校验两张表都齐全。
 */
import { describe, expect, it } from 'vitest'
import { DRAFT_STATUS_COLOR, DRAFT_STATUS_LABEL } from '../../shared/draft-status'
import type { DraftStatus } from '../../shared/draft-status'

/** 与 DraftStatus 类型保持一致的完整清单（新增状态时这里会先失败，提醒补映射） */
const ALL_STATUSES: DraftStatus[] = ['draft', 'revised', 'reviewed', 'finalized', 'archived']

describe('草稿状态映射', () => {
  it('每个状态都有非空的中文标签', () => {
    for (const status of ALL_STATUSES) {
      const label = DRAFT_STATUS_LABEL[status]
      expect(label, `缺少 ${status} 的标签`).toBeTruthy()
      expect(label.trim().length).toBeGreaterThan(0)
      // 未命中 i18n key 时 i18next 会原样回显 key，等于界面上显示英文 key
      expect(label).not.toContain('draftStatus.')
    }
  })

  it('每个状态都有显示颜色，且全部使用主题变量或合法色值', () => {
    for (const status of ALL_STATUSES) {
      const color = DRAFT_STATUS_COLOR[status]
      expect(color, `缺少 ${status} 的颜色`).toBeTruthy()
      expect(color).toMatch(/^(var\(--[\w-]+\)|#[0-9a-fA-F]{3,8})$/)
    }
  })

  it('标签两两不同，避免两个状态在界面上长得一样', () => {
    const labels = ALL_STATUSES.map(status => DRAFT_STATUS_LABEL[status])
    expect(new Set(labels).size).toBe(ALL_STATUSES.length)
  })
})
