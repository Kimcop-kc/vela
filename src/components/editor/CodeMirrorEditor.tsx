import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import CodeMirror, { ReactCodeMirrorRef, EditorView, ViewUpdate, ExternalChange } from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { openSearchPanel, closeSearchPanel, search } from '@codemirror/search'
import { Sparkles, Bold } from 'lucide-react'
import { applyInlineDiffSelection, computeInlineDiff } from '../../services/text-diff'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

/** 统计字数（简单字符数统计，包含空格换行等格式符） */
function countWords(text: string): number {
  return text.length
}

/** 选区上下文注入长度：让改写贴合语境，又不至于把提示词撑大。 */
const CONTEXT_BEFORE_CHARS = 400
const CONTEXT_AFTER_CHARS = 200

/** 去掉模型泄漏在流里的思维链（<think>…</think>），避免预览和「替换」把思考过程写进正文。 */
function stripThinkingSegments(text: string): string {
  return (text || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
}

/** 选区 AI 动作；replace=用结果覆盖选区，append=把结果插到选区之后（续写用） */
type AiAction = {
  key: string
  label: string
  color: string
  prompt: string
  mode: 'replace' | 'append'
  /** 调用用途：决定走哪类模型（refine_* → 精修用途；generate_* → 生成用途） */
  purpose: string
}

export type CodeMirrorEditorProps = {
  content: string
  filePath?: string
  editable?: boolean
  onChange?: (content: string) => void
  onSave?: (content: string) => Promise<void> | void
  onCharCountChange?: (count: number) => void
  placeholder?: string
  hideStatusBar?: boolean
  mode?: 'document' | 'prose'
}

export default function CodeMirrorEditor({
  content,
  editable = true,
  onChange,
  onSave,
  onCharCountChange,
  mode = 'document',
}: CodeMirrorEditorProps) {
  const { t } = useTranslation('editors')
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const AI_ACTIONS = useMemo<AiAction[]>(() => [
    { key: 'refine', label: t('codeMirrorEditor.aiRefine'), color: 'text-blue-400', prompt: t('codeMirrorEditor.aiRefinePrompt'), mode: 'replace', purpose: 'refine_selection' },
    { key: 'expand', label: t('codeMirrorEditor.aiExpand'), color: 'text-amber-400', prompt: t('codeMirrorEditor.aiExpandPrompt'), mode: 'replace', purpose: 'refine_selection' },
    { key: 'continue', label: t('codeMirrorEditor.aiContinue'), color: 'text-purple-400', prompt: t('codeMirrorEditor.aiContinuePrompt'), mode: 'append', purpose: 'generate_selection_continuation' },
    { key: 'dialogue', label: t('codeMirrorEditor.aiDialogue'), color: 'text-emerald-400', prompt: t('codeMirrorEditor.aiDialoguePrompt'), mode: 'replace', purpose: 'refine_selection' },
    { key: 'deai', label: t('codeMirrorEditor.aiDeai'), color: 'text-rose-400', prompt: t('codeMirrorEditor.aiDeaiPrompt'), mode: 'replace', purpose: 'deai_revise' },
  ], [t])

  // 避免状态回路
  const lastEmittedContentRef = useRef(content)
  const [editorContent, setEditorContent] = useState(content)
  const hasEmittedInitialCount = useRef(false)

  // 更新内容
  useEffect(() => {
    // 首次挂载时主动汇报一次字数
    if (!hasEmittedInitialCount.current) {
      onCharCountChange?.(countWords(content))
      hasEmittedInitialCount.current = true
    }

    if (content !== lastEmittedContentRef.current) {
      lastEmittedContentRef.current = content
      setEditorContent(content)
      // 内容经由外部变动（例如打开新文件）
      onCharCountChange?.(countWords(content))
    }
  }, [content, onCharCountChange])

  // ===== Bubble Menu 逻辑 =====
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [bubblePos, setBubblePos] = useState({ top: 0, left: 0 })
  const bubbleRef = useRef<HTMLDivElement>(null)
  /** 气泡锚点（视口坐标）：选区当前在屏幕上的位置，滚动/缩放后据此重算落点 */
  const bubbleAnchorRef = useRef<{ top: number; bottom: number; centerLeft: number } | null>(null)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [activeAIAction, setActiveAIAction] = useState<string | null>(null)
  const [loadingDots, setLoadingDots] = useState('.')
  const [selectionRange, setSelectionRange] = useState<{ from: number, to: number } | null>(null)
  const [aiGenerating, setAiGenerating] = useState(false)
  /** 本次结果是否被输出上限截断：预览里给出提示，避免用户直接把不完整的改写替换进正文 */
  const [aiTruncated, setAiTruncated] = useState(false)
  /** 本次动作处理前的原文：用于「对比」视图标出改动 */
  const [aiOriginal, setAiOriginal] = useState('')
  /** 本次动作是覆盖选区还是插到选区之后：决定按钮文案与是否提供对比 */
  const [aiActionMode, setAiActionMode] = useState<'replace' | 'append'>('replace')
  const [aiPreviewView, setAiPreviewView] = useState<'diff' | 'changes' | 'result'>('diff')
  /** 「逐条」视图里被退回的改动序号：退回的改动保持原文，其余采用改写 */
  const [aiRejectedChanges, setAiRejectedChanges] = useState<Set<number>>(new Set())
  const [aiExtra, setAiExtra] = useState('')
  const aiRequestIdRef = useRef<string | null>(null)
  /** 最近一次发起动作（含选区范围）：供「重新生成」与「替换/插入」复用 */
  const lastActionRef = useRef<{ action: AiAction, from: number, to: number } | null>(null)
  const cancelledRef = useRef(false)

  // 改动对比：只在「覆盖型」动作、且已有产出时计算；续写是新增内容，不存在可对比的原文。
  // 流式生成期间不计算（半成品对比没意义，而且每来一段都重算会拖慢预览）。
  const aiDiff = useMemo(
    () => (aiGenerating || aiActionMode !== 'replace' || !aiOriginal || !aiResult
      ? null
      : computeInlineDiff(aiOriginal, aiResult)),
    [aiGenerating, aiActionMode, aiOriginal, aiResult],
  )

  /** 中断进行中的选区 AI 请求（请求已结束则为无操作） */
  const cancelAIAction = useCallback(() => {
    cancelledRef.current = true
    const reqId = aiRequestIdRef.current
    aiRequestIdRef.current = null
    setAiGenerating(false)
    if (reqId) {
      void import('../../stores/llm-store').then(m => m.useLLMStore.getState().cancelGeneration(reqId))
    }
  }, [])

  useEffect(() => {
    if (aiResult === '') {
      const timer = setInterval(() => setLoadingDots(d => d.length >= 3 ? '.' : d + '.'), 400)
      return () => clearInterval(timer)
    }
  }, [aiResult])

  const handleUpdate = useCallback((v: ViewUpdate) => {
    if (v.docChanged) {
      const newText = v.state.doc.toString()
      lastEmittedContentRef.current = newText
      if (!v.transactions.some(transaction => transaction.annotation(ExternalChange))) onChange?.(newText)

      const cnt = countWords(newText)
      onCharCountChange?.(cnt)
    }

    if (v.selectionSet || v.docChanged || v.geometryChanged) {
      const sel = v.state.selection.main
      // 预览面板还开着时用户又改了正文或把光标落回编辑器：放弃这次预览并中断请求。
      // 否则 aiResult 会一直有值，后续任何选中都弹不出 AI 菜单。
      if (aiResult !== null && (v.docChanged || sel.empty || sel.to - sel.from < 1)) {
        cancelAIAction()
        setAiResult(null)
        setAiTruncated(false)
        setAiOriginal('')
        setAiRejectedChanges(new Set())
        setSelectionRange(null)
        setBubbleOpen(false)
        return
      }
      if (sel.empty || sel.to - sel.from < 1) {
        setBubbleOpen(false)
        setSelectionRange(null)
      } else {
        setSelectionRange({ from: sel.from, to: sel.to })
        // 交由下方的 useEffect 进行精准防越界座标计算与位置同步
        if (!aiResult) {
          setBubbleOpen(true)
        }
      }
    }
  }, [onChange, onCharCountChange, aiResult, cancelAIAction])

  // 按「实测的气泡尺寸」决定落点：水平贴边。垂直方向上方放不下就翻到选区下方，
  // 保证无论面板多高（动作菜单很矮、预览面板很高）都不会被窗口裁掉。
  const applyBubblePosition = useCallback(() => {
    const view = editorRef.current?.view
    const anchor = bubbleAnchorRef.current
    if (!view || !anchor) return
    const viewRect = view.scrollDOM.getBoundingClientRect()
    const width = bubbleRef.current?.offsetWidth ?? 0
    const height = bubbleRef.current?.offsetHeight ?? 0
    const gap = 5
    const margin = 8

    let left = anchor.centerLeft
    if (width) {
      const min = viewRect.left + width / 2 + margin
      const max = viewRect.right - width / 2 - margin
      if (min <= max) left = Math.max(min, Math.min(max, left))
    }

    // 气泡用 -translate-y-full 定位，所以这里的 top 就是气泡的底边。
    let bottom = Math.min(anchor.top - gap, viewRect.bottom - margin)
    if (height && bottom - height < viewRect.top + margin) {
      bottom = Math.min(anchor.bottom + height + gap, viewRect.bottom - margin)
    }

    setBubblePos(prev => (
      Math.abs(prev.top - bottom) < 0.5 && Math.abs(prev.left - left) < 0.5
        ? prev
        : { top: bottom, left }
    ))
  }, [])

  useEffect(() => {
    if (!bubbleOpen || !selectionRange || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const scrollDOM = view.scrollDOM;

    let rafId: number;

    const updatePosition = () => {
      const viewRect = scrollDOM.getBoundingClientRect()
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        // 选区整体滚出视口：收起气泡
        if (rect.bottom < viewRect.top || rect.top > viewRect.bottom || rect.width === 0) {
          setBubbleOpen(false)
          return
        }
        bubbleAnchorRef.current = { top: rect.top, bottom: rect.bottom, centerLeft: rect.left + rect.width / 2 }
      } else {
        const coords = view.coordsAtPos(selectionRange.from)
        if (!coords) {
          setBubbleOpen(false)
          return
        }
        bubbleAnchorRef.current = { top: coords.top, bottom: coords.bottom, centerLeft: coords.left }
      }
      applyBubblePosition()
    }

    const onScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updatePosition)
    }

    scrollDOM.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })

    // 初始化计算需要等待 CM 渲染映射完成，确保获取到正确的 DOM Range
    rafId = requestAnimationFrame(updatePosition)

    return () => {
      scrollDOM.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [bubbleOpen, selectionRange, applyBubblePosition])

  // 气泡在「动作菜单 ↔ 预览面板」「生成中 ↔ 已完成」之间切换时尺寸会变，
  // 渲染后用实测尺寸重新落点，避免加长/加高的气泡溢出窗口。
  useLayoutEffect(() => {
    if (!bubbleOpen) return
    applyBubblePosition()
  }, [bubbleOpen, aiResult, activeAIAction, aiGenerating, aiTruncated, selectionRange, applyBubblePosition])

  // 主题配置
  const cmTheme = useMemo(() => EditorView.theme({
    "&": {
      height: "100%",
      // prose/document 都是写作场景，使用写作字体
      // 其他模式（如代码等）继承父元素 UI 字体
      fontSize: mode === 'prose' ? "16px" : "14px",
      backgroundColor: "transparent",
      fontFamily: (mode === 'prose' || mode === 'document') ? "var(--font-writing)" : "inherit"
    },
    ".cm-scroller": {
      overflow: "auto",
      paddingBottom: "100px",
      fontFamily: (mode === 'prose' || mode === 'document') ? "var(--font-writing)" : "inherit"
    },
    ".cm-content": {
      width: "100%",
      maxWidth: "800px",
      margin: "0 auto",
      padding: "40px",
      lineHeight: "1.8",
      color: "var(--color-text)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionBackground, .cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-hover) !important" },
    ".cm-line": { padding: "0" },
  }), [mode])

  // 构建扩展
  const extensions = useMemo(() => {
    const exts = [
      search({ top: true }),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Tab',
          run: (target) => {
            // 插入两个 em 空格（U+2003）= 2em = 标准中文首行缩进两字符宽
            // 使用 \u2003 而非 \u3000（全角空格），因为 em 空格在任何 Unicode 字体下
            // 都精确等于 1em，不依赖 CJK 字体加载
            target.dispatch({
              changes: { from: target.state.selection.main.head, insert: '\u2003\u2003' },
              selection: { anchor: target.state.selection.main.head + 2 }
            })
            return true
          }
        }
      ]),
      // 汉化 Search / UI 文本（涵盖官方大小写所有变种）
      EditorState.phrases.of({
        "Find": t('codeMirrorEditor.search.find'),
        "find": t('codeMirrorEditor.search.find'),
        "Replace": t('codeMirrorEditor.search.replace'),
        "replace": t('codeMirrorEditor.search.replace'),
        "Replace all": t('codeMirrorEditor.search.replaceAll'),
        "replace all": t('codeMirrorEditor.search.replaceAll'),
        "Next": t('codeMirrorEditor.search.next'),
        "next": t('codeMirrorEditor.search.next'),
        "Previous": t('codeMirrorEditor.search.previous'),
        "previous": t('codeMirrorEditor.search.previous'),
        "All": t('codeMirrorEditor.search.all'),
        "all": t('codeMirrorEditor.search.all'),
        "Match case": t('codeMirrorEditor.search.matchCase'),
        "match case": t('codeMirrorEditor.search.matchCase'),
        "Regexp": t('codeMirrorEditor.search.regexp'),
        "regexp": t('codeMirrorEditor.search.regexp'),
        "by word": t('codeMirrorEditor.search.byWord'),
        "By word": t('codeMirrorEditor.search.byWord'),
        "Close": t('codeMirrorEditor.search.close'),
        "close": t('codeMirrorEditor.search.close')
      })
    ]
    if (mode === 'document') {
      exts.push(markdown({ base: markdownLanguage, codeLanguages: languages }))
    }
    return exts
  }, [mode, t])

  // AI 菜单处理（流式调用，实时显示生成内容）
  const runAIAction = async (action: AiAction, from: number, to: number, extra = '') => {
    const view = editorRef.current?.view
    if (!view) return
    const selectedText = view.state.sliceDoc(from, to)
    if (!selectedText.trim()) return

    lastActionRef.current = { action, from, to }
    cancelledRef.current = false

    // 带上选区前后的少量上下文，让改写贴合语境；续写尤其依赖前文。
    const before = view.state.sliceDoc(Math.max(0, from - CONTEXT_BEFORE_CHARS), from).trim()
    const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + CONTEXT_AFTER_CHARS)).trim()
    const extraText = extra.trim()
    const instruction = extraText
      ? `${t('codeMirrorEditor.aiExtraLabel')}${extraText}\n${action.prompt}`
      : action.prompt
    const userParts = [`${t('codeMirrorEditor.aiRequirementLabel')}${instruction}`]
    if (before) userParts.push(`${t('codeMirrorEditor.aiContextBeforeLabel')}\n${before}`)
    userParts.push(`${t('codeMirrorEditor.aiSelectionLabel')}\n${selectedText}`)
    if (after) userParts.push(`${t('codeMirrorEditor.aiContextAfterLabel')}\n${after}`)

    setActiveAIAction(action.label)
    setAiActionMode(action.mode)
    setAiOriginal(selectedText)
    setAiRejectedChanges(new Set())
    setAiResult('')
    setAiGenerating(true)
    setAiTruncated(false)
    try {
      const { useLLMStore } = await import('../../stores/llm-store')
      const reqId = await useLLMStore.getState().generateStream(
        [
          { role: 'system', content: t('codeMirrorEditor.aiSystemPrompt') },
          { role: 'user', content: userParts.join('\n\n') },
        ],
        {
          onChunk: (chunk) => {
            setAiResult(prev => stripThinkingSegments((prev ?? '') + chunk))
          },
          onDone: (text) => {
            setAiResult(stripThinkingSegments(text || ''))
            setAiGenerating(false)
            setAiTruncated(false)
            aiRequestIdRef.current = null
          },
          // 选区较长时可能撞上输出上限：保留已产出的部分，总比直接报「生成失败」好。
          onTruncated: (partial) => {
            setAiResult(stripThinkingSegments(partial || ''))
            setAiGenerating(false)
            setAiTruncated(true)
            aiRequestIdRef.current = null
          },
          onError: () => {
            setAiGenerating(false)
            aiRequestIdRef.current = null
            // 用户主动停止时保留已生成的部分，不覆盖成「生成失败」
            if (!cancelledRef.current) setAiResult(t('codeMirrorEditor.generateFailed'))
          },
        },
        undefined,
        { thinking: false, purpose: action.purpose }
      )
      aiRequestIdRef.current = reqId || null
    } catch (e) {
      console.error(e)
      setAiGenerating(false)
      if (!cancelledRef.current) setAiResult(t('codeMirrorEditor.generateFailed'))
    }
  }

  const handleRegenerateAI = () => {
    const last = lastActionRef.current
    if (last) void runAIAction(last.action, last.from, last.to, aiExtra)
  }

  const handleStopAI = () => {
    // 停止但保留已生成的部分，供用户决定是否采用
    cancelAIAction()
  }

  const handleAcceptAI = () => {
    const view = editorRef.current?.view
    const last = lastActionRef.current
    // 「逐条」里退回过改动时，只把选中的那几处写回去，其余保持原文
    const textToApply = aiResult && aiDiff && aiRejectedChanges.size > 0
      ? applyInlineDiffSelection(aiDiff, aiRejectedChanges)
      : aiResult
    if (view && last && textToApply) {
      if (last.action.mode === 'append') {
        // 续写：插到选区之后，保留原文
        view.dispatch({
          changes: { from: last.to, to: last.to, insert: textToApply },
          selection: { anchor: last.to + textToApply.length },
        })
      } else {
        view.dispatch({ changes: { from: last.from, to: last.to, insert: textToApply } })
      }
    }
    setAiResult(null)
    setAiGenerating(false)
    setAiTruncated(false)
    setAiOriginal('')
    setAiRejectedChanges(new Set())
    aiRequestIdRef.current = null
    setBubbleOpen(false)
  }

  const handleRejectAI = () => {
    cancelAIAction()
    setAiResult(null)
    setAiTruncated(false)
    setAiOriginal('')
    setAiRejectedChanges(new Set())
    setBubbleOpen(false)
  }

  // 固定 basicSetup 内存引用，防止 React 每次渲染生成新对象导致内部扩展被重载（搜索框消失的罪魁祸首）
  const cmBasicSetup = useMemo(() => ({
    lineNumbers: false,
    foldGutter: false,
    dropCursor: false,
    allowMultipleSelections: false,
    indentOnInput: false,
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
    searchKeymap: true,
  }), [])

  return (
    <div className="relative h-full flex flex-col min-h-0"
      onKeyDownCapture={(e) => {
        // 全局捕获 Ctrl+F 实现搜索框 Toggle（解决搜索框内焦点时快捷键失效的问题）
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          e.stopPropagation()
          const view = editorRef.current?.view
          if (view) {
            const searchPanel = view.dom.querySelector('.cm-search')
            if (searchPanel) {
              closeSearchPanel(view)
              view.focus()
            } else {
              openSearchPanel(view)
            }
          }
        }
      }}
      onKeyDown={(e) => {
        // 捕获 Cmd+S 保存
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          onSave?.(lastEmittedContentRef.current)
        }
      }}>
      <div className="flex-1 relative min-h-0 overflow-hidden"
        onMouseDown={() => {
          // 点击空白处关闭 Bubble Menu
          if (aiResult) return;
          // setBubbleOpen(false) 交给 handleUpdate 里面的 selection empty 判断即可
        }}>
        <div className="absolute inset-0">
          <CodeMirror
            ref={editorRef}
            value={editorContent}
            height="100%"
            className="h-full"
            theme={cmTheme}
            extensions={extensions}
            readOnly={!editable}
            basicSetup={cmBasicSetup}
            onUpdate={handleUpdate}
          />
        </div>
      </div>

      {/* Bubble Menu */}
      {bubbleOpen && bubblePos.top !== 0 && (
        <div
          ref={bubbleRef}
          className="fixed z-50 flex items-center gap-0.5 p-1 rounded-xl border select-none shadow-xl transform -translate-x-1/2 -translate-y-full"
          style={{
            top: bubblePos.top,
            left: bubblePos.left,
            backgroundColor: 'var(--color-sidebar)',
            borderColor: 'var(--color-border)',
          }}
          // 点按钮时阻止默认行为，避免编辑器失焦导致选区丢失；输入框需要能正常获得焦点
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
          }}
        >
          {aiResult !== null ? (
            <div className="w-[420px] max-h-[260px] overflow-y-auto p-2">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div
                  className="text-[10px] font-medium flex items-center gap-1"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <Sparkles size={11} style={{ color: 'var(--color-accent)' }} /> {activeAIAction ? t('codeMirrorEditor.aiPreviewWithAction', { action: activeAIAction }) : t('codeMirrorEditor.aiPreview')}
                </div>
                {aiResult !== '' && aiActionMode === 'replace' && (
                  <div
                    className="flex items-center rounded-md overflow-hidden flex-shrink-0"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    {(aiDiff && !aiDiff.tooLong ? (['diff', 'changes', 'result'] as const) : (['diff', 'result'] as const)).map(view => (
                      <button
                        key={view}
                        className="px-2 py-0.5 text-[10px] transition-colors"
                        style={{
                          backgroundColor: aiPreviewView === view ? 'var(--color-accent)' : 'transparent',
                          color: aiPreviewView === view ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
                        }}
                        onClick={() => setAiPreviewView(view)}
                      >
                        {view === 'diff'
                          ? t('codeMirrorEditor.compareView')
                          : view === 'changes' ? t('codeMirrorEditor.changesView') : t('codeMirrorEditor.resultView')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 流式输入中显示动态内容 */}
              {aiResult === '' ? (
                <div
                  className="text-xs leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('codeMirrorEditor.generating')} {loadingDots}
                </div>
              ) : aiDiff && aiPreviewView === 'changes' ? (
                <>
                  <div
                    className="text-[10px] mb-1.5 flex items-center justify-between gap-2"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <span>{t('codeMirrorEditor.changesSelected', { selected: aiDiff.changeGroups - aiRejectedChanges.size, total: aiDiff.changeGroups })}</span>
                    <span className="flex items-center gap-2">
                      <button
                        className="transition-colors"
                        style={{ color: 'var(--color-accent)' }}
                        onClick={() => setAiRejectedChanges(new Set())}
                      >{t('codeMirrorEditor.selectAll')}</button>
                      <button
                        className="transition-colors"
                        style={{ color: 'var(--color-accent)' }}
                        onClick={() => setAiRejectedChanges(new Set(aiDiff.changes.map((_, index) => index)))}
                      >{t('codeMirrorEditor.selectNone')}</button>
                    </span>
                  </div>
                  <div className="mb-3">
                    {aiDiff.changes.map((change, index) => {
                      const keep = !aiRejectedChanges.has(index)
                      const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text)
                      return (
                        <label
                          key={index}
                          className="flex items-start gap-2 py-1 cursor-pointer"
                          style={{ opacity: keep ? 1 : 0.55 }}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 flex-shrink-0"
                            checked={keep}
                            onChange={() => setAiRejectedChanges(previous => {
                              const next = new Set(previous)
                              if (next.has(index)) next.delete(index)
                              else next.add(index)
                              return next
                            })}
                          />
                          <span className="text-[11px] leading-snug flex-1 break-all">
                            {change.removed && (
                              <span style={{ color: 'var(--color-error)', textDecoration: keep ? 'line-through' : 'none' }}>
                                {clip(change.removed)}
                              </span>
                            )}
                            {change.removed && change.added && (
                              <span style={{ color: 'var(--color-text-muted)' }}> → </span>
                            )}
                            {change.added && (
                              <span style={{ color: keep ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                {clip(change.added)}
                              </span>
                            )}
                            {!change.removed && !change.added && (
                              <span style={{ color: 'var(--color-text-muted)' }}>（无变化）</span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </>
              ) : aiDiff && aiPreviewView === 'diff' ? (
                <>
                  <div
                    className="text-[10px] mb-1 flex items-center gap-2"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {aiDiff.identical
                      ? t('codeMirrorEditor.diffIdentical')
                      : t('codeMirrorEditor.diffStats', { count: aiDiff.changeGroups, added: aiDiff.addedChars, removed: aiDiff.removedChars })}
                    {aiDiff.tooLong && <span style={{ color: 'var(--color-warning-text)' }}>{t('codeMirrorEditor.diffTooLong')}</span>}
                  </div>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    {aiDiff.segments.map((seg, index) =>
                      seg.kind === 'same' ? (
                        <span key={index}>{seg.text}</span>
                      ) : seg.kind === 'add' ? (
                        <span
                          key={index}
                          style={{ color: 'var(--color-success)', backgroundColor: 'rgba(var(--color-success-rgb), 0.18)' }}
                        >
                          {seg.text}
                        </span>
                      ) : (
                        <span
                          key={index}
                          style={{
                            color: 'var(--color-error)',
                            backgroundColor: 'rgba(var(--color-error-rgb), 0.16)',
                            textDecoration: 'line-through',
                          }}
                        >
                          {seg.text}
                        </span>
                      )
                    )}
                  </div>
                </>
              ) : (
                <div
                  className="text-xs whitespace-pre-wrap leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {aiResult}
                </div>
              )}
              {aiTruncated && (
                <div
                  className="text-[10px] leading-snug mb-2"
                  style={{ color: 'var(--color-warning-text)' }}
                >
                  {t('codeMirrorEditor.aiTruncated')}
                </div>
              )}
              <input
                className="w-full mb-2 px-2 py-1 text-[11px] rounded-md outline-none"
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
                placeholder={t('codeMirrorEditor.extraPlaceholder')}
                value={aiExtra}
                onChange={e => setAiExtra(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !aiGenerating) {
                    e.preventDefault()
                    handleRegenerateAI()
                  }
                }}
              />
              <div className="flex items-center gap-2 justify-end">
                {aiGenerating ? (
                  <button
                    className="px-2.5 py-1 text-xs rounded-md transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={handleStopAI}
                  >{t('codeMirrorEditor.stop')}</button>
                ) : (
                  <button
                    className="px-2.5 py-1 text-xs rounded-md transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={handleRegenerateAI}
                  >{t('codeMirrorEditor.regenerate')}</button>
                )}
                <button
                  className="px-2.5 py-1 text-xs rounded-md transition-colors"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={handleRejectAI}
                >{t('codeMirrorEditor.cancel')}</button>
                <button
                  className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  disabled={!aiResult || aiGenerating}
                  onClick={handleAcceptAI}
                >{aiActionMode === 'append'
                  ? t('codeMirrorEditor.insert')
                  : aiRejectedChanges.size > 0 && aiDiff ? t('codeMirrorEditor.replaceSelected') : t('codeMirrorEditor.replace')}</button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'document' && (
                <>
                  <button
                    className="p-1 rounded"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => {
                      // document模式下的格式转换
                      if (selectionRange && editorRef.current?.view) {
                        const view = editorRef.current.view
                        const text = view.state.sliceDoc(selectionRange.from, selectionRange.to)
                        view.dispatch({
                          changes: { from: selectionRange.from, to: selectionRange.to, insert: `**${text}**` }
                        })
                      }
                    }}
                  ><Bold size={14} /></button>
                  <div className="w-[1px] h-3 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
                </>
              )}
              <div
                className="flex items-center gap-0.5 pl-0.5 pr-1 text-[10px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Sparkles size={11} />AI
              </div>
              {AI_ACTIONS.map(action => (
                <button
                  key={action.key}
                  className={cn('p-1.5 rounded flex items-center gap-1 transition-colors', action.color)}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => {
                    if (!selectionRange) return
                    setAiExtra('')
                    void runAIAction(action, selectionRange.from, selectionRange.to)
                  }}
                >
                  <span className="text-[10px] tracking-widest">{action.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
