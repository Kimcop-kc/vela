/**
 * 自动配置引擎测试
 *
 * 覆盖用户实际会粘贴的各种「脏」文本：只有 Key、Key + 模型名、带标签的整段、
 * 以及各家服务商的特征前缀（sk-or-v1- / gsk_ / AIza / glm- / deepseek-）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildAutoConfigPlan,
  detectProvider,
  isEmbeddingModelName,
  isEmbeddingOnlyPlan,
  normalizeBaseUrl,
  parseCredentialText,
  pickDefaultModelFromList,
  planToModelProfile,
} from '../../shared/auto-config'
import { CATALOG_BY_PROVIDER } from '../../shared/provider-catalog'

describe('parseCredentialText', () => {
  it('只有一行 Key 时也能认出来', () => {
    expect(parseCredentialText('sk-abcdefghijklmnop1234').apiKey).toBe('sk-abcdefghijklmnop1234')
  })

  it('支持带标签的 Key', () => {
    expect(parseCredentialText('API Key: sk-abcdefghijklmnop1234').apiKey).toBe('sk-abcdefghijklmnop1234')
    expect(parseCredentialText('密钥：sk-abcdefghijklmnop1234').apiKey).toBe('sk-abcdefghijklmnop1234')
    expect(parseCredentialText('Authorization: Bearer sk-abcdefghijklmnop1234').apiKey).toBe('sk-abcdefghijklmnop1234')
  })

  it('认得出各家特征前缀', () => {
    expect(parseCredentialText('gsk_abcdefghijklmnopqrstuvwx').apiKey).toBe('gsk_abcdefghijklmnopqrstuvwx')
    expect(parseCredentialText('AIzaSyABCDEFGHIJKLMNOPQRSTUVWX123456789').apiKey).toBe('AIzaSyABCDEFGHIJKLMNOPQRSTUVWX123456789')
    expect(parseCredentialText('sk-or-v1-abcdefghijklmnopqrstuvwx').apiKey).toBe('sk-or-v1-abcdefghijklmnopqrstuvwx')
  })

  it('从整段文本里同时抽出模型名和接口地址', () => {
    const parsed = parseCredentialText('deepseek\n模型：deepseek-chat\nhttps://api.deepseek.com')
    expect(parsed.modelName).toBe('deepseek-chat')
    expect(parsed.baseUrl).toBe('https://api.deepseek.com')
  })

  it('地址尾部的标点不算地址的一部分', () => {
    expect(parseCredentialText('地址是 https://api.deepseek.com，密钥见附件').baseUrl).toBe('https://api.deepseek.com')
  })

  it('不会把地址里的域名当成模型名', () => {
    expect(parseCredentialText('https://api.deepseek.com').modelName).toBe('')
  })

  it('空输入返回空结果', () => {
    expect(parseCredentialText('   ')).toEqual({ apiKey: '', modelName: '', baseUrl: '', providerHint: '' })
  })
})

describe('detectProvider', () => {
  const detect = (input: Partial<Parameters<typeof detectProvider>[0]>) =>
    detectProvider({ apiKey: '', modelName: '', baseUrl: '', providerHint: '', ...input }).provider

  it('按接口域名识别', () => {
    expect(detect({ baseUrl: 'https://api.deepseek.com' })).toBe('deepseek')
    expect(detect({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })).toBe('bigmodel')
    expect(detect({ baseUrl: 'https://api.moonshot.cn/v1' })).toBe('moonshot')
    expect(detect({ baseUrl: 'http://localhost:11434' })).toBe('ollama')
  })

  it('按 Key 前缀识别', () => {
    expect(detect({ apiKey: 'sk-or-v1-abcdefghijklmnopqrstuvwx' })).toBe('openrouter')
    expect(detect({ apiKey: 'gsk_abcdefghijklmnopqrstuvwx' })).toBe('groq')
    expect(detect({ apiKey: 'xai-abcdefghijklmnopqrstuvwx' })).toBe('xai')
    expect(detect({ apiKey: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWX123456789' })).toBe('gemini')
  })

  it('按模型名前缀识别', () => {
    expect(detect({ modelName: 'deepseek-chat' })).toBe('deepseek')
    expect(detect({ modelName: 'glm-4.5' })).toBe('bigmodel')
    expect(detect({ modelName: 'gpt-4o' })).toBe('openai')
    expect(detect({ modelName: 'grok-3' })).toBe('xai')
  })

  it('域名优先于模型名（同一模型可能挂在多家平台上）', () => {
    expect(detect({ modelName: 'deepseek-chat', baseUrl: 'https://api.siliconflow.cn/v1' })).toBe('siliconflow')
  })

  it('认不出来就返回 null，不硬猜', () => {
    expect(detect({ modelName: 'llama3.3' })).toBeNull()
    expect(detect({ apiKey: 'sk-abcdefghijklmnop1234' })).toBeNull()
  })

  it('显式声明最优先', () => {
    expect(detect({ providerHint: 'moonshot', baseUrl: 'https://api.deepseek.com' })).toBe('moonshot')
  })
})

describe('normalizeBaseUrl', () => {
  it('去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
  })

  it('去掉误粘贴的 chat/completions 尾巴', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com/v1')
  })

  it('Gemini 去掉版本段落，避免拼出 /v1beta/v1beta', () => {
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta', 'gemini'))
      .toBe('https://generativelanguage.googleapis.com')
  })
})

describe('buildAutoConfigPlan', () => {
  it('整段粘贴即可得到完整计划', () => {
    const plan = buildAutoConfigPlan({
      text: 'deepseek\n模型：deepseek-chat\nsk-abcdefghijklmnop1234\nhttps://api.deepseek.com',
    })
    expect(plan.ok).toBe(true)
    expect(plan.provider).toBe('deepseek')
    expect(plan.modelName).toBe('deepseek-chat')
    expect(plan.baseUrl).toBe('https://api.deepseek.com')
    expect(plan.purposes).toEqual(['generation', 'refinement', 'summary'])
    // 目录里 deepseek-chat 的输出上限是 65536，比默认值更贴合实际
    expect(plan.maxTokens).toBe(65536)
  })

  it('只给 Key 时用目录里的默认地址补全', () => {
    const plan = buildAutoConfigPlan({ apiKey: 'gsk_abcdefghijklmnopqrstuvwx', modelName: 'llama-3.3-70b-versatile' })
    expect(plan.ok).toBe(true)
    expect(plan.baseUrl).toBe('https://api.groq.com/openai/v1')
  })

  it('缺模型名时报 NO_MODEL，但不编造一个', () => {
    const plan = buildAutoConfigPlan({ text: 'sk-abcdefghijklmnop1234\nhttps://api.deepseek.com' })
    expect(plan.ok).toBe(false)
    expect(plan.errorCode).toBe('NO_MODEL')
    expect(plan.needsModelPick).toBe(true)
    expect(plan.missing).toContain('modelName')
  })

  it('缺 Key 时报 NO_API_KEY', () => {
    const plan = buildAutoConfigPlan({ text: 'deepseek-chat\nhttps://api.deepseek.com' })
    expect(plan.ok).toBe(false)
    expect(plan.errorCode).toBe('NO_API_KEY')
  })

  it('本地 Ollama 允许没有 Key', () => {
    const plan = buildAutoConfigPlan({ text: 'ollama\nllama3.3\nhttp://localhost:11434' })
    expect(plan.ok).toBe(true)
    expect(plan.provider).toBe('ollama')
    expect(plan.apiKey).toBe('')
  })

  it('完全空输入报 NO_INPUT', () => {
    expect(buildAutoConfigPlan({}).errorCode).toBe('NO_INPUT')
  })

  it('向量模型名走 embedding 用途', () => {
    const plan = buildAutoConfigPlan({ apiKey: 'sk-abcdefghijklmnop1234', modelName: 'text-embedding-3-small' })
    expect(plan.purposes).toEqual(['embedding'])
    expect(isEmbeddingOnlyPlan(plan)).toBe(true)
  })

  it('给出可选的向量模型候选，供顺带配好知识库', () => {
    const plan = buildAutoConfigPlan({ apiKey: 'sk-proj-abcdefghijklmnop1234', modelName: 'gpt-4o' })
    expect(plan.embeddingSuggestion).toBe('text-embedding-3-small')
    expect(plan.evidence.some((item) => item.code === 'keyPrefix')).toBe(true)
  })

  it('显式传入的用途覆盖自动推断', () => {
    const plan = buildAutoConfigPlan({ apiKey: 'sk-abcdefghijklmnop1234', modelName: 'gpt-4o', purposes: ['summary'] })
    expect(plan.purposes).toEqual(['summary'])
  })
})

describe('planToModelProfile', () => {
  it('产出的配置能被后续调用直接使用', () => {
    const plan = buildAutoConfigPlan({ text: 'deepseek-chat\nsk-abcdefghijklmnop1234\nhttps://api.deepseek.com' })
    const profile = planToModelProfile(plan, 'model-1')
    expect(profile.id).toBe('model-1')
    expect(profile.provider).toBe('deepseek')
    expect(profile.protocol).toBe('openai')
    expect(profile.enabled).toBe(true)
    expect(profile.apiKey).toBe('sk-abcdefghijklmnop1234')
    expect(profile.name).toContain('deepseek-chat')
  })
})

describe('isEmbeddingModelName', () => {
  it('认得常见的向量模型命名', () => {
    for (const name of ['text-embedding-3-small', 'embedding-3', 'bge-m3', 'BAAI/bge-large-zh-v1.5', 'nomic-embed-text']) {
      expect(isEmbeddingModelName(name), name).toBe(true)
    }
  })

  it('不会把普通对话模型误判成向量模型', () => {
    for (const name of ['gpt-4o', 'deepseek-chat', 'glm-4.5', 'qwen-max']) {
      expect(isEmbeddingModelName(name), name).toBe(false)
    }
  })
})

describe('pickDefaultModelFromList', () => {
  it('优先挑目录里已知的模型', () => {
    const bigmodel = CATALOG_BY_PROVIDER.get('bigmodel')
    expect(pickDefaultModelFromList(['glm-4.5-air', 'glm-4.7', 'glm-4.5'], bigmodel)).toBe('glm-4.5')
  })

  it('目录里没有时，偏向不带 mini/air 后缀的型号', () => {
    expect(pickDefaultModelFromList(['acme-chat-air', 'acme-chat'])).toBe('acme-chat')
  })

  it('不会挑中向量模型', () => {
    const picked = pickDefaultModelFromList(['text-embedding-3-small', 'gpt-4o-mini', 'whisper-1'])
    expect(picked).toBe('gpt-4o-mini')
  })

  it('空列表返回 null', () => {
    expect(pickDefaultModelFromList([])).toBeNull()
  })

  it('偏向稳定版而不是预览版', () => {
    expect(pickDefaultModelFromList(['acme-chat-preview', 'acme-chat'])).toBe('acme-chat')
  })
})