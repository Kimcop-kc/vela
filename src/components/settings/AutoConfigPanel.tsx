/**
 * 一键配置模型（Auto Config）
 *
 * 面向「不想研究服务商/协议/接口地址/模型标识」的用户：
 * 把 API Key 粘进来（顺手带上模型名或地址更好），点一次按钮就把模型配好、
 * 设为默认、绑定用途；服务商有向量模型时连知识库一起配好。
 *
 * 两段式交互是刻意的：
 *   1. 「识别」只读预演，把识别结果和判断依据摊开给用户看；
 *   2. 识别缺东西时停在预览态，允许手动补，而不是直接报错让人重来。
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Loader2, Sparkles, Wand2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import type { AutoConfigApplyResult, AutoConfigPlan, LLMPurposeCategory } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { PURPOSE_CATEGORY_LABEL_KEY } from '../../shared/purpose-routing'
import { useLLMStore } from '../../stores/llm-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../lib/utils'

interface AutoConfigPanelProps {
  /** 配置成功后回调，例如首次启动向导据此关闭自己 */
  onDone?: (result: AutoConfigApplyResult) => void
}

const EVIDENCE_KEY: Record<string, string> = {
  explicit: 'autoConfig.evidenceExplicit',
  host: 'autoConfig.evidenceHost',
  keyPrefix: 'autoConfig.evidenceKeyPrefix',
  modelName: 'autoConfig.evidenceModelName',
  fallback: 'autoConfig.evidenceFallback',
}

export default function AutoConfigPanel({ onDone }: AutoConfigPanelProps) {
  const { t } = useTranslation('settings')
  const previewAutoConfig = useLLMStore((s) => s.previewAutoConfig)
  const autoConfigure = useLLMStore((s) => s.autoConfigure)

  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'idle' | 'detecting' | 'applying'>('idle')
  const [plan, setPlan] = useState<AutoConfigPlan | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [fromProvider, setFromProvider] = useState(false)
  const [result, setResult] = useState<AutoConfigApplyResult | null>(null)
  const [error, setError] = useState('')
  const [advanced, setAdvanced] = useState(false)

  const presetMap = useMemo(() => new Map(BUILTIN_PRESETS.map((p) => [p.provider, p])), [])

  const purposesLabel = (purposes: LLMPurposeCategory[]) =>
    purposes.map((p) => t(PURPOSE_CATEGORY_LABEL_KEY[p])).join(' / ')

  /** 把当前输入（含手动改动过的字段）打包成一次调用 */
  const buildInput = useCallback((override?: Partial<AutoConfigPlan>) => {
    const merged = plan && override ? { ...plan, ...override } : override
    return {
      text: merged && override ? undefined : text,
      apiKey: merged?.apiKey ?? undefined,
      modelName: merged?.modelName ?? undefined,
      baseUrl: merged?.baseUrl ?? undefined,
      provider: merged?.provider ?? undefined,
      purposes: merged?.purposes,
    }
  }, [plan, text])

  const updatePlan = (patch: Partial<AutoConfigPlan>) => {
    setPlan((prev) => (prev ? { ...prev, ...patch } : prev))
    setError('')
  }

  const handleDetect = async () => {
    if (!text.trim()) return
    setBusy('detecting')
    setError('')
    setResult(null)
    const res = await previewAutoConfig({ text })
    setBusy('idle')
    if (!res.success || !res.plan) {
      setError(t('autoConfig.error.UNKNOWN'))
      return
    }
    setPlan(res.plan)
    setCandidates(res.availableModels ?? [])
    setFromProvider(res.modelsFromProvider)
    if (!res.plan.ok) setAdvanced(true)
  }

  const handleApply = async (override?: Partial<AutoConfigPlan>) => {
    setBusy('applying')
    setError('')
    const applied = await autoConfigure(buildInput(override))
    setBusy('idle')
    if (applied.plan) {
      setPlan(applied.plan)
      setCandidates((prev) => (prev.length > 0 ? prev : prev))
    }
    if (!applied.success) {
      setError(applied.error === 'NO_MODEL' || applied.error === 'NO_API_KEY' || applied.error === 'NO_BASE_URL' || applied.error === 'NO_INPUT'
        ? t(`autoConfig.error.${applied.error}`)
        : (applied.error ?? t('autoConfig.error.UNKNOWN')))
      return
    }
    setResult(applied)
    onDone?.(applied)
  }

  /** 识别成功时一键到底；缺字段时先停在预览让用户补 */
  const handlePrimary = async () => {
    if (!plan) return handleDetect()
    if (!plan.ok) return handleApply()
    return handleApply()
  }

  const handleProviderChange = (provider: string) => {
    if (!plan) return
    const preset = presetMap.get(provider)
    const firstModel = preset?.models[0]?.name ?? ''
    const nextModelName = plan.modelName || firstModel
    setPlan({
      ...plan,
      provider,
      displayName: preset?.displayName ?? provider,
      protocol: preset?.protocol === 'gemini' ? 'gemini' : 'openai',
      baseUrl: preset?.baseUrl ?? plan.baseUrl,
      modelName: nextModelName,
      maxTokens: preset?.models.find((m) => m.name === nextModelName)?.maxTokens ?? plan.maxTokens,
      embeddingSuggestion: preset?.embeddingModels[0] ?? null,
    })
    setError('')
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="flex items-center gap-1.5">
          <Wand2 size={13} />
          {t('autoConfig.textareaLabel')}
        </Label>
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); setError('') }}
          placeholder={t('autoConfig.placeholder')}
          rows={4}
          className="font-mono text-xs"
        />
        <p className="text-[0.68rem] mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {t('autoConfig.hint')}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handlePrimary} disabled={busy !== 'idle' || (!plan && !text.trim())}>
          {busy === 'idle' ? <Sparkles size={14} /> : <Loader2 size={14} className="animate-spin" />}
          {busy === 'detecting' ? t('autoConfig.detecting')
            : busy === 'applying' ? t('autoConfig.applying')
              : plan ? t('autoConfig.save') : t('autoConfig.detect')}
        </Button>
        {plan && (
          <Button size="sm" variant="ghost" onClick={() => { setPlan(null); setResult(null); setError('') }}>
            {t('autoConfig.retry')}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-error)' }}>
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {plan && (
        <div
          className="rounded-xl p-3 space-y-2.5"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('autoConfig.detected')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {plan.displayName}
            </span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('autoConfig.modelName')}</dt>
            <dd className="font-mono truncate" style={{ color: 'var(--color-text)' }}>{plan.modelName || '—'}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('autoConfig.baseUrl')}</dt>
            <dd className="truncate" style={{ color: 'var(--color-text)' }}>{plan.baseUrl || '—'}</dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('autoConfig.apiKey')}</dt>
            <dd className="font-mono truncate" style={{ color: 'var(--color-text)' }}>
              {plan.apiKey ? `${plan.apiKey.slice(0, 6)}••••${plan.apiKey.slice(-4)}` : '—'}
            </dd>
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('autoConfig.purposes')}</dt>
            <dd style={{ color: 'var(--color-text)' }}>{purposesLabel(plan.purposes)}</dd>
          </dl>

          {plan.evidence.length > 0 && (
            <ul className="text-[0.68rem] space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {plan.evidence.map((item, index) => (
                <li key={`${item.code}-${index}`}>· {t(EVIDENCE_KEY[item.code] ?? 'autoConfig.evidenceFallback', { value: item.value })}</li>
              ))}
            </ul>
          )}

          {!plan.ok && (
            <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-error)' }}>
              {plan.missing.map((field) => (
                <li key={field}>· {t(`autoConfig.missing.${field}`)}</li>
              ))}
            </ul>
          )}

          {candidates.length > 0 && (
            <p className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
              {fromProvider
                ? t('autoConfig.modelsFromProvider', { count: candidates.length })
                : t('autoConfig.modelsFromCatalog', { count: candidates.length })}
            </p>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[0.68rem] hover:opacity-80"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('autoConfig.advanced')}
          </button>

          {advanced && (
            <div className="space-y-2 pt-1">
              <div>
                <Label className="text-[0.68rem]">{t('autoConfig.provider')}</Label>
                <NativeSelect value={plan.provider} onChange={(e) => handleProviderChange(e.target.value)}>
                  {BUILTIN_PRESETS.map((preset) => (
                    <option key={preset.provider} value={preset.provider}>{preset.displayName ?? preset.provider}</option>
                  ))}
                  {!presetMap.has(plan.provider) && <option value={plan.provider}>{plan.provider}</option>}
                </NativeSelect>
              </div>
              <div>
                <Label className="text-[0.68rem]">{t('autoConfig.baseUrl')}</Label>
                <Input value={plan.baseUrl} onChange={(e) => updatePlan({ baseUrl: e.target.value })} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[0.68rem]">{t('autoConfig.apiKey')}</Label>
                <Input value={plan.apiKey} onChange={(e) => updatePlan({ apiKey: e.target.value })} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[0.68rem]">{t('autoConfig.modelName')}</Label>
                <Input
                  value={plan.modelName}
                  onChange={(e) => updatePlan({ modelName: e.target.value })}
                  list="vela-auto-config-models"
                  className="font-mono text-xs"
                />
                <datalist id="vela-auto-config-models">
                  {candidates.map((name) => <option key={name} value={name} />)}
                </datalist>
              </div>
            </div>
          )}
        </div>
      )}

      {result?.success && (
        <div
          className={cn('rounded-xl p-3 space-y-1 text-xs')}
          style={{ border: '1px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
        >
          <p className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-accent)' }}>
            <CheckCircle2 size={14} />
            {t('autoConfig.success')}
            {result.reused && <span style={{ color: 'var(--color-text-muted)' }}>{t('autoConfig.successReused')}</span>}
          </p>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {t('autoConfig.successDetail', { purposes: result.plan ? purposesLabel(result.plan.purposes) : '' })}
          </p>
          {result.embeddingModelId && result.plan?.embeddingSuggestion && (
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {t('autoConfig.successEmbedding', { name: result.plan.embeddingSuggestion })}
            </p>
          )}
          {result.testError && (
            <p className="flex items-start gap-1.5" style={{ color: 'var(--color-error)' }}>
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{t('autoConfig.testFailed', { error: result.testError })}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}