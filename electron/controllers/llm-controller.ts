import { ipcMain, BrowserWindow } from 'electron'
import { readJsonFile, writeJsonFile, MODELS_CONFIG_PATH, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { ModelProfile, GlobalConfig, LLMPurposeCategory, PurposeModelBindings } from '../../src/shared/ipc-channels'
import { PURPOSE_CATEGORIES, categorizePurpose, pickModelIdForCategory } from '../../src/shared/purpose-routing'
import { LLMFactory } from '../llm/llm-factory'
import { listOllamaModels } from '../llm/ollama-models'
import { joinMessages, recordLLMCall } from '../llm/call-log'
import { randomUUID } from 'node:crypto'
import {
  buildAutoConfigPlan,
  planToModelProfile,
  pickDefaultModelFromList,
  isEmbeddingOnlyPlan,
  type AutoConfigInput,
} from '../../src/shared/auto-config'
import { CATALOG_BY_PROVIDER } from '../../src/shared/provider-catalog'
import { listProviderModels } from '../llm/provider-models'

const activeStreams = new Map<string, AbortController>()

function loadModelConfigs(): ModelProfile[] {
  return readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
}

function saveModelConfigs(models: ModelProfile[]) {
  writeJsonFile(MODELS_CONFIG_PATH, models)
}

function getModelConfig(modelId: string): ModelProfile | null {
  const models = loadModelConfigs()
  return models.find((m) => m.id === modelId) ?? null
}

/**
 * 解析本次调用实际使用的模型。
 *
 * 显式指定的模型优先；缺失或已被删除时按「用途绑定 → 默认模型 → 模型池」回退，
 * 回退链与渲染进程共用 src/shared/purpose-routing.ts，保证两侧结论一致。
 */
function resolveModelForRequest(modelId: string | undefined, purpose?: string): ModelProfile | null {
  if (modelId) {
    const explicit = getModelConfig(modelId)
    if (explicit) return explicit
  }
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const resolvedId = pickModelIdForCategory(categorizePurpose(purpose), {
    models: loadModelConfigs(),
    bindings: config.purposeModels ?? {},
    defaultModelId: config.defaultModelId ?? null,
    defaultEmbeddingModelId: config.defaultEmbeddingModelId ?? null,
  })
  return resolvedId ? getModelConfig(resolvedId) : null
}

/**
 * 探一次连通性：生成模型发一句最短的话，向量模型跑一次最小嵌入。
 * 「测试连接」按钮和「一键配置」保存前都用它，避免两条路径判断不一致。
 */
async function probeModel(model: ModelProfile): Promise<{ success: boolean; error?: string }> {
  try {
    applyProxyConfig()
    if (model.purposes?.includes('embedding')) {
      const { generateEmbeddings } = await import('../embedding')
      await generateEmbeddings(['hello'], model.protocol, model)
      return { success: true, error: undefined }
    }
    const provider = LLMFactory.getProvider(model)
    const res = await provider.generate(model, [{ role: 'user', content: 'Say "hello" and nothing else.' }], {
      temperature: 0.7,
      maxTokens: 10,
    })
    return { success: res.success !== false, error: res.error }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

function applyProxyConfig() {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.proxy?.enabled && config.proxy.host) {
      const proxyUrl = config.proxy.type === 'socks5'
        ? `socks5://${config.proxy.host}:${config.proxy.port}`
        : `http://${config.proxy.host}:${config.proxy.port}`
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.https_proxy = proxyUrl
    } else {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
    }
  } catch { /* 忽略 */ }
}

export function registerLLMController() {
  ipcMain.handle('llm:ollama-models', async (_event, baseUrl: string, apiKey?: string) => {
    try {
      return { success: true, models: await listOllamaModels(baseUrl, apiKey) }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const code = /^(INVALID_URL|INVALID_RESPONSE|HTTP_\d+)$/.test(message) ? message :
        error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTION_FAILED'
      return { success: false, models: [], error: code }
    }
  })
  ipcMain.handle('llm:generate', async (_event, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; purpose?: string }) => {
    const startedAt = Date.now()
    const promptText = joinMessages(request.messages)
    try {
      applyProxyConfig()
      const model = resolveModelForRequest(request.modelId, request.purpose)
      if (!model) {
        recordLLMCall({ modelId: request.modelId, purpose: request.purpose, promptText, completionText: '', startedAt, success: false, errorMessage: '未找到模型配置' })
        return { success: false, content: '', error: '未找到模型配置' }
      }

      const provider = LLMFactory.getProvider(model)
      const result = await provider.generate(model, request.messages, {
        temperature: request.temperature ?? model.temperature,
        maxTokens: request.maxTokens ?? model.maxTokens,
        responseFormat: request.responseFormat,
        thinking: request.thinking,
      })
      recordLLMCall({
        model,
        modelId: model.id,
        purpose: request.purpose,
        promptText,
        completionText: result.content ?? '',
        usage: result.usage,
        startedAt,
        success: result.success !== false,
        errorMessage: result.error,
      })
      return result
    } catch (error) {
      recordLLMCall({ modelId: request.modelId, purpose: request.purpose, promptText, completionText: '', startedAt, success: false, errorMessage: String(error) })
      return { success: false, content: '', error: String(error) }
    }
  })

  ipcMain.handle('llm:generate-stream', async (event, requestId: string, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; purpose?: string }) => {
    applyProxyConfig()
    const model = resolveModelForRequest(request.modelId, request.purpose)
    const startedAt = Date.now()
    const promptText = joinMessages(request.messages)
    if (!model) {
      recordLLMCall({ modelId: request.modelId, purpose: request.purpose, promptText, completionText: '', startedAt, success: false, errorMessage: '未找到模型配置' })
      return { requestId, started: false }
    }

    const abortController = new AbortController()
    activeStreams.set(requestId, abortController)
    const win = BrowserWindow.fromWebContents(event.sender)

    const provider = LLMFactory.getProvider(model)
    
    // We do not await this globally since it's streaming independently
    provider.generateStream(model, request.messages, {
      temperature: request.temperature ?? model.temperature,
      maxTokens: request.maxTokens ?? model.maxTokens,
      responseFormat: request.responseFormat,
      thinking: request.thinking,
      signal: abortController.signal,
      onChunk: (chunk: string) => win?.webContents.send('llm:stream-chunk', { requestId, chunk }),
      onDone: (fullText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }, meta?: { truncated?: boolean; finishReason?: string }) => {
        recordLLMCall({
          model,
          modelId: model.id,
          purpose: request.purpose,
          promptText,
          completionText: fullText ?? '',
          usage,
          startedAt,
          success: true,
        })
        win?.webContents.send('llm:stream-done', { requestId, fullText, usage, meta })
        activeStreams.delete(requestId)
      },
      onError: (error: string) => {
        recordLLMCall({
          model,
          modelId: model.id,
          purpose: request.purpose,
          promptText,
          completionText: '',
          startedAt,
          success: false,
          errorMessage: error,
        })
        win?.webContents.send('llm:stream-error', { requestId, error })
        activeStreams.delete(requestId)
      },
      // 输出被长度上限截断：把已产出的部分内容交给渲染进程，由其决定续写还是报错
      onTruncated: (partialText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }, meta?: { truncated?: boolean; finishReason?: string }) => {
        // 截断时 token 已真实消耗，按成功计入统计，避免漏记
        recordLLMCall({
          model,
          modelId: model.id,
          purpose: request.purpose,
          promptText,
          completionText: partialText ?? '',
          usage,
          startedAt,
          success: true,
          errorMessage: '输出达到长度上限',
        })
        win?.webContents.send('llm:stream-truncated', { requestId, partialText, usage, meta })
        activeStreams.delete(requestId)
      },
    })

    return { requestId, started: true }
  })

  ipcMain.handle('llm:cancel', async (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (controller) {
      controller.abort()
      activeStreams.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('llm:list-models', async () => loadModelConfigs())

  ipcMain.handle('llm:save-model', async (_event, model: ModelProfile) => {
    try {
      const models = loadModelConfigs()
      const idx = models.findIndex((m) => m.id === model.id)
      if (idx >= 0) models[idx] = model
      else models.push(model)
      saveModelConfigs(models)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:delete-model', async (_event, modelId: string) => {
    try {
      const models = loadModelConfigs().filter((m) => m.id !== modelId)
      saveModelConfigs(models)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:set-default-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:get-default-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultModelId
  })

  ipcMain.handle('llm:set-default-embedding-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultEmbeddingModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:get-default-embedding-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultEmbeddingModelId ?? null
  })

  /** 用途 → 模型绑定表（多模型管理：先导入模型，再为每个用途挑选模型） */
  ipcMain.handle('llm:get-purpose-models', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.purposeModels ?? {}
  })

  ipcMain.handle('llm:set-purpose-model', async (_event, purpose: LLMPurposeCategory, modelId: string | null) => {
    try {
      if (!PURPOSE_CATEGORIES.includes(purpose)) return { success: false, error: 'INVALID_PURPOSE' }
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      const purposeModels: PurposeModelBindings = { ...(config.purposeModels ?? {}) }
      // 传 null 表示解除绑定，回落到默认模型
      if (modelId) purposeModels[purpose] = modelId
      else delete purposeModels[purpose]
      config.purposeModels = purposeModels
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:test-connection', async (_event, model: ModelProfile) => probeModel(model))

  /**
   * 一键配置 · 预演
   *
   * 解析粘贴文本 → 推断服务商 →（有 Key 时）问服务商要一份真实模型列表。
   * 全程只读，不写任何配置文件：用户先看清识别结果，再决定要不要应用。
   */
  ipcMain.handle('llm:autoconfig-plan', async (_event, input: AutoConfigInput) => {
    try {
      applyProxyConfig()
      const plan = buildAutoConfigPlan(input ?? {})
      let availableModels: string[] = []
      let modelsFromProvider = false

      if (plan.baseUrl && (plan.apiKey || plan.provider === 'ollama')) {
        try {
          availableModels = await listProviderModels(plan.baseUrl, plan.apiKey, plan.protocol)
          modelsFromProvider = availableModels.length > 0
        } catch { /* 拉不到就退回本地目录，不打断流程 */ }
      }
      if (availableModels.length === 0) {
        const entry = CATALOG_BY_PROVIDER.get(plan.provider)
        availableModels = [
          ...(entry?.models ?? []).map((model) => model.name),
          ...(entry?.embeddingModels ?? []),
        ]
      }

      return { success: true, plan, availableModels, modelsFromProvider }
    } catch (error) {
      return { success: false, availableModels: [], modelsFromProvider: false, error: String(error) }
    }
  })

  /**
   * 一键配置 · 落盘
   *
   * 写三样东西：模型池条目、默认模型、用途绑定；服务商有向量模型时顺带把知识库也配好。
   * 连通性测试失败不阻断保存（代理/网络抖动很常见），但结果会回给界面显著提示。
   */
  ipcMain.handle('llm:autoconfig-apply', async (_event, input: AutoConfigInput) => {
    try {
      applyProxyConfig()
      const request = input ?? {}
      let probe = buildAutoConfigPlan(request)

      // 没给模型名：现问服务商要一份候选，挑一个最像「聊天主力」的
      if (probe.needsModelPick && probe.baseUrl && (probe.apiKey || probe.provider === 'ollama')) {
        try {
          const candidates = await listProviderModels(probe.baseUrl, probe.apiKey, probe.protocol)
          const picked = pickDefaultModelFromList(candidates, CATALOG_BY_PROVIDER.get(probe.provider))
          if (picked) {
            probe = buildAutoConfigPlan({
              ...request,
              text: undefined,
              apiKey: probe.apiKey,
              baseUrl: probe.baseUrl,
              modelName: picked,
              provider: probe.provider === 'custom' ? undefined : probe.provider,
            })
          }
        } catch { /* 下一段用本地目录兜底 */ }
      }
      if (probe.needsModelPick) {
        const entry = CATALOG_BY_PROVIDER.get(probe.provider)
        const fallback = pickDefaultModelFromList((entry?.models ?? []).map((model) => model.name), entry)
        if (fallback) {
          probe = buildAutoConfigPlan({
            ...request,
            text: undefined,
            apiKey: probe.apiKey,
            baseUrl: probe.baseUrl,
            modelName: fallback,
            provider: probe.provider === 'custom' ? undefined : probe.provider,
          })
        }
      }

      const plan = probe
      if (!plan.ok) return { success: false, plan, tested: false, error: plan.errorCode }

      const models = loadModelConfigs()
      // 同一个「服务商 + 地址 + 模型」视为同一条配置，覆盖而不是堆重复项
      const existingIndex = models.findIndex((model) =>
        model.provider === plan.provider && model.baseUrl === plan.baseUrl && model.modelName === plan.modelName)
      const reused = existingIndex >= 0
      const modelId = reused ? models[existingIndex].id : randomUUID()
      const profile = planToModelProfile(plan, modelId)

      const check = await probeModel(profile)
      if (reused) models[existingIndex] = profile
      else models.push(profile)

      // 顺带把向量模型也建好：知识库、章节记忆、拆书都依赖它，用户通常不知道该配
      let embeddingModelId: string | undefined
      if ((request.includeEmbedding ?? true) && plan.embeddingSuggestion && !isEmbeddingOnlyPlan(plan)) {
        const embeddingName = plan.embeddingSuggestion
        const embeddingId = models.find((model) =>
          model.provider === plan.provider && model.baseUrl === plan.baseUrl && model.modelName === embeddingName)?.id ?? randomUUID()
        const embeddingProfile: ModelProfile = {
          ...profile,
          id: embeddingId,
          name: `${plan.displayName} · ${embeddingName}`,
          modelName: embeddingName,
          purposes: ['embedding'],
        }
        const embeddingIndex = models.findIndex((model) => model.id === embeddingId)
        if (embeddingIndex >= 0) models[embeddingIndex] = embeddingProfile
        else models.push(embeddingProfile)
        embeddingModelId = embeddingId
      }
      saveModelConfigs(models)

      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      if (request.bindPurposes !== false) {
        const purposeModels: PurposeModelBindings = { ...(config.purposeModels ?? {}) }
        const embeddingOnly = isEmbeddingOnlyPlan(plan)
        if (!embeddingOnly) for (const purpose of plan.purposes) purposeModels[purpose] = modelId
        if (embeddingModelId) purposeModels.embedding = embeddingModelId
        if (embeddingOnly) purposeModels.embedding = modelId
        config.purposeModels = purposeModels
      }

      if (request.setAsDefault !== false) {
        if (isEmbeddingOnlyPlan(plan)) config.defaultEmbeddingModelId = modelId
        else config.defaultModelId = modelId
      }
      if (embeddingModelId && !config.defaultEmbeddingModelId) config.defaultEmbeddingModelId = embeddingModelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)

      return {
        success: true,
        plan,
        modelId,
        embeddingModelId,
        tested: true,
        testError: check.success ? undefined : (check.error ?? 'TEST_FAILED'),
        reused,
      }
    } catch (error) {
      return { success: false, tested: false, error: String(error) }
    }
  })
}
