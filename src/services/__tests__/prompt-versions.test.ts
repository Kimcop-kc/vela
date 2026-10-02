import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-client'
import {
  BUILTIN_PROMPTS,
  ensurePromptsLoaded,
  getPromptTemplate,
  listPromptVersions,
  restorePromptVersion,
  saveCustomPrompt,
} from '../prompt-templates'

const files = new Map<string, string>()
const dirs = new Set<string>()

function parent(path: string): string {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

afterEach(() => {
  files.clear()
  dirs.clear()
  vi.restoreAllMocks()
})

describe('prompt version history', () => {
  it('archives the previous prompt and restores it later', async () => {
    vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      const target = String(args[0] ?? '')
      if (channel === 'config:get-vela-home') return 'C:/vela-home' as never
      if (channel === 'fs:check-exists') return (files.has(target) || dirs.has(target)) as never
      if (channel === 'fs:mkdir') {
        dirs.add(target)
        return { success: true } as never
      }
      if (channel === 'fs:write-file') {
        files.set(target, String(args[1] ?? ''))
        dirs.add(parent(target))
        return { success: true } as never
      }
      if (channel === 'fs:read-file') {
        return { success: files.has(target), content: files.get(target) ?? '' } as never
      }
      if (channel === 'fs:list-dir') {
        const prefix = `${target.replace(/\\/g, '/')}/`
        const children = [...files.keys()]
          .filter(path => path.startsWith(prefix))
          .map(path => ({
            name: path.slice(prefix.length),
            path,
            isDir: false,
            children: [],
          }))
          .filter(item => !item.name.includes('/'))
        return children as never
      }
      return {} as never
    })

    const base = BUILTIN_PROMPTS.find(template => template.key === 'character_dynamics')!
    await saveCustomPrompt({ ...base, content: 'version one', contentLocalized: undefined })
    await saveCustomPrompt({ ...base, content: 'version two', contentLocalized: undefined })

    const versions = await listPromptVersions(base.key, 'global')
    expect(versions).toHaveLength(1)
    expect(versions[0].preview).toContain('version one')

    const restored = await restorePromptVersion(base.key, versions[0].id, 'global')
    expect(restored).toBe(true)
    expect(getPromptTemplate(base.key)?.content).toBe('version one')

    files.set(
      `C:/project/.vela/prompts/${base.key}.json`,
      JSON.stringify({ ...base, content: 'project override', contentLocalized: undefined }),
    )
    dirs.add('C:/project/.vela/prompts')
    await ensurePromptsLoaded('C:/project')
    expect(getPromptTemplate(base.key)?.content).toBe('project override')
  })
})
