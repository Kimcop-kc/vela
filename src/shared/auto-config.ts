/**
 * 自动配置（Auto Config）—— 把一串「随手粘贴的凭据文本」直接变成可用的模型配置
 *
 * 为什么需要它：
 *   Vela 的多数用户不熟悉「服务商 / 调用协议 / API 地址 / 模型标识 / 用途」这几个概念，
 *   手填五项极易出错，于是干脆不配、直接弃用。这里提供一套**纯函数**识别引擎：
 *     1. 从任意文本里抽出 API Key、模型标识、接口地址，顺序和格式都不限；
 *     2. 按「显式声明 → 接口域名 → Key 前缀 → 模型名前缀」推断服务商；
 *     3. 结合服务商目录补齐 baseUrl / protocol / maxTokens / 用途。
 *
 * 关键约束：
 *   - 本文件不依赖 i18n / React / Electron，主进程与渲染进程共用同一份实现，
 *     保证「界面预览出来的配置」就是「真正落盘并调用的配置」。
 *   - 只做本地字符串解析，**不会把 Key 发给任何第三方**。
 */

import {
  PROVIDER_CATALOG,
  CATALOG_BY_PROVIDER,
  DEFAULT_MAX_TOKENS,
  type ProviderCatalogEntry,
} from './provider-catalog'
import type { LLMPurposeCategory, ModelProfile } from './ipc-channels'

/** 自动配置的输入：既可以整段粘贴（text），也可以分字段给 */
export interface AutoConfigInput {
  /** 用户粘贴的原始文本，可同时包含 Key / 模型名 / 接口地址 */
  text?: string
  apiKey?: string
  modelName?: string
  baseUrl?: string
  provider?: string
  /** 显式指定用途；不传则按模型名推断 */
  purposes?: LLMPurposeCategory[]
  /** 是否设为默认生成模型（默认 true） */
  setAsDefault?: boolean
  /** 是否把识别出的用途全部绑到该模型（默认 true） */
  bindPurposes?: boolean
  /** 是否顺带挑一个向量模型（默认 true，服务商有候选时生效） */
  includeEmbedding?: boolean
  temperature?: number
}

/** 识别线索 — 界面用它解释「为什么判断成这家服务商」 */
export interface AutoConfigEvidence {
  code: 'explicit' | 'host' | 'keyPrefix' | 'modelName' | 'fallback'
  value: string
}

/** 解析出来的原始字段（尚未与目录合并） */
export interface ParsedCredential {
  apiKey: string
  modelName: string
  baseUrl: string
  providerHint: string
}

/** 自动配置计划 — 界面预览与落盘的唯一依据 */
export interface AutoConfigPlan {
  ok: boolean
  /** 缺失字段（apiKey / modelName / baseUrl），供界面高亮 */
  missing: string[]
  errorCode?: 'NO_INPUT' | 'NO_API_KEY' | 'NO_BASE_URL' | 'NO_MODEL'
  provider: string
  displayName: string
  protocol: 'openai' | 'gemini'
  baseUrl: string
  apiKey: string
  modelName: string
  maxTokens: number
  temperature: number
  purposes: LLMPurposeCategory[]
  evidence: AutoConfigEvidence[]
  /** 目录里该服务商的向量模型候选（用于「顺带把知识库也配好」） */
  embeddingSuggestion: string | null
  /** 模型名缺失、但服务商支持自动列举时，由主进程去问服务商要一份候选 */
  needsModelPick: boolean
}

// ============================================================
// 文本抽取
// ============================================================

/** Key 的显式标签，例如 `api_key: sk-xxx` / `密钥：xxx` */
const LABELED_KEY = /(?:api[-_ ]?key|apikey|secret[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|bearer|密钥|秘钥|令牌|访问令牌)\s*[:=：]?\s*["'`]?([A-Za-z0-9\-_.:]{12,})["'`]?/i

/** 无需标签也能认出来的 Key（按特异性从高到低） */
const BARE_KEY_PATTERNS: RegExp[] = [
  /(sk-or-v1-[A-Za-z0-9\-_]{16,})/,
  /(sk-ant-[A-Za-z0-9\-_]{16,})/,
  /(sk-proj-[A-Za-z0-9\-_]{16,})/,
  /(sk-svcacct-[A-Za-z0-9\-_]{16,})/,
  /(gsk_[A-Za-z0-9]{16,})/,
  /(xai-[A-Za-z0-9]{16,})/,
  /(AIza[0-9A-Za-z\-_]{20,})/,
  /(sk-[A-Za-z0-9\-_]{16,})/,
  // 智谱风格：32 位十六进制 id + "." + secret
  /([0-9a-fA-F]{32}\.[A-Za-z0-9]{12,})/,
]

/** 兜底：整行就是一个长 token（含数字，排除普通英文句子与网址） */
const BARE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9\-_.]{23,}$/

/** 模型名的显式标签，例如 `model: deepseek-chat` */
const LABELED_MODEL = /(?:model(?:[\s_-]?(?:id|name))?|模型(?:[\s_-]?(?:id|名称|标识))?)\s*[:=：]\s*["'`]?([A-Za-z0-9][A-Za-z0-9._:\-/]{1,80})/i

/** 无需标签也能认出来的模型名 */
const KNOWN_MODEL = /\b((?:gpt|o[134](?=[-\d])|deepseek|glm|gemini|claude|grok|qwen|qwq|kimi|moonshot|llama|mistral|mixtral|codestral|ministral|magistral|gemma|phi|nomic|mxbai|bge|text-embedding|embedding|doubao|hunyuan|step-|minimax|abab|ernie|spark|internlm|baichuan)[A-Za-z0-9._:\-/]*)(?=$|[\s"'`,，。;；)\]】])/gi

/** 接口地址 */
const URL_RE = /https?:\/\/[^\s"'`<>()\]{}，。；、）】]+/g

/** 服务商的显式标签，例如 `provider: deepseek` */
const LABELED_PROVIDER = /(?:provider|vendor|服务商|供应商|平台)\s*[:=：]\s*["'`]?([A-Za-z0-9\-_\u4e00-\u9fa5]{2,20})/i

const EMBEDDING_HINT = /(embed|bge[-/]|bge$|text-embedding|gte-|m3e|jina-embed|nomic-embed|mxbai-embed)/i

/** 模型名是否像向量模型 */
export function isEmbeddingModelName(modelName: string): boolean {
  return EMBEDDING_HINT.test(modelName)
}

/** 去掉尾部的标点，避免把「地址,」当成地址 */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:，。；：、]+$/, '')
}

/** 从任意文本中抽取凭据字段 */
export function parseCredentialText(text: string): ParsedCredential {
  const raw = (text ?? '').trim()
  if (!raw) return { apiKey: '', modelName: '', baseUrl: '', providerHint: '' }

  const apiKey = extractApiKey(raw)
  const baseUrl = trimTrailingPunctuation(URL_RE.exec(raw)?.[0] ?? '')
  URL_RE.lastIndex = 0

  const modelName = extractModelName(raw, apiKey, baseUrl)
  const providerHint = (LABELED_PROVIDER.exec(raw)?.[1] ?? '').trim()

  return { apiKey, modelName, baseUrl, providerHint }
}

function extractApiKey(raw: string): string {
  const labeled = LABELED_KEY.exec(raw)?.[1]
  if (labeled) return labeled
  for (const pattern of BARE_KEY_PATTERNS) {
    const hit = pattern.exec(raw)?.[1]
    if (hit) return hit
  }
  // 兜底：只在文本很短（≤3 行）时启用，避免从一整篇文章里误抓一个长单词
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length <= 3) {
    for (const line of lines) {
      if (!BARE_TOKEN.test(line)) continue
      if (/^https?:/i.test(line)) continue
      if (!/\d/.test(line)) continue
      return line
    }
  }
  return ''
}

function extractModelName(raw: string, apiKey: string, baseUrl: string): string {
  const labeled = LABELED_MODEL.exec(raw)?.[1]
  if (labeled && labeled !== apiKey) return labeled

  KNOWN_MODEL.lastIndex = 0
  const candidates: string[] = []
  let match: RegExpExecArray | null
  while ((match = KNOWN_MODEL.exec(raw)) !== null) {
    const value = match[1]
    if (value === apiKey) continue
    if (baseUrl && baseUrl.toLowerCase().includes(value.toLowerCase())) continue
    candidates.push(value)
  }
  if (candidates.length === 0) return ''
  // 多个候选时，优先取「带数字版本」的那个（gpt-4o 优于 gpt）
  return candidates.sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)))[0]
}

// ============================================================
// 服务商推断
// ============================================================

export interface ProviderDetection {
  provider: string | null
  entry: ProviderCatalogEntry | null
  evidence: AutoConfigEvidence[]
}

function hostOf(baseUrl: string): string {
  if (!baseUrl) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`)
    return url.host.toLowerCase()
  } catch {
    return ''
  }
}

/** 按「显式声明 → 域名 → Key 前缀 → 模型名」推断服务商，命中即停 */
export function detectProvider(
  input: Pick<ParsedCredential, 'apiKey' | 'modelName' | 'baseUrl' | 'providerHint'>,
): ProviderDetection {
  const evidence: AutoConfigEvidence[] = []
  const push = (entry: ProviderCatalogEntry, code: AutoConfigEvidence['code'], value: string) => ({
    provider: entry.provider,
    entry,
    evidence: [...evidence, { code, value }],
  })

  // 1) 用户/文本里明确写了服务商
  const hint = (input.providerHint ?? '').trim().toLowerCase()
  if (hint) {
    const byId = CATALOG_BY_PROVIDER.get(hint)
    if (byId) return push(byId, 'explicit', hint)
    const byName = PROVIDER_CATALOG.find((entry) =>
      entry.displayName.toLowerCase().includes(hint) || hint.includes(entry.provider))
    if (byName) return push(byName, 'explicit', hint)
  }

  // 2) 接口域名
  const host = hostOf(input.baseUrl)
  if (host) {
    const byHost = PROVIDER_CATALOG.find((entry) => entry.hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h)))
    if (byHost) return push(byHost, 'host', host)
  }

  // 3) Key 前缀（长的优先，避免 sk- 抢走 sk-or-v1-）
  const apiKey = input.apiKey ?? ''
  if (apiKey) {
    const byPrefix = PROVIDER_CATALOG
      .filter((entry) => entry.keyPrefixes.some((prefix) => apiKey.startsWith(prefix)))
      .sort((a, b) => Math.max(...b.keyPrefixes.map((p) => p.length)) - Math.max(...a.keyPrefixes.map((p) => p.length)))[0]
    if (byPrefix) {
      const matched = byPrefix.keyPrefixes.find((prefix) => apiKey.startsWith(prefix)) ?? ''
      return push(byPrefix, 'keyPrefix', matched)
    }
  }

  // 4) 模型名前缀（取最长匹配，glm-4.5 优于 glm）
  const modelName = (input.modelName ?? '').toLowerCase()
  if (modelName) {
    const matches = PROVIDER_CATALOG
      .map((entry) => ({
        entry,
        prefix: entry.modelPrefixes.filter((prefix) => modelName.startsWith(prefix)).sort((a, b) => b.length - a.length)[0],
      }))
      .filter((item) => item.prefix)
      .sort((a, b) => b.prefix.length - a.prefix.length)
    if (matches[0]) return push(matches[0].entry, 'modelName', matches[0].prefix)
  }

  return { provider: null, entry: null, evidence }
}

/** 统一接口地址写法：去尾斜杠、去掉误粘贴的 chat/completions 尾巴 */
export function normalizeBaseUrl(baseUrl: string, protocol: string = 'openai'): string {
  let base = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return ''
  base = base.replace(/\/chat\/completions$/i, '').replace(/\/completions$/i, '')
  if (protocol === 'gemini') {
    base = base.replace(/\/v1beta\/models$/i, '').replace(/\/v1\/models$/i, '')
    base = base.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')
  }
  return base
}

// ============================================================
// 计划生成
// ============================================================

const TEXT_PURPOSES: LLMPurposeCategory[] = ['generation', 'refinement', 'summary']

/** 把「解析结果 + 输入覆盖项」合并成一份可预览、可落盘的计划 */
export function buildAutoConfigPlan(input: AutoConfigInput): AutoConfigPlan {
  const text = input.text ?? ''
  const parsed = parseCredentialText(text)

  const apiKey = (input.apiKey ?? parsed.apiKey).trim()
  const modelName = (input.modelName ?? parsed.modelName).trim()
  const rawBaseUrl = (input.baseUrl ?? parsed.baseUrl).trim()
  const providerHint = (input.provider ?? parsed.providerHint).trim()

  const detection = detectProvider({ apiKey, modelName, baseUrl: rawBaseUrl, providerHint })
  const entry = detection.entry
  const provider = detection.provider ?? 'custom'
  const protocol: 'openai' | 'gemini' = entry?.protocol === 'gemini' ? 'gemini' : 'openai'
  const baseUrl = normalizeBaseUrl(rawBaseUrl || entry?.baseUrl || '', protocol)

  const catalogModel = entry?.models.find((model) => model.name === modelName)
  const maxTokens = catalogModel?.maxTokens ?? DEFAULT_MAX_TOKENS

  const purposes = input.purposes?.length
    ? [...input.purposes]
    : (isEmbeddingModelName(modelName) ? (['embedding'] as LLMPurposeCategory[]) : [...TEXT_PURPOSES])

  const missing: string[] = []
  // 本地 Ollama 允许留空 Key
  if (!apiKey && provider !== 'ollama') missing.push('apiKey')
  if (!baseUrl) missing.push('baseUrl')
  if (!modelName) missing.push('modelName')

  const evidence: AutoConfigEvidence[] = [...detection.evidence]
  if (evidence.length === 0 && rawBaseUrl) evidence.push({ code: 'fallback', value: hostOf(rawBaseUrl) || rawBaseUrl })
  if (modelName) evidence.push({ code: 'modelName', value: modelName })

  const embeddingSuggestion = entry?.embeddingModels[0] ?? null

  let errorCode: AutoConfigPlan['errorCode']
  if (!text && !input.apiKey && !input.baseUrl && !input.modelName) errorCode = 'NO_INPUT'
  else if (missing.includes('apiKey')) errorCode = 'NO_API_KEY'
  else if (missing.includes('baseUrl')) errorCode = 'NO_BASE_URL'
  else if (missing.includes('modelName')) errorCode = 'NO_MODEL'

  return {
    ok: missing.length === 0,
    missing,
    errorCode,
    provider,
    displayName: entry?.displayName ?? (provider === 'custom' ? 'Custom' : provider),
    protocol,
    baseUrl,
    apiKey,
    modelName,
    maxTokens,
    temperature: input.temperature ?? 0.7,
    purposes,
    evidence,
    embeddingSuggestion,
    needsModelPick: !modelName,
  }
}

/** 按计划构造一条可落盘的模型配置 */
export function planToModelProfile(plan: AutoConfigPlan, id: string, displayName?: string): ModelProfile {
  return {
    id,
    name: displayName ?? `${plan.displayName} · ${plan.modelName}`,
    provider: plan.provider,
    protocol: plan.protocol,
    modelName: plan.modelName,
    apiKey: plan.apiKey,
    baseUrl: plan.baseUrl,
    temperature: plan.temperature,
    maxTokens: plan.maxTokens,
    purposes: [...plan.purposes],
    enabled: true,
  }
}

/**
 * 服务商没有明确给模型名、但支持列举模型时，从候选里挑一个最像「聊天主力」的。
 * 规则：优先目录里的已知模型 → 排除向量/重排/语音/图像等非对话模型 → 取第一个。
 */
export function pickDefaultModelFromList(models: string[], catalogEntry?: ProviderCatalogEntry | null): string | null {
  const list = models.filter(Boolean)
  if (list.length === 0) return null

  for (const known of catalogEntry?.models ?? []) {
    const hit = list.find((name) => name === known.name)
    if (hit) return hit
  }

  const isEmbeddingOnly = (name: string) => isEmbeddingModelName(name) && !/chat|instruct|coder/i.test(name)
  const excluded = /(rerank|whisper|tts|speech|audio|image|video|vision-only|moderation|dall-e|sora|stable-diffusion|flux)/i
  const conversational = list.filter((name) => !isEmbeddingOnly(name) && !excluded.test(name))
  const pool = conversational.length > 0 ? conversational : list

  const scored = [...pool].sort((a, b) => scoreModelName(b) - scoreModelName(a))
  return scored[0] ?? null
}

function scoreModelName(name: string): number {
  const value = name.toLowerCase()
  let score = 0
  if (/(^|[^a-z])(chat|instruct|turbo|pro|max|plus|large)([^a-z]|$)/.test(value)) score += 3
  // mini / small / air / lite 通常更便宜也更弱，写长文时不该当默认；
  // flash 保持中性 —— Gemini Flash 这类「快速版」经常就是该系列的主力。
  if (/mini|small|air|lite/.test(value)) score -= 1
  if (/\d/.test(value)) score += 2
  if (/(reasoner|thinking|r1|o[134])/.test(value)) score -= 1
  if (/preview|beta|experimental|deprecated/.test(value)) score -= 2
  score -= Math.min(name.length, 60) / 60
  return score
}

/** 该计划是否只用于向量（决定是设「默认生成模型」还是「默认向量模型」） */
export function isEmbeddingOnlyPlan(plan: AutoConfigPlan): boolean {
  return plan.purposes.length === 1 && plan.purposes[0] === 'embedding'
}