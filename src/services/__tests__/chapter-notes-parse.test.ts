/**
 * 章节要点 → 结构化写回
 *
 * 这组测试锁的是这次真实问题的修复：定稿时生成的「章节要点」本来是分好段的，
 * 但以前只被当成一段摘要存着，时间线/事实/伏笔全靠关键词启发式，结果 19 章下来
 * 时间线只有 3 条、事实 0 条。这里验证要点能被正确拆成四类结构化数据。
 */
import { describe, expect, it } from 'vitest'
import { parseChapterNotes } from '../narrative-consistency/notes-parser'
import { extractCanonWriteback } from '../narrative-consistency/fact-extractor'

const notes = `# 第1章 要点

## 剧情节点
- [触发] 周德携恶奴堵符铺，持伪造借契索要三十灵石
- [冲突] 周德命人强抢符样，云玉辞阻拦被推撞向西墙
- [转折] 锁身符灵气引动墙面，暗藏逆旋刻痕显异动
- [结果] 周德锁铺留恶奴看守，限三日内清偿全部债务

## 角色动态
| 角色 | 本章变化/状态 |
|------|-------------|
| 云玉辞 | 天生灵窍闭死，守灵遭逼债，撞墙发现异动逆纹 |
| 周德 | 通济行管事，持假契逼债，锁铺限三日还款 |
| 老陈头 | 云玉辞已逝师父，西墙留有被封存的逆旋刻痕 |
| 他 | 指代不明，应当被丢弃 |

## 新增设定
- 灵窍闭死之人无法引气修炼，不能催动符篆
- 欠债无力偿还者，需入黑风矿服苦役抵债

## 伏笔与钩子
- [埋] 云玉辞指腹银色旧灼痕，与逆纹光痕颜色一致
- [钩] 三日之限已下，逃生只剩三天
`

const ctx = {
  chapterNumber: 1,
  chapterTitle: '第一章',
  characterNames: ['云玉辞', '周德', '老陈头'],
}

describe('parseChapterNotes', () => {
  it('剧情节点变成有序的时间线事件，并带上人物', () => {
    const parsed = parseChapterNotes(notes, ctx)
    // 4 个剧情节点 + 1 个章末钩子
    expect(parsed.events).toHaveLength(5)
    expect(parsed.events[0].summary).toContain('[触发]')
    expect(parsed.events[0].characters).toContain('周德')
    expect(parsed.events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(parsed.events[4].summary).toContain('[章末钩子]')
  })

  it('角色动态只认角色卡里有的名字，代称被丢掉', () => {
    const parsed = parseChapterNotes(notes, ctx)
    expect(parsed.characterDeltas).toHaveLength(3)
    expect(parsed.characterDeltas.map(delta => delta.character)).toEqual(['云玉辞', '周德', '老陈头'])
    expect(parsed.characterDeltas[0].after.recentEvents).toContain('灵窍闭死')
  })

  it('新增设定进候选事实，且状态是待确认（不冒充已确认）', () => {
    const parsed = parseChapterNotes(notes, ctx)
    expect(parsed.facts).toHaveLength(2)
    expect(parsed.facts.every(fact => fact.status === 'tentative')).toBe(true)
    expect(parsed.facts[0].introducedAt).toBe(1)
    expect(parsed.facts[1].statement).toContain('黑风矿')
  })

  it('伏笔被登记为伏笔类剧情线，而不是普通剧情线', () => {
    const parsed = parseChapterNotes(notes, ctx)
    expect(parsed.foreshadows).toHaveLength(1)
    expect(parsed.foreshadows[0].description).toContain('银色旧灼痕')
  })

  it('要点为空 / 不是要点格式时返回空结构，不报错', () => {
    expect(parseChapterNotes('', ctx).events).toEqual([])
    expect(parseChapterNotes('随便一段没有分段的文字。', ctx).events).toEqual([])
    expect(parseChapterNotes('## 剧情节点\n没有列表项的正文', ctx).stats.beats).toBe(0)
  })
})

describe('写回优先用要点', () => {
  it('有要点时用要点，不再依赖「段首是角色名＋动作动词」的启发式', () => {
    // 正文故意是文学写法：段首既不是角色名，也没有词表里的动作动词
    const prose = [
      '雨丝斜着扎进领口，他把斗笠往上推了推。',
      '供桌上的算盘磕在棱上，半盏冷酒泼出来，浸湿了灵位前的黄纸钱。',
      '指尖按在那道新生的纹路上，冰凉的石面下，一丝温热顺着刻痕透过来。',
    ].join('\n\n')

    const withoutNotes = extractCanonWriteback({
      chapterNumber: 1, chapterTitle: '第一章', chapterContent: prose,
      characters: [{ name: '云玉辞' }, { name: '周德' }],
    })
    expect(withoutNotes.newEvents).toHaveLength(0)

    const withNotes = extractCanonWriteback({
      chapterNumber: 1, chapterTitle: '第一章', chapterContent: prose,
      characters: [{ name: '云玉辞' }, { name: '周德' }, { name: '老陈头' }],
      existingNotes: notes,
    })
    expect(withNotes.newEvents.length).toBeGreaterThanOrEqual(4)
    expect(withNotes.newFacts.length).toBeGreaterThanOrEqual(2)
    expect(withNotes.characterDeltas.length).toBe(3)
    expect(withNotes.plotLineChanges.added?.length).toBe(1)
    expect(withNotes.plotLineChanges.added?.[0].kind).toBe('foreshadow')
  })

  it('要点里没有可用条目时退回启发式（不把已有能力丢掉）', () => {
    const prose = '云玉辞斩杀恶奴，拿到残简。'
    const payload = extractCanonWriteback({
      chapterNumber: 5, chapterTitle: '第五章', chapterContent: prose,
      characters: [{ name: '云玉辞' }],
      existingNotes: '## 剧情节点\n（无）\n',
    })
    expect(payload.newEvents.length).toBeGreaterThan(0)
  })
})
