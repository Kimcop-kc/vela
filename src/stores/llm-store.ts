import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type {
  ModelProfile,
  LLMResponse,
  TokenUsage,
  LLMCompletionMeta,
  PurposeModelBindings,
  AutoConfigInput,
  AutoConfigPlanResult,
  AutoConfigApplyResult,
} from '../shared/ipc-channels'
import { categorizePurpose, pickModelIdForCategory, type PurposeCategory } from '../shared/purpose-routing'
import i18n from '../i18n'

/** 调用用途：用于统计面板里区分「这次 token 花在哪」 */
export type LLMCallPurpose = string

/** 流式请求的空闲超时：超过该时长没有任何 chunk 就判定为断流并中断。 */
const STREAM_IDLE_TIMEOUT_MS = 180_000

// 调用统计统一由主进程记录（electron/llm/call-log.ts）：Agent 循环、写作工具、
// 章节彩排等不经过本 store 的调用也会被计入，这里不再重复写库。

/** 流式生成的回调 */
interface StreamCallbacks {
  onChunk?: (chunk: string) => void
  onDone?: (fullText: string, usage?: TokenUsage, meta?: LLMCompletionMeta) => void
  onError?: (error: string) => void
  /**
   * 输出被长度上限截断时回调：拿到已产出的部分内容后可以续写补齐。
   * 不提供时退回 onError（文案不变），保证既有调用方行为一致。
   */
  onTruncated?: (partialText: string, usage?: TokenUsage, meta?: LLMCompletionMeta) => void
}

interface LLMState {
  /** 已配置的模型列表 */
  models: ModelProfile[]
  /** 当前默认生成模型 ID */
  defaultModelId: string | null
  /** 当前默认向量模型 ID */
  defaultEmbeddingModelId: string | null
  /** 用途 → 模型 id 绑定（多模型管理：先导入模型，再为每个用途挑选模型） */
  purposeModels: PurposeModelBindings
  /** 正在进行的活跃请求 */
  activeRequests: Map<string, { status: 'running' | 'done' | 'error'; text: string }>
  /** 是否已加载模型配置 */
  loaded: boolean

  // ===== Actions =====
  /** 初始化（加载模型列表 + 默认模型 ID） */
  init: () => Promise<void>
  /** 加载模型列表 */
  loadModels: () => Promise<void>
  /** 保存模型 */
  saveModel: (model: ModelProfile) => Promise<boolean>
  /** 删除模型 */
  deleteModel: (modelId: string) => Promise<boolean>
  /** 设置默认生成模型（持久化到 ~/.vela/config.json） */
  setDefaultModel: (modelId: string) => void
  /** 设置默认向量模型（持久化到 ~/.vela/config.json） */
  setDefaultEmbeddingModel: (modelId: string) => void
  /** 绑定某个用途使用的模型；传 null 解除绑定、回落到默认模型 */
  setPurposeModel: (purpose: PurposeCategory, modelId: string | null) => Promise<void>
  /** 解析某个用途实际使用的模型 id（用途绑定 → 默认模型 → 模型池） */
  resolveModelId: (purpose?: string) => string | null
  /** 解析某个用途实际使用的模型对象 */
  modelForPurpose: (purpose?: string) => ModelProfile | undefined
  /** 非流式生成 */
  generate: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId?: string,
    options?: { responseFormat?: { type: string }; thinking?: boolean; maxTokens?: number; purpose?: LLMCallPurpose }
  ) => Promise<LLMResponse>
  /** 流式生成 */
  generateStream: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    callbacks: StreamCallbacks,
    modelId?: string,
    options?: { responseFormat?: { type: string }; thinking?: boolean; maxTokens?: number; purpose?: LLMCallPurpose }
  ) => Promise<string>
  /** 取消生成 */
  cancelGeneration: (requestId: string) => Promise<void>
  /** 测试模型连接 */
  testConnection: (model: ModelProfile) => Promise<{ success: boolean; error?: string }>
  /**
   * 一键配置 · 预演（只读）
   * 解析粘贴的 Key / 模型名 / 接口地址，有 Key 时顺带问服务商要一份真实模型列表。
   */
  previewAutoConfig: (input: AutoConfigInput) => Promise<AutoConfigPlanResult>
  /**
   * 一键配置 · 应用
   * 一次写完模型池、默认模型、用途绑定；服务商有向量模型时会顺带把知识库也配好。
   */
  autoConfigure: (input: AutoConfigInput) => Promise<AutoConfigApplyResult>
}

export const useLLMStore = create<LLMState>()((set, get) => ({
  models: [],
  defaultModelId: null,
  defaultEmbeddingModelId: null,
  purposeModels: {},
  activeRequests: new Map(),
  loaded: false,

  init: async () => {
    if (get().loaded) return
    // 从 ~/.vela/ 加载模型列表和默认模型 ID
    await get().loadModels()
    if (ipc.isElectron) {
      // 任一通道不可用（例如旧版主进程）都不该让初始化整体失败，各自兜底
      const [defaultId, defaultEmbeddingId, purposeModels] = await Promise.all([
        ipc.invoke('llm:get-default-model').catch(() => null),
        ipc.invoke('llm:get-default-embedding-model').catch(() => null),
        ipc.invoke('llm:get-purpose-models').catch(() => ({} as PurposeModelBindings)),
      ])
      set({ defaultModelId: defaultId, defaultEmbeddingModelId: defaultEmbeddingId, purposeModels, loaded: true })
    } else {
      set({ loaded: true })
    }
  },

  loadModels: async () => {
    if (!ipc.isElectron) return
    const models = await ipc.invoke('llm:list-models')
    set({ models, loaded: true })
  },

  saveModel: async (model) => {
    const result = await ipc.invoke('llm:save-model', model)
    if (result.success) {
      await get().loadModels()
    }
    return result.success
  },

  deleteModel: async (modelId) => {
    const result = await ipc.invoke('llm:delete-model', modelId)
    if (result.success) {
      await get().loadModels()
      // 如果删除的是默认生成模型，清空默认
      if (get().defaultModelId === modelId) {
        set({ defaultModelId: null })
        ipc.invoke('llm:set-default-model', null)
      }
      // 如果删除的是默认向量模型，清空默认
      if (get().defaultEmbeddingModelId === modelId) {
        set({ defaultEmbeddingModelId: null })
        ipc.invoke('llm:set-default-embedding-model', null)
      }
      // 清理指向已删除模型的用途绑定，避免路由到一个不存在的模型
      const bindings = get().purposeModels
      const stale = (Object.keys(bindings) as PurposeCategory[]).filter((key) => bindings[key] === modelId)
      for (const key of stale) {
        await get().setPurposeModel(key, null)
      }
    }
    return result.success
  },

  setDefaultModel: (modelId) => {
    set({ defaultModelId: modelId })
    ipc.invoke('llm:set-default-model', modelId)
  },

  setDefaultEmbeddingModel: (modelId) => {
    set({ defaultEmbeddingModelId: modelId })
    ipc.invoke('llm:set-default-embedding-model', modelId)
  },

  setPurposeModel: async (purpose, modelId) => {
    // 先更新界面（乐观更新），再持久化到 ~/.vela/config.json
    const next: PurposeModelBindings = { ...get().purposeModels }
    if (modelId) next[purpose] = modelId
    else delete next[purpose]
    set({ purposeModels: next })
    await ipc.invoke('llm:set-purpose-model', purpose, modelId).catch(() => undefined)
  },

  resolveModelId: (purpose) => pickModelIdForCategory(categorizePurpose(purpose), {
    models: get().models,
    bindings: get().purposeModels,
    defaultModelId: get().defaultModelId,
    defaultEmbeddingModelId: get().defaultEmbeddingModelId,
  }),

  modelForPurpose: (purpose) => {
    const id = get().resolveModelId(purpose)
    return id ? get().models.find((m) => m.id === id) : undefined
  },

  generate: async (messages, modelId, options) => {
    // 未显式指定模型时按用途路由（用途绑定 → 默认模型 → 模型池）
    const mid = modelId ?? get().resolveModelId(options?.purpose)
    if (!mid) return { success: false, content: '', error: i18n.t('llm.noDefaultModel', { ns: 'stores' }) }
    return ipc.invoke('llm:generate', {
      modelId: mid,
      messages,
      responseFormat: options?.responseFormat as { type: 'json_object' | 'text' } | undefined,
      thinking: options?.thinking,
      maxTokens: options?.maxTokens,
      purpose: options?.purpose
    })
  },

  generateStream: async (messages, callbacks, modelId, options) => {
    // 未显式指定模型时按用途路由（用途绑定 → 默认模型 → 模型池）
    const mid = modelId ?? get().resolveModelId(options?.purpose)
    if (!mid) {
      callbacks.onError?.(i18n.t('llm.noDefaultModel', { ns: 'stores' }))
      return ''
    }

    const requestId = crypto.randomUUID()

    // 空闲看门狗：服务商长时间不返回任何数据（断网/挂起）时主动中断，
    // 避免工作流永久卡在「调用 AI」状态。
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }
    const armIdle = () => {
      clearIdle()
      idleTimer = setTimeout(() => {
        idleTimer = null
        callbacks.onError?.(i18n.t('llm.streamTimeout', { ns: 'stores' }))
        ipc.invoke('llm:cancel', requestId).catch(() => undefined)
        cleanup()
      }, STREAM_IDLE_TIMEOUT_MS)
    }

    // 注册流式事件监听
    const unsubChunk = ipc.on('llm:stream-chunk', (data) => {
      if (data.requestId === requestId) {
        armIdle()
        callbacks.onChunk?.(data.chunk)
      }
    })

    const unsubDone = ipc.on('llm:stream-done', (data) => {
      if (data.requestId === requestId) {
        callbacks.onDone?.(data.fullText, data.usage, data.meta)
        cleanup()
      }
    })

    // 输出被长度上限截断：主进程把已产出的部分内容送回来，能续写的调用方据此补齐
    const unsubTruncated = ipc.on('llm:stream-truncated', (data) => {
      if (data.requestId === requestId) {
        if (callbacks.onTruncated) {
          callbacks.onTruncated(data.partialText, data.usage, data.meta)
        } else {
          // 未声明处理截断的调用方：退回原有报错行为
          callbacks.onError?.(i18n.t('llm.outputTruncated', { ns: 'stores' }))
        }
        cleanup()
      }
    })

    const unsubError = ipc.on('llm:stream-error', (data) => {
      if (data.requestId === requestId) {
        callbacks.onError?.(data.error)
        cleanup()
      }
    })

    const cleanup = () => {
      clearIdle()
      unsubChunk()
      unsubDone()
      unsubTruncated()
      unsubError()
      const reqs = new Map(get().activeRequests)
      reqs.delete(requestId)
      set({ activeRequests: reqs })
    }

    // 标记活跃请求
    const reqs = new Map(get().activeRequests)
    reqs.set(requestId, { status: 'running', text: '' })
    set({ activeRequests: reqs })

    // 发起流式请求
    armIdle()
    const startRes = (await ipc.invoke('llm:generate-stream', requestId, {
      modelId: mid,
      messages,
      stream: true,
      responseFormat: options?.responseFormat as { type: 'json_object' | 'text' } | undefined,
      thinking: options?.thinking,
      maxTokens: options?.maxTokens,
      purpose: options?.purpose
    })) as { requestId: string; started: boolean } | undefined

    // 模型未找到/未配置时主进程直接返回 started:false，不会发任何流事件；
    // 必须主动报错，否则调用方会永远等待 onDone/onError
    if (startRes && startRes.started === false) {
      callbacks.onError?.(i18n.t('llm.modelNotFound', { ns: 'stores' }))
      cleanup()
    }

    return requestId
  },

  cancelGeneration: async (requestId) => {
    await ipc.invoke('llm:cancel', requestId)
  },

  testConnection: async (model) => {
    return ipc.invoke('llm:test-connection', model)
  },

  previewAutoConfig: async (input) => {
    if (!ipc.isElectron) {
      return { success: false, availableModels: [], modelsFromProvider: false, error: 'NOT_ELECTRON' }
    }
    try {
      return await ipc.invoke('llm:autoconfig-plan', input)
    } catch (error) {
      return { success: false, availableModels: [], modelsFromProvider: false, error: String(error) }
    }
  },

  autoConfigure: async (input) => {
    if (!ipc.isElectron) return { success: false, tested: false, error: 'NOT_ELECTRON' }
    try {
      const result = await ipc.invoke('llm:autoconfig-apply', input)
      if (result.success) {
        // 主进程刚写完配置，这里重新拉一遍，保证界面上的默认模型/用途绑定与落盘一致
        await get().loadModels()
        const [defaultModelId, defaultEmbeddingModelId, purposeModels] = await Promise.all([
          ipc.invoke('llm:get-default-model').catch(() => null),
          ipc.invoke('llm:get-default-embedding-model').catch(() => null),
          ipc.invoke('llm:get-purpose-models').catch(() => ({} as PurposeModelBindings)),
        ])
        set({ defaultModelId, defaultEmbeddingModelId, purposeModels })
      }
      return result
    } catch (error) {
      return { success: false, tested: false, error: String(error) }
    }
  },
}))
