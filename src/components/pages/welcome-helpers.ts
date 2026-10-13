/**
 * 欢迎页纯函数
 *
 * 拆出来的原因与 `story-bible/helpers.ts` 一致：仓库没有 jsdom，组件本身渲染不了，
 * 但这两个函数承载了真实边界（Windows 路径、主进程写入的时间串可能为空/畸形），
 * 放在组件里就只能靠肉眼回归。这里不含 i18n 依赖，因此可在 node 环境直接测。
 */

/**
 * 路径过长时只保留尾部三段，避免撑破布局。
 * 统一按 `/` 切分，因此 Windows 的 `\` 路径与 POSIX 路径行为一致。
 */
export function shortenPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) {
    // 去掉尾部斜杠（根路径 '/' 除外）—— 之前三段以内的路径会把尾斜杠原样显示出来
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
  }
  return '…/' + parts.slice(-3).join('/')
}

/**
 * 把最近项目的 `updatedAt`（主进程写入的 ISO 串）解析成时间戳。
 * 解析不出来时返回 `null` —— 调用方据此**不显示**时间，而不是显示 "Invalid Date"
 * 或 "刚刚" 这类假信息。
 */
export function parseUpdatedAt(updatedAt: string | null | undefined): number | null {
  if (!updatedAt) return null
  const ts = new Date(updatedAt).getTime()
  return Number.isFinite(ts) ? ts : null
}
