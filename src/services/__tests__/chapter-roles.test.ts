import { describe, expect, it } from 'vitest'
import { CHAPTER_ROLE_VALUES, normalizeChapterRole } from '../../shared/chapter-roles'

describe('chapter roles', () => {
  it('keeps the canonical dropdown values stable', () => {
    expect(CHAPTER_ROLE_VALUES).toEqual(['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾'])
  })

  it('normalizes legacy aliases used by older blueprints', () => {
    expect(normalizeChapterRole('开篇')).toBe('建置')
    expect(normalizeChapterRole('结局')).toBe('收尾')
    expect(normalizeChapterRole('过渡')).toBe('铺垫')
    expect(normalizeChapterRole('自定义定位')).toBe('自定义定位')
  })
})
