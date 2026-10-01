/**
 * configure_model — 一键配置 / 更换 AI 模型
 *
 * 用户不必理解「服务商 / 协议 / 接口地址 / 模型标识」这套概念，
 * 把 Key 丢过来（顺手带上模型名更好）就行，解析交给 buildAutoConfigPlan。
 *
 * 注意两点：
 *   1. 这条 Tool 不会「自己编」Key —— 只透传用户原话；缺 Key 时明确要求用户补。
 *   2. 写配置属于敏感操作，保留确认卡片；确认框里能看到即将写入的内容。
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { useLLMStore } from '../../../stores/llm-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

/** 主进程回传的、可以直接翻译的错误码 */
const KNOWN_ERROR_CODES = ['NO_INPUT', 'NO_API_KEY', 'NO_BASE_URL', 'NO_MODEL']

export const configureModelTool = buildAgentTool({
  name: 'configure_model',
  description: t('agent.tools.configureModel.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      credentials: {
        type: 'string',
        description: t('agent.tools.configureModel.credentialsDesc'),
      },
      model_name: {
        type: 'string',
        description: t('agent.tools.configureModel.modelNameDesc'),
      },
      base_url: {
        type: 'string',
        description: t('agent.tools.configureModel.baseUrlDesc'),
      },
      provider: {
        type: 'string',
        description: t('agent.tools.configureModel.providerDesc'),
      },
      set_default: {
        type: 'boolean',
        description: t('agent.tools.configureModel.setDefaultDesc'),
      },
    },
    required: ['credentials'],
  },
  requiresConfirmation: true,
  execute: async (args) => {
    const credentials = String(args.credentials ?? '').trim()
    const modelName = String(args.model_name ?? '').trim()
    const baseUrl = String(args.base_url ?? '').trim()
    const provider = String(args.provider ?? '').trim()

    if (!credentials) {
      return { success: false, content: '', error: t('agent.tools.configureModel.missingCredentials') }
    }

    const result = await useLLMStore.getState().autoConfigure({
      text: credentials,
      modelName: modelName || undefined,
      baseUrl: baseUrl || undefined,
      provider: provider || undefined,
      setAsDefault: args.set_default === undefined ? true : Boolean(args.set_default),
    })

    if (!result.success || !result.plan) {
      const code = result.error ?? ''
      const detail = KNOWN_ERROR_CODES.includes(code)
        ? i18n.t(`autoConfig.error.${code}`, { ns: 'settings' })
        : code
      return { success: false, content: '', error: t('agent.tools.configureModel.failed', { error: detail }) }
    }

    const lines = [
      t('agent.tools.configureModel.configured', {
        model: result.plan.modelName,
        provider: result.plan.displayName,
      }),
    ]
    if (result.embeddingModelId && result.plan.embeddingSuggestion) {
      lines.push(t('agent.tools.configureModel.configuredEmbedding', { name: result.plan.embeddingSuggestion }))
    }
    if (result.testError) {
      lines.push(t('agent.tools.configureModel.testFailed', { error: result.testError }))
    }

    return { success: true, content: lines.join('\n') }
  },
})