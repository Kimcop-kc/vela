/**
 * 修稿输出的解析：从模型输出里切出正文，剥离【修复说明】【待作者确认】等元信息段落。
 *
 * 自定义提示词常要求「正文 + 说明」多段输出，内置模板则只输出正文；两种都要兼容，
 * 否则说明块会被当成正文写进修订稿、出现在 diff 里，还会污染后续的一致性检查与 canon 写回。
 * 「审稿驱动修稿」和整章「AI 修稿」共用这里的实现。
 */

const BODY_MARKERS = ['【修复后正文】', '【修复后的正文】', '【修订后正文】', '【正文】']
const NOTES_MARKERS = ['【修复说明】', '【修改说明】', '【修订说明】', '【待作者确认】']

export function splitRefineOutput(raw: string): { body: string; notes: string } {
  const text = (raw || '').trim()
  if (!text) return { body: '', notes: '' }

  let start = 0
  for (const marker of BODY_MARKERS) {
    const index = text.indexOf(marker)
    if (index !== -1) {
      start = index + marker.length
      break
    }
  }

  let end = text.length
  for (const marker of NOTES_MARKERS) {
    const index = text.indexOf(marker, start)
    if (index !== -1 && index < end) end = index
  }

  const body = text.slice(start, end).trim()
  const notes = text.slice(end).trim()
  // 没有正文标记且说明标记在最前时 body 会为空，此时退回完整文本，避免产出空修订稿。
  return { body: body || text, notes }
}
