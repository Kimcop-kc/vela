import i18n from '../i18n'

/**
 * 当前界面语言的 BCP-47 标识。
 * 之前这里写的是 `i18n.language === 'en' ? 'en-US' : 'zh-CN'`，
 * 于是俄语界面下超过 7 天的时间会落到中文日期格式（「9月12日」）。
 */
function currentLocale(): string {
  return i18n.language === 'en' ? 'en-US' : i18n.language === 'ru' ? 'ru-RU' : 'zh-CN'
}

/**
 * 格式化相对时间（如：刚刚 / 5分钟前 / 2小时前 / 3天前）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return i18n.t('justNow', { ns: 'common' })
  if (minutes < 60) return i18n.t('minutesAgo', { ns: 'common', count: minutes })
  if (hours < 24) return i18n.t('hoursAgo', { ns: 'common', count: hours })
  if (days < 7) return i18n.t('daysAgo', { ns: 'common', count: days })
  return new Date(timestamp).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' })
}

/**
 * 格式化日期为本地化字符串
 */
export function formatDate(timestamp: number, options?: Intl.DateTimeFormatOptions): string {
  return new Date(timestamp).toLocaleString(currentLocale(), options ?? {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
