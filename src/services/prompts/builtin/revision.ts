/**
 * 内置 Prompt 模板：修稿、审稿与定稿台账
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const REVISION_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // 修稿
  // ================================================================

  {
    key: 'refine_chapter',
    name: '大神级修稿',
    description: '将草稿提升到大神级质量',
    systemRole: '你是一位功力深厚的文学编辑，擅长将普通文稿精修为白金品质力作。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（精修时绝不可破坏的事实基线）',
      draft_content: '章节草稿内容',
      chapter_info: '章节信息',
      global_guidance: '写作要求',
      global_summary: '近章要点（蓝图摘要）',
      short_summary: '近章摘要',
      word_number: '目标字数',
      user_refine_prompt: '用户自定义修稿指导（可选）',
      writing_style: '文风描述（可选）',
    },
    content: `请对章节草稿进行【精修与细节填充】。

【★★★ 叙事一致性 Canon 上下文（精修时绝不可破坏的事实基线）★★★】
{{canon_context}}

【剧情上下文】
- 全书目前进度摘要：{{global_summary}}
- 近期章节回顾：{{short_summary}}

【本章信息】
{{chapter_info}}

【精修要求】
1. 画面感（Sense of Presence）：通过"五感"细节（视觉、听觉、嗅觉、触觉）强化环境描写，拒绝干瘪的白开水叙事。
2. 设定咬合：巧妙地将金手指的使用细节融入战斗或博弈中，体现主角的差异化优势。
3. 情绪张力：强化反派的压迫感与主角的回击力度。遵循"欲扬先抑"法则，但在高潮处必须给足爽感。
4. 词汇升级：使用更精准、更具镜头感的动作词汇。用动作和细节来展示情绪（Show, Don't Tell）。
5. 钩子与节奏：检查结尾处是否有强力钩子（Hook），确保读者有强烈的追读欲望。
6. 防注水平替制：精修的本质是词汇平替、提升画面感，绝非拉长篇幅和增注冗长旁白。目标字数控制在 {{word_number}} 字左右。如果发现原文有啰嗦的动作描写或说教式科普，请果断删减，严禁无限扩写把节奏拖慢。

【全局写作禁忌】
{{global_guidance}}

【待精修原稿】
{{draft_content}}

【文风要求（如有，精修时严格向此风格靠拢）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

【去 AI 腔（必须遵守）】
- 禁止清单式罗列（「第一条……第二条……」）、禁止排比式设定倾泻、禁止段尾或章尾的总结式旁白。
- 神态与内心不要套话（眸中闪过／嘴角勾起／心中暗道），少用万能副词堆叠（缓缓／淡淡／微微／轻轻）；对白标签不要清一色「说道／淡淡道／沉声道」。
- 句长要参差：长短句交错，不要让连续几句都是同样的结构与长度；金句全章最多 1 句，结尾不要点题。
- 只调整表达方式，不得改动人名、设定、能力、位置、伤势、物品、已发生事件与人物关系。

请直接输出精修后的全文章节内容。强制要求纯文本，禁止使用任何 Markdown 语法符号，严禁剧本式对话。【严禁】任何开场白、解释文字、对照表或要点清单。
**【排版底线】：正文段落之间必须保留一个空行，绝不允许不留空行的连续长段落。**
**【说明放在哪里】：若确有需要作者知道的事项（如与既有设定冲突、原稿有硬伤），请放在正文之后，另起一段并以【修复说明】或【待作者确认】开头。这些段落会被自动剥离，不会进入正文。**`,
    contentLocalized: {
      en: `Please perform a [polish and detail enrichment] pass on this chapter draft.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during polish) ★★★】
{{canon_context}}

【Plot Context】
- Current global progress summary: {{global_summary}}
- Recent chapters review: {{short_summary}}

【This Chapter's Info】
{{chapter_info}}

【Polish Requirements】
1. Sensory Presence: Strengthen environmental descriptions through "five senses" details (sight, sound, smell, touch, taste) — reject bland, watered-down narration.
2. Setting Integration: Skillfully weave golden finger usage details into combat or strategy scenes, showcasing the protagonist's differentiated advantage.
3. Emotional Tension: Amplify the antagonist's oppressive presence and the protagonist's counterforce. Follow the "build-up before the payoff" rule, but deliver maximum satisfaction at the climax.
4. Vocabulary Upgrade: Use more precise, cinematic action verbs. Show emotions through actions and details (Show, Don't Tell).
5. Hook and Pacing: Check whether the ending has a strong hook (Hook) that gives readers a compelling urge to continue reading.
6. Anti-Filler Substitution: Polish means vocabulary substitution and enhanced sensory presence — NOT padding the word count with bloated exposition or sermon-like exposition. Target approximately {{word_number}} words. If you find verbose action descriptions or preachy exposition, cut decisively — never infinitely expand and drag down the pacing.

【Global Writing Prohibitions】
{{global_guidance}}

【Original Draft to Polish】
{{draft_content}}

【Writing Style Requirements (if any, polish strictly toward this style)】
{{writing_style}}`,
      ru: `Пожалуйста, выполните этап [шлифовки и обогащения деталями] для этого черновика главы.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при шлифовке) ★★★】
{{canon_context}}

【Контекст сюжета】
- Краткое содержание текущего глобального прогресса: {{global_summary}}
- Обзор последних глав: {{short_summary}}

【Информация об этой главе】
{{chapter_info}}

【Требования к шлифовке】
1. Ощущение присутствия: усильте описания окружения через детали «пяти чувств» (зрение, слух, обоняние, осязание, вкус) — отбрасывайте водянистое повествование.
2. Интеграция сеттинга: искусно вплетайте детали использования золотого пальца в боевые или стратегические сцены, демонстрируя дифференцированное преимущество героя.
3. Эмоциональное напряжение: усиливайте давящее присутствие антагониста и контрудар героя. Следуйте правилу «нарастание перед кульминацией», но обеспечивайте максимальное удовлетворение в кульминационный момент.
4. Обновление словаря: используйте более точные, кинематографичные глаголы действия. Покажите эмоции через действия и детали (Покажи, а не расскажи).
5. Крючок и темп: проверьте, есть ли в конце сильный крючок (Hook), дающий читателю непреодолимое желание продолжить чтение.
6. Антиводозамена: шлифовка — это замена слов и усиление ощущения присутствия — А НЕ наращивание объёма пространными описаниями или поучительными отступлениями. Целевой объём: примерно {{word_number}} слов. Если встречается многословное описание действий или поучительная проповедь —果断 сокращайте, никогда не раздувайте бесконечно и не замедляйте темп.

【Глобальные запреты на написание】
{{global_guidance}}

【Исходный черновик для шлифовки】
{{draft_content}}

【Требования к стилю (если есть, при шлифовке строго приближайтесь к этому стилю)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary editor, skilled at elevating ordinary drafts to platinum-quality masterpieces.',
      ru: 'Вы — опытный литературный редактор, искусно превращающий обычные черновики в произведения платинового качества.'
    },

  },

  // ================================================================
  // 审稿
  // ================================================================

  {
    key: 'consistency_check',
    name: '一致性审稿',
    description: '检查章节的一致性问题',
    systemRole: '你是一位极其严谨、铁面无私的小说质量监督编辑。你只检查客观事实问题，绝不评价主观文笔。',
    variables: {
      chapter_content: '章节内容',
      character_states: '角色状态',
      global_summary: '上下文检索结果',
      world_building: '世界观设定',
      canon_context: '已确立事实（时间线+角色状态+剧情线+硬性约束），用于交叉验证',
      review_focus: '审稿维度侧重点（可选）',
    },
    content: `请对以下章节进行审查。

【待审章节】
{{chapter_content}}

【角色状态】
{{character_states}}

【全局摘要】
{{global_summary}}


【已确立事实基线（用于交叉验证 — 所有事实以此为准，本章不得与之矛盾）】
{{canon_context}}

【世界观设定】
{{world_building}}

【审查原则】

1. 举证审查：只报告有明确文本证据的问题。每个问题必须引用原文具体句子。
2. 宁缺毋滥：没有问题的维度，输出一条 severity 为 pass 的记录即可。不要凑数量。
3. 只查一致性不评文笔：不报告风格偏好、文笔建议、创作建议。只报告可验证的事实矛盾。
4. 客观可验证：报出的每个问题必须能被第三方编辑复查确认。

【检查维度】

1. 剧情连贯性：本章情节是否与前文（全局摘要）有矛盾？前后文是否自相矛盾？
2. 剧情合理性：因果逻辑是否成立？人物动机是否合理？是否有常识性硬伤？
3. 角色状态：角色行为、能力、位置、情感是否与角色状态档案一致？
4. 前后章节串联：伏笔、悬念是否连贯？是否出现未交代前因的突兀情节？
5. 伏笔完整性：本章是否存在应回收而未提及的前置伏笔？是否有与已知伏笔体系冲突的新增设置？

`,
    systemSuffix: `★【作者要求重点检查的维度（如有，这些维度必须优先、深入检查）】★：
{{review_focus}}

## 输出格式（JSON）

请严格输出以下 JSON 格式：

{"items":[{"category":"剧情连贯性","severity":"pass","description":"未发现与前文矛盾"},{"category":"剧情合理性","severity":"error","quote":"原文中的具体句子","description":"问题描述"},{"category":"角色状态","severity":"warning","quote":"原文句子","description":"轻微不一致说明"}],"summary":"一句话总体评价"}

severity 取值：error=严重矛盾强烈建议修复, warning=轻微不一致酌情修复, pass=该维度通过无问题。
每个 category 至少输出一条记录。quote 字段在 pass 时可省略。`,
    contentLocalized: {
      en: `Please review the following chapter.

【Chapter Under Review】
{{chapter_content}}

【Character States】
{{character_states}}

【Global Summary】
{{global_summary}}


【Established Facts Baseline (for cross-validation — all facts take precedence here; this chapter must not contradict them)】
{{canon_context}}

【Worldbuilding】
{{world_building}}

【Review Principles】

1. Evidence-based review: Only report problems with clear textual evidence. Each problem must cite a specific sentence from the original text.
2. Quality over quantity: For dimensions with no issues, output a single record with severity "pass." Don't pad the count.
3. Check consistency only — no style critique: Do not report style preferences, writing suggestions, or creative advice. Only report verifiable factual contradictions.
4. Objective and verifiable: Each problem you report must be confirmable by a third-party editor.

【Check Dimensions】

1. Plot Continuity: Does this chapter's plot contradict earlier content (global summary)? Are there self-contradictions within the chapter?
2. Plot Logic: Do cause-and-effect relationships hold up? Are character motivations plausible? Are there common-sense errors?
3. Character States: Are character behaviors, abilities, locations, and emotions consistent with the character state files?
4. Cross-Chapter Continuity: Are foreshadowing and suspense lines consistent? Are there abrupt plot developments without established cause?
5. Foreshadowing Completeness: Are there any foreshadowed elements from prior chapters that should have been resolved but weren't? Are there new settings that conflict with the established foreshadowing system?`,
      ru: `Пожалуйста, проверьте следующую главу.

【Проверяемая глава】
{{chapter_content}}

【Состояния персонажей】
{{character_states}}

【Глобальное резюме】
{{global_summary}}


【Базовый набор установленных фактов (для перекрёстной проверки — все факты здесь имеют приоритет; эта глава не должна им противоречить)】
{{canon_context}}

【Мироздание】
{{world_building}}

【Принципы проверки】

1. Проверка на основе доказательств: сообщайте только о проблемах с чёткой текстовой поддержкой. Каждая проблема должна цитировать конкретное предложение из оригинального текста.
2. Качество важнее количества: для измерений без проблем выводите одну запись со severity «pass». Не наращивайте количество.
3. Проверяйте только согласованность — без критики стиля: не сообщайте о предпочтениях стиля, советах по написанию или творческих рекомендациях. Только проверяемые фактологические противоречия.
4. Объективность и проверяемость: каждая проблема, о которой вы сообщаете, должна быть подтверждаема сторонним редактором.

【Измерения для проверки】

1. Непрерывность сюжета: противоречит ли сюжет этой главы предыдущему контенту (глобальное резюме)? Есть ли внутренние противоречия?
2. Логика сюжета: выдерживают ли причинно-следственные связи? Правдоподобны ли мотивации персонажей? Есть ли ошибки здравого смысла?
3. Состояния персонажей: соответствуют ли поведение, способности, местоположение и эмоции персонажей файлам состояний?
4. Сквозная непрерывность: последовательны ли линии предвестий и интриг? Есть ли резкие сюжетные повороты без установленной причины?
5. Полнота предвестий: остались ли какие-либо элементы из предыдущих глав, которые должны были быть раскрыты, но не были? Есть ли новые настройки, противоречащие установленной системе предвестий?`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous, impartial quality control editor. You check only objective factual issues — you never evaluate subjective writing quality.',
      ru: 'Вы — тщательный, беспристрастный редактор контроля качества. Вы проверяете только объективные фактологические проблемы — никогда не оцениваете субъективное качество текста.'
    },
  },

  // ================================================================
  // 文风分析
  // ================================================================

  {
    key: 'analyze_writing_style',
    name: '文风分析',
    description: '从正文样本中提取作者的写作风格特征',
    systemRole: '你是一位资深的文学评论家和网文研究者，擅长精准捕捉作者的写作风格指纹。',
    variables: {
      sample_text: '正文采样文本（3-5章拼接）',
    },
    content: `请仔细阅读以下小说正文样本，深度分析并提炼作者的写作风格特征。

【正文样本】
{{sample_text}}

【分析维度与输出要求】
请从以下 7 个维度分析，每个维度用 2-3 句话精准概括，并附带 1 个原文例句作为佐证（总计 300-500 字）：

1. 叙述节奏：整体叙事快慢、场景切换频率、段落长短偏好
2. 描写密度：环境描写/动作描写/心理描写的比重偏好
3. 对话风格：对话在全文中的比例、对话的口语化程度、是否使用方言或特殊腔调
4. 用词偏好：是否偏好古风用词/现代流行语/专业术语、整体词汇丰富度
5. 情感基调：整体偏热血/冷峻/诙谐/沉重/轻松
6. 叙事视角习惯：主要用第几人称、是否频繁切换视角、内心独白的使用频率
7. 标志性手法：作者特有的修辞手法、常用的过渡技巧、独特的段落结构

【输出格式】
直接输出纯文本分析结果，使用以下格式：

叙述节奏：……
描写密度：……
对话风格：……
用词偏好：……
情感基调：……
叙事视角：……
标志性手法：……

不要添加任何无关解释或客套话。`,
    contentLocalized: {
      en: `Please carefully read the following novel text sample and deeply analyze the author's writing style characteristics.

【Text Sample】
{{sample_text}}

【Analysis Dimensions & Output Requirements】
Analyze across the following 7 dimensions, using 2–3 precise sentences per dimension with 1 original-text quote as evidence (total 300–500 words):

1. Narrative Pacing: overall narrative speed, scene transition frequency, paragraph length preferences
2. Descriptive Density: ratio of environment/action/psychological descriptions
3. Dialogue Style: proportion of dialogue in the text, level of colloquialism, use of dialect or distinctive speech patterns
4. Vocabulary Preference: classical/literary phrasing vs. modern slang vs. technical jargon, overall lexical richness
5. Emotional Tone: overall lean toward hot-blooded / cool and detached / witty / somber / lighthearted
6. Narrative POV Habits: primary person used, frequency of POV switches, frequency of internal monologue
7. Signature Techniques: the author's distinctive rhetorical devices, common transitional techniques, unique paragraph structures

【Output Format】
Output the analysis as plain text using the following format:

Narrative Pacing: …
Descriptive Density: …
Dialogue Style: …
Vocabulary Preference: …
Emotional Tone: …
Narrative POV: …
Signature Techniques: …

Do not add any irrelevant explanations or pleasantries.`,
      ru: `Пожалуйста, внимательно прочитайте следующий образец текста романа и глубоко проанализируйте стилистические особенности автора.

【Образец текста】
{{sample_text}}

【Измерения анализа и требования к выводу】
Проанализируйте по следующим 7 измерениям, используя 2–3 точных предложения на измерение с 1 цитатой из оригинала в качестве доказательства (всего 300–500 слов):

1. Ритм повествования: общая скорость повествования, частота переключения сцен, предпочтения по длине абзацев
2. Плотность описаний: соотношение описаний окружения / действий / переживаний
3. Стиль диалогов: доля диалогов в тексте, уровень разговорности, использование диалекта или характерной речи
4. Лексические предпочтения: литературная / архаичная речь vs. современный сленг vs. профессиональный жаргон, общая лексическая насыщенность
5. Эмоциональный тон: общий уклон в сторону героического / холодно-отстранённого / ироничного / мрачного / лёгкого
6. Привычки точки зрения: основное лицо повествования, частота переключений точки зрения, частота внутреннего монолога
7. Фирменные приёмы: характерные риторические устройства автора, типичные переходы, уникальная структура абзацев

【Формат вывода】
Выведите анализ в виде простого текста в следующем формате:

Ритм повествования: …
Плотность описаний: …
Стиль диалогов: …
Лексические предпочтения: …
Эмоциональный тон: …
Точка зрения: …
Фирменные приёмы: …

Не добавляйте лишних пояснений или вступлений.`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary critic and web novel researcher, skilled at precisely capturing an author\'s writing style fingerprint.',
      ru: 'Вы — опытный литературный критик и исследователь веб-романов, искусно точно определяющий стилистический «отпечаток» автора.'
    },
  },

  {
    key: 'refine_from_review',
    name: '审稿驱动修稿',
    description: '根据审稿报告中的问题精准修复草稿',
    systemRole: '你是一位严谨的小说编辑，擅长精准修复文本中的具体问题而不过度改写。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（审稿修复时绝不可破坏的事实基线）',
      review_report: '审稿报告内容',
      draft_content: '待修稿内容',
      global_guidance: '全局写作要求',
      user_refine_prompt: '用户额外修稿指导（可选）',
    },
    content: `请根据【审稿报告】中列出的问题，对草稿进行**精准修复**。

【★★★ 叙事一致性 Canon 上下文（修复时绝不可破坏的事实基线）★★★】
{{canon_context}}

【审稿报告】
{{review_report}}

【待修稿内容】
{{draft_content}}

【全局写作要求】
{{global_guidance}}

【修复原则】
1. 只修复审稿报告中明确指出的问题，一条一条逐项解决
2. 不要进行审稿报告未提及的润色或改写
3. 保持原文的风格、节奏和字数体量
4. 对每处修改保持最小变化原则——改得越少越好，只解决问题本身`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出修复后的全文章节内容。强制要求纯文本，严禁剧本式格式，【严禁】任何开场白、解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝对不允许连续文本不留空行。**`,
    contentLocalized: {
      en: `Please perform a **targeted fix** on the draft based on the issues listed in the review report.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during repair) ★★★】
{{canon_context}}

【Review Report】
{{review_report}}

【Draft to Repair】
{{draft_content}}

【Global Writing Requirements】
{{global_guidance}}

【Repair Principles】
1. Fix ONLY the problems explicitly identified in the review report — address them one by one.
2. Do NOT perform any polishing or rewriting beyond what the review report mentions.
3. Preserve the original's style, pacing, and word count volume.
4. For each change, maintain the principle of minimal change — fix as little as possible, only addressing the problem itself.`,
      ru: `Пожалуйста, выполните **точечный ремонт** черновика на основе проблем, перечисленных в отчёте проверки.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при ремонте) ★★★】
{{canon_context}}

【Отчёт проверки】
{{review_report}}

【Черновик для ремонта】
{{draft_content}}

【Глобальные требования к написанию】
{{global_guidance}}

【Принципы ремонта】
1. Исправляйте ТОЛЬКО проблемы, явно указанные в отчёте проверки — решайте их по одной.
2. НЕ проводите никакой дополнительной шлифовки или переписывания сверх того, что указано в отчёте.
3. Сохраняйте стиль, темп и объём оригинала.
4. Для каждого изменения соблюдайте принцип минимальных изменений — исправляйте как можно меньше, только устраняя саму проблему.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous fiction editor, skilled at precisely fixing specific textual issues without over-rewriting.',
      ru: 'Вы — тщательный редактор художественной литературы, искусно точно исправляющий конкретные текстовые проблемы без избыточного переписывания.'
    },
  },

  // ================================================================
  // 章节要点生成（定稿后处理 / 按章推演）
  // ================================================================

  {
    key: 'generate_chapter_notes',
    name: '章节要点生成',
    description: '定稿后为本章生成结构化要点（剧情节点、角色动态、新增设定、伏笔与钩子）',
    systemRole: '你是一位专业的网文结构分析师。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      chapter_title: '章节标题',
    },
    content: `请为以下章节生成一份精确的【结构化章节要点】。

【章节正文】
第{{chapter_number}}章 {{chapter_title}}
{{chapter_content}}

---

请严格按照以下 Markdown 格式输出，不要添加任何额外说明：

# 第{{chapter_number}}章 要点

## 剧情节点
（列出本章中不可逆的关键剧情进展，使用 [类型] 标注）
- [触发] ...
- [转折] ...
- [结果] ...

## 角色动态
（用表格记录本章出场的主要角色及其变化）
| 角色 | 本章变化/状态 |
|------|-------------|
| 角色名 | 具体变化描述 |

## 新增设定
（本章首次出现或确认的世界观/力量体系/规则，无则省略此节）
- ...

## 伏笔与钩子
（本章埋下的伏笔用 [埋]，章末留给读者的钩子用 [钩]，无则省略此节）
- [埋] ...
- [钩] ...

严格按格式输出，内容精炼，每项不超过 30 字。`,
    contentLocalized: {
      en: `Please generate an accurate set of [Structured Chapter Notes] for the following chapter.

【Chapter Text】
Chapter {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Please output strictly in the following Markdown format without any additional explanation:

# Chapter {{chapter_number}} Notes

## Plot Beats
(List irreversible key plot developments in this chapter, annotated with [Type])
- [Trigger] …
- [Turning Point] …
- [Outcome] …

## Character Dynamics
(Record the main characters appearing this chapter and their changes in a table)
| Character | This Chapter's Change / Status |
|-----------|-------------------------------|
| Character Name | Specific change description |

## New Settings
(World-building / power systems / rules first introduced or confirmed in this chapter; omit if none)
- …

## Foreshadowing & Hooks
(Foreshadowed elements marked [Planted]; cliffhangers left for readers marked [Hook]; omit if none)
- [Planted] …
- [Hook] …

Output strictly in format, keep content concise, each item no more than 30 words.`,
      ru: `Пожалуйста, создайте точный набор [Структурированных заметок к главе] для следующей главы.

【Текст главы】
Глава {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Выведите строго в следующем формате Markdown без каких-либо дополнительных пояснений:

# Заметки к главе {{chapter_number}}

## Сюжетные узлы
(Перечислите необратимые ключевые сюжетные события этой главы с пометкой [Тип])
- [Триггер] …
- [Поворотный момент] …
- [Исход] …

## Динамика персонажей
(Зафиксируйте основных персонажей этой главы и их изменения в таблице)
| Персонаж | Изменение / Статус за эту главу |
|----------|----------------------------------|
| Имя персонажа | Описание конкретного изменения |

## Новые настройки
(Мироздание / системы сил / правила, впервые введённые или подтверждённые в этой главе; опустите, если нет)
- …

## Предвестия и крючки
(Предвестия — пометка [Заложено]; интриги для читателей — пометка [Крючок]; опустите, если нет)
- [Заложено] …
- [Крючок] …

Выводите строго по формату, содержание краткое, каждый пункт не более 30 слов.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов.'
    },
  },

  // ================================================================
  // 角色卡 currentState 更新（JSON 输出）
  // ================================================================

  {
    key: 'update_character_cards',
    name: '更新角色卡动态状态',
    description: '定稿后分析章节内容，以 JSON 格式返回有变化的角色的 currentState 字段，用于自动更新角色卡',
    systemRole: '你是一位严谨的小说角色档案管理员，擅长追踪角色多维状态变化。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      existing_cards_json: '现有角色卡 JSON 数组（包含 name/role 等基础信息）',
    },
    content: `请根据章节内容，以 JSON 格式返回在本章中发生状态变化的角色的最新状态。

【本章内容（第{{chapter_number}}章）】
{{chapter_content}}

【现有角色卡（基础信息）】
{{existing_cards_json}}

---

【任务要求】
1. 分析并在 \`updates\` 中提取已有角色（从提供的现有角色卡中找）发生状态变化的信息。
2. 分析并在 \`newCharacters\` 中提取本章新出场的重要角色（不要包含路人或已死无后续影响的龙套）。
3. \`currentState\` 字段说明：
   - location: 当前所在位置/阵营（字符串）
   - powerLevel: 修为境界/能力等级（字符串）
   - physicalState: 身体状态，包括伤势/BUFF/外貌变化（字符串）
   - mentalState: 心理状态，当前愿望/恐惧/心态（字符串）
   - keyItems: 当前持有的关键道具/资源（字符串）
   - recentEvents: 本章发生的最重要事件（字符串，50字以内）
   - updatedAtChapter: 固定填写 {{chapter_number}}（数字）

【输出格式（JSON）】
{
  "updates": [
    {
      "name": "已有角色的精确名字",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "新角色名字",
      "role": "主要人物/反派/配角/导师",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

如果本章无任何角色发生状态变化且无新角色，返回 {"updates": [], "newCharacters": []}。`,
    contentLocalized: {
      en: `Based on the chapter content, return the latest states of characters who underwent changes in this chapter in JSON format.

【This Chapter's Content (Chapter {{chapter_number}})】
{{chapter_content}}

【Existing Character Cards (Basic Info)】
{{existing_cards_json}}

---

【Task Requirements】
1. Analyze and extract in \`updates\` the state changes of existing characters (found among the provided character cards).
2. Analyze and extract in \`newCharacters\` any important new characters appearing in this chapter (exclude background extras or dead characters with no further impact).
3. \`currentState\` field description:
   - location: current location / faction (string)
   - powerLevel: cultivation level / ability tier (string)
   - physicalState: physical condition including injuries / buffs / appearance changes (string)
   - mentalState: psychological state, current wish / fear / mindset (string)
   - keyItems: currently held key items / resources (string)
   - recentEvents: most important event in this chapter (string, under 50 words)
   - updatedAtChapter: fixed value {{chapter_number}} (number)

【Output Format (JSON)】
{
  "updates": [
    {
      "name": "Exact name of existing character",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "New character name",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

If no characters had state changes and no new characters appeared, return {"updates": [], "newCharacters": []}.`,
      ru: `На основе содержания главы верните в формате JSON最新的 состояния персонажей, которые изменились в этой главе.

【Содержание этой главы (Глава {{chapter_number}})】
{{chapter_content}}

【Существующие карточки персонажей (основная информация)】
{{existing_cards_json}}

---

【Требования к заданию】
1. Проанализируйте и извлеките в \`updates\` изменения состояний существующих персонажей (среди предоставленных карточек).
2. Проанализируйте и извлеките в \`newCharacters\` любых важных новых персонажей, появившихся в этой главе (исключайте фоновых extras или мёртвых персонажей без дальнейшего влияния).
3. Описание поля \`currentState\`:
   - location: текущее местоположение / фракция (строка)
   - powerLevel: уровень культивации / уровень способностей (строка)
   - physicalState: физическое состояние, включая травмы / баффы / внешние изменения (строка)
   - mentalState: психологическое состояние, текущее желание / страх / настрой (строка)
   - keyItems: текущие ключевые предметы / ресурсы (строка)
   - recentEvents: важнейшее событие главы (строка, до 50 слов)
   - updatedAtChapter: фиксированное значение {{chapter_number}} (число)

【Формат вывода (JSON)】
{
  "updates": [
    {
      "name": "Точное имя существующего персонажа",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "Имя нового персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

Если ни один персонаж не изменил состояние и новых персонажей нет, верните {"updates": [], "newCharacters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous novel character file manager, skilled at tracking multi-dimensional state changes across characters.',
      ru: 'Вы — тщательный менеджер файлов персонажей романа, искусно отслеживающий многомерные изменения состояний.'
    },
  },
]
