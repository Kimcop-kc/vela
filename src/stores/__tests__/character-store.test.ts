/**
 * 角色卡 Store 护栏
 *
 * 角色卡是「内存列表 + 手动保存」的模型，最容易坏在选中项与列表不一致上：
 *   · load 之后如果原来选中的角色还在，必须保持选中；不在了要回退到第一个；
 *   · load 失败时也要把 loaded 置为 true（否则界面永远转圈），同时清空列表；
 *   · 改名（updateField 的 key 为 'name'）时必须同步 selectedName，否则右侧详情会指向不存在的角色；
 *   · 删除后回退到剩余第一个，删空则 selectedName 为 null；
 *   · saveAll 无论成功失败都要复位 saving。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterCard } from '../character-store'
import { EMPTY_CARD, ROLE_LABELS, useCharacterStore } from '../character-store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: (...args: unknown[]) => mocks.invoke(...args),
    on: () => () => {},
    once: () => {},
    send: () => {},
    isElectron: false,
    setZoomLevel: () => {},
    setZoomFactor: () => {},
    getZoomLevel: () => 0,
  },
}))

const card = (name: string, patch: Partial<CharacterCard> = {}): CharacterCard => ({ ...EMPTY_CARD, name, ...patch })

describe('角色卡 Store', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue([])
    useCharacterStore.setState({ characters: [], selectedName: null, saving: false, loaded: false })
  })

  it('EMPTY_CARD 覆盖全部字段，角色定位标签齐全', () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(['antagonist', 'minor', 'protagonist', 'supporting'])
    expect(Object.values(ROLE_LABELS).every(label => label && label.length > 0)).toBe(true)
    expect(EMPTY_CARD.role).toBe('supporting')
  })

  it('load 后默认选中第一个角色并置 loaded', async () => {
    mocks.invoke.mockResolvedValueOnce([card('顾野'), card('老邵')])

    await useCharacterStore.getState().load()

    const state = useCharacterStore.getState()
    expect(state.characters.map(c => c.name)).toEqual(['顾野', '老邵'])
    expect(state.selectedName).toBe('顾野')
    expect(state.loaded).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('db:character-get-all')
  })

  it('load 保留仍然存在的选中角色，不强行跳回第一个', async () => {
    useCharacterStore.setState({ selectedName: '老邵' })
    mocks.invoke.mockResolvedValueOnce([card('顾野'), card('老邵')])

    await useCharacterStore.getState().load()

    expect(useCharacterStore.getState().selectedName).toBe('老邵')
  })

  it('load 时原选中角色已消失则回退到第一个；列表为空则置 null', async () => {
    useCharacterStore.setState({ selectedName: '已删除的人' })
    mocks.invoke.mockResolvedValueOnce([card('顾野')])
    await useCharacterStore.getState().load()
    expect(useCharacterStore.getState().selectedName).toBe('顾野')

    mocks.invoke.mockResolvedValueOnce([])
    await useCharacterStore.getState().load()
    expect(useCharacterStore.getState().selectedName).toBeNull()
  })

  it('load 失败时清空列表但仍然置 loaded（界面不能一直转圈）', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('SQLite 未初始化'))

    await useCharacterStore.getState().load()

    const state = useCharacterStore.getState()
    expect(state.characters).toEqual([])
    expect(state.selectedName).toBeNull()
    expect(state.loaded).toBe(true)
  })

  it('addCharacter 追加空白卡并选中它', () => {
    useCharacterStore.getState().addCharacter()

    const state = useCharacterStore.getState()
    expect(state.characters).toHaveLength(1)
    expect(state.characters[0].role).toBe('supporting')
    expect(state.characters[0].name.length).toBeGreaterThan(0)
    expect(state.selectedName).toBe(state.characters[0].name)
  })

  it('updateField 改名时同步 selectedName，改其它字段不动选中项', () => {
    useCharacterStore.setState({ characters: [card('顾野')], selectedName: '顾野' })

    useCharacterStore.getState().updateField('顾野', 'personality', '嘴硬心软')
    expect(useCharacterStore.getState().characters[0].personality).toBe('嘴硬心软')
    expect(useCharacterStore.getState().selectedName).toBe('顾野')

    useCharacterStore.getState().updateField('顾野', 'name', '顾野之')
    expect(useCharacterStore.getState().characters[0].name).toBe('顾野之')
    expect(useCharacterStore.getState().selectedName).toBe('顾野之')
  })

  it('updateField 改名不影响「选中的是别人」的情况', () => {
    useCharacterStore.setState({ characters: [card('顾野'), card('老邵')], selectedName: '老邵' })

    useCharacterStore.getState().updateField('顾野', 'name', '顾野之')

    expect(useCharacterStore.getState().selectedName).toBe('老邵')
  })

  it('deleteCharacter 回退到剩余第一个，删空则置 null', async () => {
    useCharacterStore.setState({ characters: [card('顾野'), card('老邵')], selectedName: '顾野' })

    await useCharacterStore.getState().deleteCharacter('顾野')

    expect(useCharacterStore.getState().characters.map(c => c.name)).toEqual(['老邵'])
    expect(useCharacterStore.getState().selectedName).toBe('老邵')
    expect(mocks.invoke).toHaveBeenCalledWith('db:character-delete', '顾野')

    await useCharacterStore.getState().deleteCharacter('老邵')
    expect(useCharacterStore.getState().selectedName).toBeNull()
  })

  it('deleteCharacter 对不存在的名字是空操作（不调主进程）', async () => {
    useCharacterStore.setState({ characters: [card('顾野')], selectedName: '顾野' })
    mocks.invoke.mockClear()

    await useCharacterStore.getState().deleteCharacter('查无此人')

    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(useCharacterStore.getState().characters).toHaveLength(1)
  })

  it('deleteCharacter 时主进程删除失败也要更新内存列表', async () => {
    useCharacterStore.setState({ characters: [card('顾野'), card('老邵')], selectedName: '老邵' })
    mocks.invoke.mockRejectedValueOnce(new Error('删除失败'))

    await useCharacterStore.getState().deleteCharacter('顾野')

    expect(useCharacterStore.getState().characters.map(c => c.name)).toEqual(['老邵'])
  })

  it('saveAll 把整份列表交给主进程，并在结束后复位 saving', async () => {
    useCharacterStore.setState({ characters: [card('顾野'), card('老邵')], selectedName: '顾野' })
    mocks.invoke.mockResolvedValueOnce(undefined)

    await useCharacterStore.getState().saveAll()

    expect(mocks.invoke).toHaveBeenCalledWith('db:character-save-all', useCharacterStore.getState().characters)
    expect(useCharacterStore.getState().saving).toBe(false)
  })

  it('saveAll 失败时 saving 也要复位', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('写库失败'))

    await expect(useCharacterStore.getState().saveAll()).rejects.toThrow('写库失败')

    expect(useCharacterStore.getState().saving).toBe(false)
  })

  it('reset 清空角色、选中项与 loaded 标记', () => {
    useCharacterStore.setState({ characters: [card('顾野')], selectedName: '顾野', saving: true, loaded: true })

    useCharacterStore.getState().reset()

    expect(useCharacterStore.getState()).toMatchObject({
      characters: [], selectedName: null, saving: false, loaded: false,
    })
  })
})
