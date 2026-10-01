/**
 * 服务商预设配置 — 共享类型定义
 * 渲染进程与主进程共同使用，持久化在 ~/.vela/provider-presets.json
 *
 * 预设内容来自 provider-catalog.ts（纯数据）；这里只负责补上需要 i18n 的「自定义」项，
 * 避免同一份服务商清单在两处各写一遍、改一处忘一处。
 */

import i18n from '../i18n'
import { PROVIDER_CATALOG } from './provider-catalog'

/** 单个模型的预设 — name + 该模型的输出 token 上限 */
export interface ModelPreset {
  name: string
  maxTokens: number
}

/** 单个服务商的预设配置 */
export interface ProviderPreset {
  /** 服务商唯一标识（内置值如 openai/deepseek，用户可自定义如 my-proxy） */
  provider: string
  /** 界面显示名称，缺省时使用 provider ID */
  displayName?: string
  /** 默认 API 地址 */
  baseUrl: string
  /** 默认调用协议：openai 兼容 或 gemini 原生 */
  protocol: string
  /** 支持的生成模型列表（含各自的 maxTokens） */
  models: ModelPreset[]
  /** 支持的向量模型列表（embedding 模型不需要 maxTokens） */
  embeddingModels: string[]
}

/** 内置默认预设（首次启动时写入持久化文件） */
export const BUILTIN_PRESETS: ProviderPreset[] = [
  ...PROVIDER_CATALOG.map((entry) => ({
    provider: entry.provider,
    displayName: entry.displayName,
    baseUrl: entry.baseUrl,
    protocol: entry.protocol,
    models: entry.models.map((model) => ({ ...model })),
    embeddingModels: [...entry.embeddingModels],
  })),
  {
    provider: 'custom',
    displayName: i18n.language === 'en' ? 'Custom' : '自定义',
    baseUrl: '',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
]