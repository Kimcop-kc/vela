/**
 * 临时称呼过滤。
 *
 * 定稿时会从正文里自动登记「新出场角色」，但模型经常把「青斑汉子」「瘦高汉子」
 * 「黑衣男子」这类描述性泛称也当成角色名。它们不是真实角色，却会污染角色卡、
 * 影响后续 Canon 与提示词。这里用保守规则识别这类泛称，避免误伤正常姓名。
 */

/** 常见「泛称」后缀：XX汉子 / XX男子 / XX老者…… */
const GENERIC_SUFFIXES = [
  '汉子', '男子', '女子', '老者', '老人', '少年', '少女', '青年', '妇人',
  '姑娘', '家伙', '人影', '身影', '众人', '人群', '士兵', '侍卫', '守卫',
  '弟子', '修士', '掌柜', '小二', '仆人', '丫鬟', '村民', '路人', '商人',
  '商贩', '乞丐', '差役', '衙役', '大夫', '郎中', '铁匠', '船夫', '马夫',
  '伙计', '随从', '护卫', '军士', '兵丁', '侍女', '侍从', '长老', '前辈',
]

/** 常见「外观/衣着」前缀：黑衣 / 白衣 / 瘦高 / 独眼…… */
const DESCRIPTOR_PREFIXES = [
  '黑衣', '白衣', '灰衣', '青衣', '红衣', '绿衣', '黄衣', '蓝衣', '紫衣',
  '黑袍', '白袍', '青袍', '红袍', '长袍', '锦袍', '麻衣', '布衣', '锦衣',
  '瘦高', '矮胖', '高瘦', '肥胖', '光头', '独眼', '跛脚', '瘸腿', '蒙面',
  '斗笠', '青斑', '疤脸', '刀疤',
]

/** 泛称长度上限：超过该长度更可能是完整姓名，放弃过滤以免误伤。 */
const MAX_DESCRIPTOR_LENGTH = 6

/**
 * 是否是「临时泛称」而非真实角色名。
 * 只命中明确的前缀/后缀且整体较短时才返回 true。
 */
export function isTemporaryDescriptorName(name: string): boolean {
  const value = (name || '').trim()
  if (!value) return true
  if (value.length < 2) return true
  if (value.length > MAX_DESCRIPTOR_LENGTH) return false
  if (DESCRIPTOR_PREFIXES.some(prefix => value.startsWith(prefix))) return true
  if (GENERIC_SUFFIXES.some(suffix => value.endsWith(suffix))) return true
  return false
}

/** 从候选名单里滤掉临时泛称，并返回被过滤的名字（供日志展示）。 */
export function filterTemporaryDescriptorNames(names: string[]): {
  kept: string[]
  skipped: string[]
} {
  const kept: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    if (isTemporaryDescriptorName(name)) skipped.push(name)
    else kept.push(name)
  }
  return { kept, skipped }
}
