/**
 * 提示词占位符防护测试
 *
 * 背景：写作第 1 章时本章蓝图 / 后续章节蓝图 / 作者微操指导没有被赋值，
 * `{{chapter_info}}` 这类占位符原样发给了模型 —— 模型既没有章纲、也没有后续大纲约束，
 * 只能自由发挥（开篇跑偏的直接原因）。这里锁住两条不变量：
 *   1. 任何模板构建完都不能残留 {{变量}}；
 *   2. 残留变量记入 missingVariables，供调用方在日志里明确提示。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BasePromptBuilder, ChapterPromptBuilder } from '../prompts/prompt-builder'
import { BUILTIN_PROMPTS, EDITABLE_PROMPT_KEYS, renderPrompt } from '../prompt-templates'

const firstChapter = BUILTIN_PROMPTS.find(p => p.key === 'first_chapter_draft')!
const nextChapter = BUILTIN_PROMPTS.find(p => p.key === 'next_chapter_draft')!

describe('提示词构建：占位符防护', () => {
  it('首章变量齐全时不残留占位符，且内容真的进了提示词', () => {
    const builder = new ChapterPromptBuilder(firstChapter)
      .withArchitecture('架构：主角在废土醒来')
      .withGlobalGuidance('全局要求')
      .withWritingStyle('冷峻文风')
      .withWordNumber(3000)
      .withCanonContext('Canon：顾野此刻在后山，凝气三层，不知玉佩来历')
      .withChapterInfo({ chapterNumber: 1, title: '开局', keyEvents: '主角登场', characters: ['顾野'] })
      .withFutureBlueprints('第 2 章预告：主角遇到拾荒队')
      .withUserGuidance('本章要克制，不要提前抖出金手指')

    const prompt = builder.build()

    expect(prompt).not.toMatch(/\{\{/)
    expect(builder.missingVariables).toEqual([])
    expect(prompt).toContain('主角登场')
    expect(prompt).toContain('第 2 章预告：主角遇到拾荒队')
    expect(prompt).toContain('本章要克制，不要提前抖出金手指')
    // 第 1 章同样必须注入 Canon（此前模板漏了 {{canon_context}}，命令赋了值也进不去）
    expect(prompt).toContain('不知玉佩来历')
  })

  it('漏赋值时占位符会被移除，并记录到 missingVariables', () => {
    const builder = new ChapterPromptBuilder(firstChapter).withArchitecture('架构')

    const prompt = builder.build()

    expect(prompt).not.toMatch(/\{\{[^{}]*\}\}/)
    expect(builder.missingVariables).toEqual(
      expect.arrayContaining(['chapter_info', 'future_blueprints', 'user_guidance'])
    )
  })

  it('next_chapter_draft 只给部分变量时同样不残留', () => {
    const prompt = new BasePromptBuilder(nextChapter).withCanonContext('Canon 内容').build()

    expect(prompt).not.toMatch(/\{\{[^{}]*\}\}/)
  })

  it('用户数据里的 {{}} 仍被转义，不会被移除逻辑误伤', () => {
    const prompt = new BasePromptBuilder(nextChapter)
      .withCanonContext('恶意内容 {{chapter_title}} 试图注入')
      .build()

    expect(prompt).not.toMatch(/\{\{chapter_title\}\}/)
    expect(prompt).toMatch(/⦃⦃chapter_title⦄⦄/)
  })

  it('renderPrompt 也不会把占位符留给模型', () => {
    const prompt = renderPrompt(firstChapter, { architecture: '架构' })

    expect(prompt).not.toMatch(/\{\{[^{}]*\}\}/)
  })
})

// ============================================================
// 静态覆盖检查：模板用到的变量，调用点必须都赋上
//
// 这一条是防回归用的。同一种漏赋值 bug 已经出现过两次：
//   · 第 1 章少了本章蓝图 / 后续蓝图 / 作者指导；
//   · 整章修稿少了文风。
// 两次都只是把占位符留在提示词里，不会报错，只能靠人看出来。
// 这里读源码做一次静态比对：某个模板变量如果在对应调用点里找不到赋值，就直接失败。
// ============================================================
describe('提示词模板变量的赋值覆盖', () => {
  const readSrc = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  /**
   * 模板正文所在的源文件。
   *
   * 拆分后内置模板按创作阶段分域存在 prompts/builtin/ 下（原先是一个 3000 行的数组字面量）。
   * 切块必须**在单个文件内**进行：如果先把多个文件拼起来再切，上一个文件的最后一个模板
   * 会把下一个文件的首个模板也算进自己的块里，从而多算出本不属于它的变量。
   */
  const builtinFiles = fs
    .readdirSync(fileURLToPath(new URL('../prompts/builtin', import.meta.url)))
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')

  /** 模板 key → 该模板用到的变量名 */
  const templateVarsOf = (key: string): string[] => {
    for (const file of builtinFiles) {
      const src = readSrc(`../prompts/builtin/${file}`)
      const keys = [...src.matchAll(/key: '([a-z_0-9]+)'/g)]
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][1] !== key) continue
        const chunk = src.slice(keys[i].index, i + 1 < keys.length ? keys[i + 1].index : src.length)
        return [...new Set([...chunk.matchAll(/\{\{\s*([a-z_0-9]+)\s*\}\}/g)].map(m => m[1]))]
      }
    }
    throw new Error(`未找到模板: ${key}`)
  }

  /** builder 方法名 → 它设置的变量名 */
  const setterVarsOf = (): Record<string, string[]> => {
    const src = readSrc('../prompts/prompt-builder.ts')
    const methods = [...src.matchAll(/^\s{2}(?:public\s+)?(with[A-Za-z0-9_]+)\(/gm)]
    const map: Record<string, string[]> = {}
    for (let i = 0; i < methods.length; i++) {
      const body = src.slice(methods[i].index, i + 1 < methods.length ? methods[i + 1].index : src.length)
      map[methods[i][1]] = [...new Set([...body.matchAll(/this\.variables\.([a-z_0-9]+)\s*=/g)].map(m => m[1]))]
    }
    return map
  }

  /** 某个调用点文件里出现过的所有赋值变量 */
  const assignedVarsOf = (file: string, setterVars: Record<string, string[]>): Set<string> => {
    const src = readSrc(file)
    const assigned = new Set<string>()
    for (const m of src.matchAll(/\.(with[A-Za-z0-9_]+)\(/g)) {
      for (const v of setterVars[m[1]] ?? []) assigned.add(v)
    }
    // withVariables({ a: ..., b: ... }) 与直接改 variables = { a: ... } 两种写法
    for (const m of src.matchAll(/withVariables\(\{([\s\S]*?)\n\s*\}\)[ \t\r]*(?=\r?\n|$)/g)) {
      for (const k of m[1].matchAll(/([a-z_0-9]+)\s*:/g)) assigned.add(k[1])
    }
    // 直接改 protected variables 的写法（单行或多行对象都覆盖）
    for (const m of src.matchAll(/variables\s*=\s*\{([\s\S]{0,400}?)\}[ \t\r]*(?=\r?\n|$)/g)) {
      for (const k of m[1].matchAll(/([a-z_0-9]+)\s*:/g)) assigned.add(k[1])
    }
    return assigned
  }

  const callSites: Array<[string, string[]]> = [
    ['../workflows/commands/generate-draft.command.ts', ['first_chapter_draft', 'next_chapter_draft']],
    ['../workflows/commands/refine-draft.command.ts', ['refine_chapter']],
    ['../workflows/commands/refine-from-review.command.ts', ['refine_from_review']],
    ['../workflows/commands/qualitative-review.command.ts', ['qualitative_review']],
    ['../workflows/commands/analyze-style.command.ts', ['analyze_writing_style']],
    ['../workflows/commands/deai-revise.command.ts', ['deai_revise']],
    ['../workflows/commands/directory.command.ts', ['chapter_blueprint', 'chapter_blueprint_chunk']],
    ['../workflows/commands/finalize-chapter.command.ts', ['generate_chapter_notes', 'update_character_cards']],
    ['../workflows/commands/review-chapter.command.ts', ['consistency_check']],
    ['../workflows/commands/architecture.command.ts', ['generate_global_config', 'premise', 'character_dynamics', 'world_building', 'synopsis']],
    ['../workflows/commands/import-novel.command.ts', ['infer_novel_config_with_vectors', 'infer_novel_config', 'infer_single_chapter_blueprint']],
    ['../workflows/architecture-workflow.ts', ['extract_initial_characters']],
    ['../style-imitation/index.ts', ['style_imitation']],
  ]

  it('每个提示词调用点都给模板变量赋了值', () => {
    const setterVars = setterVarsOf()
    const uncovered: string[] = []
    for (const [file, keys] of callSites) {
      const assigned = assignedVarsOf(file, setterVars)
      for (const key of keys) {
        const missing = templateVarsOf(key).filter(v => !assigned.has(v))
        if (missing.length > 0) uncovered.push(`${key}（${file}）缺: ${missing.join(', ')}`)
      }
    }
    expect(uncovered).toEqual([])
  })

  it('首章模板本身引用了 canon_context（不是「赋了值但模板不引用」）', () => {
    // 这条锁的是第三阶段发现的具体缺陷：generate-draft 一直在给 Canon 赋值，
    // 但 first_chapter_draft 模板里没有 {{canon_context}}，命令赋的值根本进不了提示词，
    // 于是「预览显示有 Canon、实际请求里没有」——预览与实际发送不一致。
    const content = firstChapter.content + (firstChapter.systemSuffix ?? '')
    expect(content).toContain('{{canon_context}}')
    expect(Object.keys(firstChapter.variables)).toContain('canon_context')
    // 三语正文都要有，否则切语言后又漏
    for (const [lang, body] of Object.entries(firstChapter.contentLocalized ?? {})) {
      expect(body, `${lang} 正文缺少 {{canon_context}}`).toContain('{{canon_context}}')
    }
  })
})

// ============================================================
// 内置模板清单：数量与顺序
//
// BUILTIN_PROMPTS 的顺序**就是** PromptSettings 的展示顺序 ——
// 界面用 `BUILTIN_PROMPTS.filter(t => EDITABLE_PROMPT_KEYS.includes(t.key))` 渲染，
// 所以顺序变了用户看到的列表就变了。
//
// 从单文件拆成 prompts/builtin/ 下 6 个分域文件时保持了原始顺序，
// 这里把它锁住：以后重构如果顺手改了拼接顺序，会直接失败。
// ============================================================
describe('内置模板清单', () => {
  const expectedOrder = [
    'generate_global_config',
    'premise',
    'character_dynamics',
    'world_building',
    'synopsis',
    'chapter_blueprint',
    'chapter_blueprint_chunk',
    'first_chapter_draft',
    'next_chapter_draft',
    'refine_chapter',
    'consistency_check',
    'analyze_writing_style',
    'refine_from_review',
    'generate_chapter_notes',
    'update_character_cards',
    'infer_novel_config',
    'extract_initial_characters',
    'infer_single_chapter_blueprint',
    'infer_novel_config_with_vectors',
    'qualitative_review',
    'style_imitation',
    'deai_revise',
  ]

  it('模板数量与顺序保持不变（影响提示词设置页的展示顺序）', () => {
    expect(BUILTIN_PROMPTS.map(t => t.key)).toEqual(expectedOrder)
  })

  it('模板 key 不重复', () => {
    const keys = BUILTIN_PROMPTS.map(t => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('EDITABLE_PROMPT_KEYS 里的 key 都能在内置模板里找到', () => {
    const builtinKeys = new Set(BUILTIN_PROMPTS.map(t => t.key))
    expect(EDITABLE_PROMPT_KEYS.filter(k => !builtinKeys.has(k))).toEqual([])
  })
})
