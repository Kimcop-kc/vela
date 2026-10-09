/**
 * 事实冲突检测单测（保守策略：宁可漏判，也不制造噪音）
 */
import { describe, expect, it } from 'vitest'
import { detectFactConflict } from '../narrative-consistency/fact-conflict'

describe('detectFactConflict', () => {
  it('同类别 + 共享角色 + 一方否定 + 高重合 → 判为冲突', () => {
    const conflict = detectFactConflict(
      { category: 'event', statement: '云玉辞知道封泥底下的秘密', characters: ['云玉辞'] },
      { category: 'event', statement: '云玉辞不知道封泥底下的秘密', characters: ['云玉辞'] },
    )
    expect(conflict).not.toBeNull()
    expect(conflict!.reason).toContain('云玉辞')
  })

  it('类别不同不判冲突', () => {
    const conflict = detectFactConflict(
      { category: 'event', statement: '云玉辞知道封泥底下的秘密', characters: ['云玉辞'] },
      { category: 'item', statement: '云玉辞不知道封泥底下的秘密', characters: ['云玉辞'] },
    )
    expect(conflict).toBeNull()
  })

  it('没有共同角色不判冲突', () => {
    const conflict = detectFactConflict(
      { category: 'event', statement: '云玉辞知道封泥底下的秘密', characters: ['云玉辞'] },
      { category: 'event', statement: '周德不知道封泥底下的秘密', characters: ['周德'] },
    )
    expect(conflict).toBeNull()
  })

  it('双方都带否定不判冲突', () => {
    const conflict = detectFactConflict(
      { category: 'event', statement: '云玉辞不知道这个方向', characters: ['云玉辞'] },
      { category: 'event', statement: '云玉辞没有记住这个方向', characters: ['云玉辞'] },
    )
    expect(conflict).toBeNull()
  })

  it('文字重合度低时不误判', () => {
    const conflict = detectFactConflict(
      { category: 'event', statement: '云玉辞在井台发现逆旋纹', characters: ['云玉辞'] },
      { category: 'event', statement: '云玉辞不知道周德会来', characters: ['云玉辞'] },
    )
    expect(conflict).toBeNull()
  })
})
