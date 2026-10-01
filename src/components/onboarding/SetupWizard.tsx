/**
 * 首次启动的「一键配置模型」向导
 *
 * 触发条件：模型池为空。一个模型都没有时，Vela 的所有功能都用不了，
 * 而这个界面又恰好最需要引导 —— 所以只要还没配好，每次启动都主动弹一次，
 * 直到用户真的配成功（或主动说「以后再说」）。
 */
import { useEffect, useRef, useState } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/Dialog'
import { Button } from '../ui/Button'
import AutoConfigPanel from '../settings/AutoConfigPanel'
import { useLLMStore } from '../../stores/llm-store'
import { useOnboardingStore } from '../../stores/onboarding-store'
import { useLayoutStore } from '../../stores/layout-store'
import type { AutoConfigApplyResult } from '../../shared/ipc-channels'

/** 成功后停留一会儿，让用户看清「配了什么」，再自动收起 */
const AUTO_CLOSE_DELAY_MS = 1800

export default function SetupWizard() {
  const { t } = useTranslation('dialogs')
  const setupOpen = useOnboardingStore((s) => s.setupOpen)
  const openSetup = useOnboardingStore((s) => s.openSetup)
  const closeSetup = useOnboardingStore((s) => s.closeSetup)
  const models = useLLMStore((s) => s.models)
  const loaded = useLLMStore((s) => s.loaded)
  const openSettings = useLayoutStore((s) => s.openSettings)
  const [succeeded, setSucceeded] = useState<AutoConfigApplyResult | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 模型池为空就是「还没配好」，无论之前点过多少次「以后再说」
  useEffect(() => {
    if (!loaded || models.length > 0 || setupOpen) return
    openSetup()
  }, [loaded, models.length, setupOpen, openSetup])

  // 别和启动时的功能巡览抢同一个位置
  useEffect(() => {
    if (setupOpen) useOnboardingStore.setState({ open: false })
  }, [setupOpen])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const handleDone = (result: AutoConfigApplyResult) => {
    setSucceeded(result)
    // 这里不用等用户点确认：配置已经落盘，收起后界面本身就是最好的反馈
    if (result.testError) return
    closeTimer.current = setTimeout(() => {
      closeSetup(true)
      setSucceeded(null)
    }, AUTO_CLOSE_DELAY_MS)
  }

  const handleLater = () => {
    closeSetup(false)
    setSucceeded(null)
    openSettings()
  }

  return (
    <Dialog open={setupOpen} onOpenChange={(v) => { if (!v) closeSetup(false) }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--color-accent)]" />
            {t('setup.title')}
          </DialogTitle>
          <DialogDescription>{t('setup.description')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <p className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            <KeyRound size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
            <span>{t('setup.whyKey')}</span>
          </p>

          <AutoConfigPanel onDone={handleDone} />

          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" size="sm" onClick={handleLater}>
              {t('setup.later')}
            </Button>
            <span className="text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
              {succeeded && !succeeded.testError ? t('setup.saved') : t('setup.settingsHint')}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}