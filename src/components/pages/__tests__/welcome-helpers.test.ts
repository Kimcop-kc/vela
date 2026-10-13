/**
 * 欢迎页纯函数护栏
 *
 * 这两处都直接决定「界面上显示的是不是真数据」：
 *   · shortenPath  —— Windows 与 POSIX 路径都要能正确截断，否则长路径会撑破右栏；
 *   · parseUpdatedAt —— 解析不出来必须返回 null（界面据此不显示时间），
 *                       而不是让 "Invalid Date" 或假的「刚刚」出现在最近项目列表里。
 */
import { describe, expect, it } from 'vitest'
import { parseUpdatedAt, shortenPath } from '../welcome-helpers'

describe('shortenPath：路径截断', () => {
  it('三段以内原样返回', () => {
    expect(shortenPath('/home/user/novels')).toBe('/home/user/novels')
    expect(shortenPath('novels')).toBe('novels')
    expect(shortenPath('')).toBe('')
  })

  it('超过三段只保留尾部三段并加省略号', () => {
    expect(shortenPath('/a/b/c/d/e')).toBe('…/c/d/e')
    expect(shortenPath('/home/user/Documents/vela/my-novel')).toBe('…/Documents/vela/my-novel')
    expect(shortenPath('/home/user/Documents/vela')).toBe('…/user/Documents/vela')
  })

  it('Windows 反斜杠路径与 POSIX 路径行为一致', () => {
    // 4 段：盘符 + 3 级目录 → 截断后保留尾部三段
    expect(shortenPath('C:\\Users\\k\\novels')).toBe('…/Users/k/novels')
    // 3 段：不截断，但仍统一成正斜杠
    expect(shortenPath('C:\\Users\\novels')).toBe('C:/Users/novels')
  })

  it('忽略尾部斜杠，不产生空段', () => {
    expect(shortenPath('/a/b/c/d/')).toBe('…/b/c/d')
    expect(shortenPath('/a/b/c/')).toBe('/a/b/c')
  })
})

describe('parseUpdatedAt：最近打开时间解析', () => {
  it('合法 ISO 串解析出有限时间戳', () => {
    const ts = parseUpdatedAt('2026-10-13T09:00:00.000Z')
    expect(ts).toBe(Date.parse('2026-10-13T09:00:00.000Z'))
  })

  it('空值一律返回 null', () => {
    expect(parseUpdatedAt(null)).toBeNull()
    expect(parseUpdatedAt(undefined)).toBeNull()
    expect(parseUpdatedAt('')).toBeNull()
  })

  it('无法解析的字符串返回 null —— 界面据此不显示时间，而不是显示假信息', () => {
    expect(parseUpdatedAt('not-a-date')).toBeNull()
    expect(parseUpdatedAt('2026-13-45T99:99:99Z')).toBeNull()
  })
})
