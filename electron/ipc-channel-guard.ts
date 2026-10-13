/**
 * IPC 通道闸门 —— preload 的唯一守门人。
 *
 * 背景：preload 此前是 `invoke(channel, ...args)` 的通用透传。contextIsolation 挡住了
 * 渲染进程直接访问 Node，却挡不住「通过 IPC 把主进程能力借出去」——渲染进程可以调用
 * 契约里的全部通道（写文件、删项目、导出、读任意路径……）。一旦渲染层被注入
 * （例如把外部文件当 HTML 渲染），等于把主进程的能力全部交出去。
 *
 * 这里按 `src/shared/ipc-channels.ts` 的运行时白名单收口。清单与契约的一致性由那边的
 * 编译期断言保证（加了通道忘了登记，`tsc` 直接失败并点名通道），本模块只负责判定，
 * 不重复维护任何列表。
 *
 * 逻辑刻意做成纯函数：preload 本身依赖 `electron`，不便单测，把判定抽出来才能覆盖。
 */
import { EVENT_CHANNEL_ALLOWLIST, INVOKE_CHANNEL_ALLOWLIST } from '../src/shared/ipc-channels'

const invokeChannels: ReadonlySet<string> = new Set(INVOKE_CHANNEL_ALLOWLIST)
const eventChannels: ReadonlySet<string> = new Set(EVENT_CHANNEL_ALLOWLIST)

/** 渲染进程 → 主进程的调用通道是否放行 */
export function isAllowedInvokeChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && invokeChannels.has(channel)
}

/** 主进程 → 渲染进程的事件通道是否放行 */
export function isAllowedEventChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && eventChannels.has(channel)
}

/**
 * 拒绝原因。
 *
 * 特意把「通道名 + 该去哪个数组登记」写进消息：否则通道名打错会表现成
 * 「功能莫名不生效」，查起来非常费劲。
 */
export function rejectionMessage(channel: unknown, kind: 'invoke' | 'event' | 'send'): string {
  const name = `「${typeof channel === 'string' ? channel : String(channel)}」`
  if (kind === 'send') {
    return `[Vela IPC] 渲染进程不允许单向发送${name}：主进程没有注册任何 ipcMain.on 监听，`
      + '请改用 invoke（有返回值、有类型契约）。'
  }
  const where = kind === 'invoke' ? 'INVOKE_CHANNEL_ALLOWLIST' : 'EVENT_CHANNEL_ALLOWLIST'
  const action = kind === 'invoke' ? '调用' : '监听'
  return `[Vela IPC] 拒绝未登记的${action}通道${name}：`
    + `若确实需要，请先在 src/shared/ipc-channels.ts 的 ${where} 里登记。`
}

/** 白名单规模（自检与测试用，避免把两个数组散落出去） */
export function allowlistSizes(): { invoke: number; event: number } {
  return { invoke: invokeChannels.size, event: eventChannels.size }
}
