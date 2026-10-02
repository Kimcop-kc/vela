export const CHAPTER_ROLE_VALUES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾'] as const

export type ChapterRole = typeof CHAPTER_ROLE_VALUES[number]

const ROLE_ALIASES: Record<string, ChapterRole> = {
  '建置': '建置',
  '开篇': '建置',
  '起': '建置',
  '起势': '建置',
  'setup': '建置',
  '铺垫': '铺垫',
  '过渡': '铺垫',
  '承': '发展',
  '发展': '发展',
  'development': '发展',
  '冲突': '冲突',
  'conflict': '冲突',
  '高潮': '高潮',
  'climax': '高潮',
  '转折': '转折',
  '转': '转折',
  'turning': '转折',
  '收尾': '收尾',
  '结局': '收尾',
  '结尾': '收尾',
  '合': '收尾',
  'resolution': '收尾',
}

/** 统一章节定位；未知值保留原文，避免破坏用户自定义内容。 */
export function normalizeChapterRole(value: unknown): string {
  const role = String(value ?? '').trim()
  return ROLE_ALIASES[role] ?? role
}
