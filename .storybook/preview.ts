import type { Preview } from '@storybook/react'
import '../src/index.css'

// 必须与 src/index.css 里的 5 套主题选择器一一对应（light 对应 `:root`）。
// 漏一个主题 = Storybook 里走查不到那套主题；多一个 = 工具栏出现不存在的选项。
// 由 .storybook/__tests__/preview-theme-sync.test.ts 守门。
const themes = ['light', 'galaxy', 'paper', 'dark', 'ocean'] as const

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      // 这 5 个色值就是 index.css 各主题的 `--color-bg`。此前这里硬编码的 4 个值
      // 全部与令牌不符（如 light 写成 #F7F9FC，实际是 #F5F5F5），且漏了 ocean，
      // 导致在 Storybook 里做主题走查时看的是错的底色。已按 index.css 逐套校正。
      values: [
        { name: 'light', value: '#F5F5F5' },
        { name: 'galaxy', value: '#171D26' },
        { name: 'paper', value: '#F4F0E7' },
        { name: 'dark', value: '#1C1C1C' },
        { name: 'ocean', value: '#141B24' },
      ],
    },
    a11y: {
      test: 'error',
    },
    docs: {
      theme: undefined, // Uses Storybook default theme
    },
  },
  decorators: [
    (Story, context) => {
      const theme = (context.globals as { theme?: typeof themes[number] }).theme || 'light'
      // background 直接取主题自己的 --color-bg：即使上面 backgrounds 的色值再次写错，
      // 故事区的底色也永远跟着令牌走，不会出现「选了暗色主题却看着浅色底」。
      return (
        <div className={theme} style={{ padding: '1rem', minHeight: '200px', background: 'var(--color-bg)' }}>
          <Story />
        </div>
      )
    },
  ],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Vela theme for preview',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: themes.map(t => ({ value: t, title: t.charAt(0).toUpperCase() + t.slice(1) })),
        showName: true,
        dynamicLabel: true,
      },
    },
  },
}

export default preview
