/**
 * 服务商目录（Provider Catalog）—— 纯数据，不依赖 i18n / React / Electron
 *
 * 为什么单独抽一个文件：
 *   自动配置引擎需要「认得出这是哪家服务商」，而这段逻辑主进程和渲染进程都要用。
 *   provider-presets.ts 里带了 i18n（渲染进程专用），主进程 import 会把整套语言包
 *   打进主进程产物，所以把纯数据下沉到这里，两边各自按需组装。
 *
 * 每条目录项除了基本信息，还带三组识别线索：
 *   - keyPrefixes：API Key 前缀（如 sk-or-v1- / gsk_ / AIza）
 *   - hosts：接口域名（如 api.deepseek.com）
 *   - modelPrefixes：模型名前缀（如 deepseek / glm）
 * 自动配置按「显式声明 → 域名 → Key 前缀 → 模型名」的顺序匹配，命中即停。
 */

/** 单个模型的目录项 */
export interface CatalogModel {
  name: string
  maxTokens: number
}

/** 服务商目录项 */
export interface ProviderCatalogEntry {
  provider: string
  displayName: string
  baseUrl: string
  protocol: 'openai' | 'gemini'
  models: CatalogModel[]
  embeddingModels: string[]
  /** API Key 前缀线索 */
  keyPrefixes: string[]
  /** 接口域名线索（小写，不含协议） */
  hosts: string[]
  /** 模型名前缀线索（小写） */
  modelPrefixes: string[]
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    protocol: 'openai',
    models: [
      { name: 'gpt-4o', maxTokens: 16384 },
      { name: 'gpt-4o-mini', maxTokens: 16384 },
      { name: 'gpt-4-turbo', maxTokens: 4096 },
      { name: 'gpt-3.5-turbo', maxTokens: 4096 },
    ],
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    keyPrefixes: ['sk-proj-', 'sk-svcacct-'],
    hosts: ['api.openai.com'],
    modelPrefixes: ['gpt-', 'chatgpt', 'o1', 'o3', 'o4'],
  },
  {
    provider: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'openai',
    models: [
      { name: 'deepseek-chat', maxTokens: 65536 },
      { name: 'deepseek-reasoner', maxTokens: 65536 },
    ],
    embeddingModels: [],
    keyPrefixes: [],
    hosts: ['api.deepseek.com'],
    modelPrefixes: ['deepseek'],
  },
  {
    /** 智谱 BigModel — OpenAI 兼容协议，API 路径为 /v4 */
    provider: 'bigmodel',
    displayName: 'BigModel（智谱）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai',
    models: [
      { name: 'glm-4.5', maxTokens: 65536 },
      { name: 'glm-4.5-air', maxTokens: 65536 },
      { name: 'glm-4.6', maxTokens: 65536 },
      { name: 'glm-4.7', maxTokens: 65536 },
      { name: 'glm-4.7-flashx', maxTokens: 65536 },
      { name: 'glm-5-turbo', maxTokens: 65536 },
      { name: 'glm-5', maxTokens: 65536 },
    ],
    embeddingModels: ['embedding-3'],
    keyPrefixes: [],
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    modelPrefixes: ['glm-', 'charglm', 'cogview', 'cogvideo'],
  },
  {
    provider: 'gemini',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    protocol: 'gemini',
    models: [
      { name: 'gemini-3.1-pro-preview', maxTokens: 65536 },
      { name: 'gemini-3-flash-preview', maxTokens: 65536 },
    ],
    embeddingModels: ['text-embedding-004'],
    keyPrefixes: ['AIza'],
    hosts: ['generativelanguage.googleapis.com'],
    modelPrefixes: ['gemini'],
  },
  {
    provider: 'ollama',
    displayName: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434',
    protocol: 'openai',
    models: [
      { name: 'llama3.3', maxTokens: 4096 },
      { name: 'llama3.2', maxTokens: 4096 },
      { name: 'qwen2.5', maxTokens: 8192 },
      { name: 'qwen2.5-coder', maxTokens: 8192 },
      { name: 'mistral', maxTokens: 4096 },
      { name: 'phi4', maxTokens: 4096 },
      { name: 'gemma3', maxTokens: 8192 },
    ],
    embeddingModels: ['nomic-embed-text', 'mxbai-embed-large', 'bge-m3'],
    keyPrefixes: [],
    hosts: ['localhost:11434', '127.0.0.1:11434'],
    // 故意留空：llama / gemma / phi 在 Groq、OpenRouter 等云服务上同样常见，
    // 只凭模型名判定成「本地 Ollama」会给出一个自信但错误的地址。
    modelPrefixes: [],
  },
  {
    provider: 'moonshot',
    displayName: 'Moonshot（Kimi）',
    baseUrl: 'https://api.moonshot.cn/v1',
    protocol: 'openai',
    models: [
      { name: 'kimi-latest', maxTokens: 131072 },
      { name: 'moonshot-v1-128k', maxTokens: 131072 },
      { name: 'moonshot-v1-32k', maxTokens: 32768 },
      { name: 'moonshot-v1-8k', maxTokens: 8192 },
    ],
    embeddingModels: [],
    keyPrefixes: [],
    hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
    modelPrefixes: ['moonshot', 'kimi'],
  },
  {
    provider: 'qwen',
    displayName: '通义千问（DashScope）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    models: [
      { name: 'qwen-max', maxTokens: 32768 },
      { name: 'qwen-plus', maxTokens: 131072 },
      { name: 'qwen-turbo', maxTokens: 8192 },
      { name: 'qwen-long', maxTokens: 131072 },
    ],
    embeddingModels: ['text-embedding-v3', 'text-embedding-v2'],
    keyPrefixes: [],
    hosts: ['dashscope.aliyuncs.com'],
    modelPrefixes: ['qwen', 'qwq', 'tongyi'],
  },
  {
    provider: 'siliconflow',
    displayName: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    protocol: 'openai',
    models: [],
    embeddingModels: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5'],
    keyPrefixes: [],
    hosts: ['api.siliconflow.cn', 'api.siliconflow.com'],
    // 聚合平台：qwen / deepseek / glm 都会撞车，只靠域名识别
    modelPrefixes: [],
  },
  {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
    keyPrefixes: ['sk-or-v1-'],
    hosts: ['openrouter.ai'],
    modelPrefixes: [],
  },
  {
    provider: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'openai',
    models: [
      { name: 'llama-3.3-70b-versatile', maxTokens: 32768 },
      { name: 'llama-3.1-8b-instant', maxTokens: 8192 },
    ],
    embeddingModels: [],
    keyPrefixes: ['gsk_'],
    hosts: ['api.groq.com'],
    modelPrefixes: [],
  },
  {
    provider: 'xai',
    displayName: 'xAI（Grok）',
    baseUrl: 'https://api.x.ai/v1',
    protocol: 'openai',
    models: [
      { name: 'grok-3', maxTokens: 131072 },
      { name: 'grok-2-latest', maxTokens: 131072 },
    ],
    embeddingModels: [],
    keyPrefixes: ['xai-'],
    hosts: ['api.x.ai'],
    modelPrefixes: ['grok'],
  },
  {
    provider: 'mistral',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    protocol: 'openai',
    models: [
      { name: 'mistral-large-latest', maxTokens: 8192 },
      { name: 'mistral-small-latest', maxTokens: 8192 },
    ],
    embeddingModels: ['mistral-embed'],
    keyPrefixes: [],
    hosts: ['api.mistral.ai'],
    modelPrefixes: ['mistral', 'magistral', 'codestral', 'ministral'],
  },
  {
    provider: 'minimax',
    displayName: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    protocol: 'openai',
    models: [
      { name: 'abab6.5s-chat', maxTokens: 32768 },
      { name: 'MiniMax-Text-01', maxTokens: 131072 },
    ],
    embeddingModels: [],
    keyPrefixes: [],
    hosts: ['api.minimax.chat', 'api.minimaxi.com'],
    modelPrefixes: ['minimax', 'abab'],
  },
  {
    provider: 'doubao',
    displayName: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai',
    models: [],
    embeddingModels: ['doubao-embedding'],
    keyPrefixes: [],
    hosts: ['ark.cn-beijing.volces.com'],
    modelPrefixes: ['doubao'],
  },
  {
    provider: 'hunyuan',
    displayName: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    protocol: 'openai',
    models: [
      { name: 'hunyuan-turbos-latest', maxTokens: 32768 },
      { name: 'hunyuan-large', maxTokens: 32768 },
    ],
    embeddingModels: [],
    keyPrefixes: [],
    hosts: ['api.hunyuan.cloud.tencent.com'],
    modelPrefixes: ['hunyuan'],
  },
  {
    provider: 'stepfun',
    displayName: '阶跃星辰 StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    protocol: 'openai',
    models: [
      { name: 'step-2-16k', maxTokens: 16384 },
      { name: 'step-1-8k', maxTokens: 8192 },
    ],
    embeddingModels: [],
    keyPrefixes: [],
    hosts: ['api.stepfun.com'],
    modelPrefixes: ['step-', 'stepfun'],
  },
]

/** 按 provider 取目录项 */
export const CATALOG_BY_PROVIDER = new Map(PROVIDER_CATALOG.map((entry) => [entry.provider, entry]))

/** 猜一个「够用就行」的输出上限 */
export const DEFAULT_MAX_TOKENS = 8192