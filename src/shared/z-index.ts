/**
 * Z-INDEX SCALE — 全站唯一起源
 *
 * 层级只在「元素必须脱离正常文档流」时才使用；能用 DOM 顺序解决的就不用 z-index。
 * 与 src/index.css 的 --z-* 变量一一对应，两边必须同步修改。
 *
 * | 值 | 名称     | 用途                                                    |
 * |----|----------|---------------------------------------------------------|
 * | 0  | base     | 普通文档流内容（默认，不要显式写）                        |
 * | 10 | raised   | 局部浮层：面板内浮动徽标、编辑器内浮动操作条              |
 * | 30 | sticky   | 吸附元素：吸顶工具条、吸顶表头                            |
 * | 50 | dropdown | 依附触发元素的下拉 / 弹出菜单 / 气泡 / 右键菜单           |
 * | 60 | modal    | 模态遮罩与模态主体（Dialog / SettingsModal / Confirm）     |
 * | 65 | tooltip  | 局部提示，需要浮于模态之上时用                            |
 * | 70 | toast    | 全局提示，永远在最上层（ActionToast 等）                  |
 *
 * Tailwind 的 z-10 / z-50 分别等价于 raised / dropdown，可继续使用；
 * modal / tooltip / toast 三层必须走本常量或对应的 CSS 变量，不得写字面量。
 */
export const Z_INDEX = {
  base: 0,
  raised: 10,
  sticky: 30,
  dropdown: 50,
  modal: 60,
  tooltip: 65,
  toast: 70,
} as const

export type ZIndexLayer = keyof typeof Z_INDEX