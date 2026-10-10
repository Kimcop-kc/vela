/**
 * 向量模型可用性判断
 *
 * 之前只看 apiKey：本地推理（Ollama 等）不填密钥，就被判定成「没有向量模型」，
 * 于是导入不生成向量、检索也不算查询向量，语义检索永远不生效。
 */
import { describe, expect, it } from 'vitest'
import { canUseEmbedding } from '../embedding'

describe('canUseEmbedding', () => {
  it('本地 Ollama 模型没有 apiKey 也应尝试向量化', () => {
    expect(canUseEmbedding({ apiKey: '', provider: 'ollama', purposes: ['embedding'] })).toBe(true)
    expect(canUseEmbedding({ apiKey: '', provider: 'ollama' })).toBe(true)
  })

  it('声明了向量能力的本地模型同样可用', () => {
    expect(canUseEmbedding({ apiKey: '', provider: 'lmstudio', purposes: ['embedding'] })).toBe(true)
  })

  it('远程模型有密钥可用', () => {
    expect(canUseEmbedding({ apiKey: 'sk-test', provider: 'openai', purposes: ['embedding'] })).toBe(true)
  })

  it('既没密钥、也没声明向量能力的模型不尝试', () => {
    expect(canUseEmbedding({ apiKey: '', provider: 'deepseek', purposes: ['generation'] })).toBe(false)
    expect(canUseEmbedding({ apiKey: '', purposes: [] })).toBe(false)
    expect(canUseEmbedding({})).toBe(false)
  })
})
