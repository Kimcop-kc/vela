/**
 * 内置 Prompt 模板：文风分析与去 AI 味
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const STYLE_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // 文风仿写：把参考文本编译成有证据的可执行文风指南
  // ================================================================
  {
    key: 'style_imitation',
    name: '文风仿写编译',
    description: '按激活的仿写 Skill，把参考文本编译为有证据的可执行文风指南',
    systemRole: '你是一位文学风格分析专家，擅长把「感觉」拆解成可复现、可执行的写作指令。',
    variables: {
      skill_method: '被激活的仿写 Skill 提供的分析方法',
      style_metrics: '参考文本的量化特征（本地确定性统计结果）',
      reference_text: '参考文本（待仿写的作者正文）',
    },
    content: `请阅读参考文本，把它编译成一份「有证据、可执行」的文风指南。

【分析方法（由被激活的 Skill 提供，请严格按它执行）】
{{skill_method}}

【参考文本的量化特征（本地统计，客观依据）】
{{style_metrics}}

【参考文本】
{{reference_text}}

【硬性要求】
- 归纳作者**稳定重复**的写法，不要复述剧情，不要评价作品好坏。
- 每条结论必须附 1-3 条原文引文作为证据，且引文必须**逐字照抄**（不要改写、不要用省略号省略）。找不到证据的结论一律不要写。
- 结论要写成**可执行的写作指令**（祈使句），例如「多用短句断句，单句控制在 12 字以内」；不要写「文笔细腻」这类无法执行的空话。
- 量化特征只是佐证，不要直接把它抄成结论；要结合原文解释它意味着什么。
- 不要输出与上述量化特征明显矛盾的结论。

【输出格式】
只输出 JSON，不要输出任何解释：
{
  "rules": [
    {
      "category": "syntax",
      "statement": "可执行的写作指令（祈使句）",
      "evidence": [{ "quote": "参考文本原文，逐字照抄" }],
      "confidence": "high"
    }
  ]
}

category 只能取以下之一：
voice（叙述视角与人称）、syntax（句式与句长）、rhythm（段落与节奏）、
dialogue（对话与叙述配比）、lexicon（用词倾向）、imagery（意象与修辞）、punctuation（标点习惯）`,
    contentLocalized: {
      en: `Read the reference text and compile it into an evidence-backed, executable style guide.

【Analysis Method (provided by the active Skill — follow it strictly)】
{{skill_method}}

【Quantitative Profile Of The Reference Text (local measurement, objective basis)】
{{style_metrics}}

【Reference Text】
{{reference_text}}

【Hard Requirements】
- Summarize the author's **consistently repeated** techniques. Do not retell the plot and do not judge the work.
- Every conclusion must cite 1-3 exact quotes from the reference text, copied character by character (no paraphrase, no ellipses). If you cannot find evidence, omit the conclusion entirely.
- Write each conclusion as an **executable writing directive** (imperative form), e.g. "Prefer short sentences, keeping most under 12 characters". Avoid unactionable remarks such as "graceful prose".
- The quantitative profile is supporting evidence, not a conclusion to copy. Explain what it means in terms of the actual text.
- Do not output conclusions that clearly contradict the quantitative profile above.

【Output Format】
Output JSON only, with no explanation:
{
  "rules": [
    {
      "category": "syntax",
      "statement": "executable writing directive (imperative)",
      "evidence": [{ "quote": "exact text from the reference" }],
      "confidence": "high"
    }
  ]
}

category must be one of:
voice, syntax, rhythm, dialogue, lexicon, imagery, punctuation`,
      ru: `Прочитайте референсный текст и скомпилируйте из него стилевое руководство с доказательствами и исполнимыми правилами.

【Метод анализа (предоставлен активным Skill — следуйте ему строго)】
{{skill_method}}

【Количественный профиль референсного текста (локальные измерения, объективная основа)】
{{style_metrics}}

【Референсный текст】
{{reference_text}}

【Жёсткие требования】
- Обобщайте **устойчиво повторяющиеся** приёмы автора. Не пересказывайте сюжет и не оценивайте произведение.
- Каждый вывод должен сопровождаться 1–3 точными цитатами из референсного текста, скопированными знак в знак (без пересказа и многоточий). Если доказательств нет, вывод не приводите.
- Формулируйте вывод как **исполнимую писательскую директиву** (повелительное наклонение), например «Предпочитайте короткие фразы, в основном до 12 знаков». Избегайте формулировок вроде «изящный слог».
- Количественный профиль — это подтверждение, а не готовый вывод. Объясните, что он означает применительно к тексту.
- Не выводите выводы, явно противоречащие количественному профилю.

【Формат вывода】
Только JSON, без пояснений:
{
  "rules": [
    {
      "category": "syntax",
      "statement": "исполнимая писательская директива",
      "evidence": [{ "quote": "дословный фрагмент референса" }],
      "confidence": "high"
    }
  ]
}

category принимает одно из значений:
voice, syntax, rhythm, dialogue, lexicon, imagery, punctuation`,
    },
    systemRoleLocalized: {
      en: 'You are a literary style analyst, skilled at breaking "feel" down into reproducible, executable writing directives.',
      ru: 'Вы — аналитик литературного стиля, умеющий разложить «ощущение» на воспроизводимые исполнимые писательские директивы.'
    },
  },

  // ================================================================
  // 去 AI 味修订（仅在用户显式发起时运行）
  // ================================================================
  {
    key: 'deai_revise',
    name: '去 AI 味修订',
    description: '按激活的去 AI 味 Skill，针对被标记的位置做语义改写（仅在用户显式发起时运行）',
    systemRole: '你是一位资深小说编辑，擅长把「读起来像机器写的」段落改回有人的语感与体温。',
    variables: {
      skill_method: '被激活的去 AI 味 Skill 提供的语义改写方法',
      trace_brief: '被标记的可修订位置（含原文与量化指标）',
      draft_content: '待修订的章节正文',
    },
    content: `请修订以下章节，消除被标记位置上的「AI 痕迹」。

【改写方法（由被激活的 Skill 提供，请严格按它执行）】
{{skill_method}}

【被标记的可修订位置（本地检测结果，仅供参考，不是必须全改）】
{{trace_brief}}

【待修订正文】
{{draft_content}}

【硬性要求】
- 只做**语义层面的改写**：调整用词、句式、句长节奏、叙述方式。不要引入任何新情节。
- 严禁改动：人物名、地名、专有名词、时间线、已发生的事件、对话传达的信息、伏笔与钩子。
- 不要机械替换词表里的词。同一个词在不同语境下要区别处理；有的位置本来就自然，就保持原样。
- 保留原有的段落划分与空行格式，保留中文双引号，不要输出 Markdown 语法符号。
- 修订后的字数应与原文接近（±10% 以内）。

【输出格式】
直接输出修订后的完整正文，不要输出任何说明、对比或 JSON。`,
    contentLocalized: {
      en: `Revise the following chapter to remove the "AI traces" flagged in the marked positions.

【Rewriting Method (provided by the active Skill — follow it strictly)】
{{skill_method}}

【Flagged Revisable Positions (local detection; reference only, not all must change)】
{{trace_brief}}

【Draft To Revise】
{{draft_content}}

【Hard Requirements】
- Rewrite only at the **semantic level**: word choice, sentence structure, sentence-length rhythm, narration style. Introduce no new plot.
- Never change: character names, place names, proper nouns, the timeline, events that already happened, information conveyed by dialogue, setups and hooks.
- Do not mechanically swap words from a list. The same word may need different treatment in different contexts; keep positions that already read naturally as they are.
- Preserve the existing paragraph breaks and blank lines, keep standard Chinese double quotes, and output no Markdown syntax.
- Keep the length close to the original (within ±10%).

【Output Format】
Output the complete revised chapter as plain text only. No commentary, no diff, no JSON.`,
      ru: `Отредактируйте следующую главу, устранив «следы ИИ» в отмеченных местах.

【Метод переработки (предоставлен активным Skill — следуйте ему строго)】
{{skill_method}}

【Отмеченные места для правки (локальное обнаружение; только ориентир, менять все не обязательно)】
{{trace_brief}}

【Черновик для правки】
{{draft_content}}

【Жёсткие требования】
- Правьте только на **смысловом уровне**: выбор слов, структура фраз, ритм длины предложений, манера повествования. Не вводите новый сюжет.
- Никогда не меняйте: имена персонажей, топонимы, имена собственные, хронологию, уже произошедшие события, информацию в диалогах, завязки и крючки.
- Не заменяйте слова механически по списку. Одно и то же слово в разных контекстах требует разного подхода; естественно звучащие места оставляйте как есть.
- Сохраните разбивку на абзацы и пустые строки, оставьте стандартные китайские кавычки, не выводите разметку Markdown.
- Держите объём близким к исходному (в пределах ±10%).

【Формат вывода】
Выведите только полный отредактированный текст главы. Без пояснений, сравнений и JSON.`,
    },
    systemRoleLocalized: {
      en: 'You are a seasoned fiction editor, skilled at turning paragraphs that read like machine output back into prose with a human pulse.',
      ru: 'Вы — опытный редактор художественной литературы, умеющий вернуть абзацам, звучащим как машинный текст, человеческий пульс.'
    },
  },
]
