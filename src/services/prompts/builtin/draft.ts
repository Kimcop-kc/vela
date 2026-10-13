/**
 * 内置 Prompt 模板：正文生成
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const DRAFT_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // 写稿
  // ================================================================

  {
    key: 'first_chapter_draft',
    name: '第一章草稿',
    description: '生成小说第一章的完整正文',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      architecture: '故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_info: '本章信息（JSON）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      writing_style: '文风描述（可选）',
      user_guidance: '作者本章微操指导（可选）：场景风格、节奏快慢、视角或描写比例等本章特例要求',
      canon_context: '【强制】叙事一致性 Canon Context（最高优先级：包含正史设定、人物状态与认知边界、时间线、未结剧情、本章资料包、硬性约束）',
    },
    content: `请开始创作这本小说的第一章（破冰章）。

【全书设定池】
{{architecture}}

{{canon_context}}

【本章信息】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【全局写作要求】
{{global_guidance}}

【网文"黄金第一章"创作法则】
1. 开场即高能（黄金三秒）：绝不要用长篇大论介绍世界观。起笔第一句必须直接切入一个动作、一次高压审问、一场追杀或一个极具落差感的嘲讽现场。
2. 巧妙引出金手指：在主角陷入困境的最深处，让金手指以一种让人期待的方式展现。
3. 多动少静（动作与对话驱动）：绝不使用上帝视角的干瘪陈述句，全部改成"角色对话 + 神态描写 + 动作互动"。
4. 规避毒点：严格避让全局写作要求与禁忌。

【文风要求（如有，请严格遵循）】
{{writing_style}}`,
    systemSuffix: `★【作者本章微操指导（如有，最高优先级）】★：
{{user_guidance}}

说明：这段指导用于「场景风格 + 本章微调」——例如战斗场景重动作与距离、探索场景重环境与线索、日常场景重互动与生活感，或本章要更快/更慢、减少心理独白、增加对话、强化环境压迫感。它与全书文风（【文风要求】）叠加生效：本章要求优先于全书风格，但两者都不允许违背上面的 Canon 与全局禁忌。

【具体生成要求】
- 体量与节奏控制：大约 {{word_number}} 字左右。本章仅推演【本章信息】中规定的核心剧情，切忌注水！不要为了凑字数而撰写冗余的旁白科普或无意义的日常对话。达成首章目标后立刻留悬念断章，绝不可提前泄露后续情节。
- 格式要求：直接输出纯文本正文。禁止使用任何 Markdown 语法符号（如不要用 * 或 ** 或 # 等）。所有对话必须使用标准中文双引号，严禁使用剧本式的对话格式。
- **强制排版要求：【段落与段落之间必须保留一个空行作为分隔】。绝对不允许连续多行不留空行！**
- 结尾法则：在章节的最后一行留置一个强力钩子。

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如“他知道，这一切才刚刚开始”、“命运的齿轮开始转动”）
- “仿佛”、“犹如”、“宛如”全章合计不超过3次
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结`,
    contentLocalized: {
      en: `Begin writing the first chapter (the hook chapter) of this novel.

【Full Novel Setting Pool】
{{architecture}}

{{canon_context}}

【This Chapter's Info】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Global Writing Requirements】
{{global_guidance}}

【Web Novel "Golden First Chapter" Creation Rules】
1. Open with high energy (golden 3 seconds): Never use lengthy worldbuilding exposition. The opening sentence must dive straight into an action, a high-pressure interrogation, a chase, or a moment of sharp ironic contrast.
2. Cleverly introduce the golden finger: At the protagonist's deepest point of desperation, reveal the golden finger in a way that builds anticipation.
3. Motion over stillness (action and dialogue driven): Never use dry omniscient narration — replace everything with "character dialogue + body language + action interaction."
4. Avoid prohibited elements: Strictly adhere to global writing requirements.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Начните писать первую главу (зацепляющую главу) этого романа.

【Пул настроек романа】
{{architecture}}

{{canon_context}}

【Информация об этой главе】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Глобальные требования к написанию】
{{global_guidance}}

【Правила создания «Золотой первой главы» веб-романа】
1. Откройте с высокой энергией (золотые 3 секунды): никогда не используйте пространные описания мира. Первое предложение должно сразу погрузить в действие, допрос под давлением, погоню или момент острого иронического контраста.
2. Изящно представьте золотой палец: в самой глубокой точке отчаяния героя покажите золотой палец так, чтобы это создало ожидание.
3. Движение вместо статики (через действия и диалоги): никогда не используйте сухое всеведущее повествование — замените всё на «диалоги персонажей + язык тела + действия».
4. Избегайте запрещённых элементов: строго следуйте глобальным требованиям.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },

  {
    key: 'next_chapter_draft',
    name: '后续章节草稿',
    description: '基于上下文和章节蓝图生成后续章节',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（最高优先级：包含正史设定、人物状态、时间线、最近章节摘要、未结剧情、本章目标、RAG、风格、硬性约束）',
      global_summary: '章节要点时间线（从蓝图按序拼装）',
      character_states: '角色状态',
      short_summary: '近期三章简要',
      previous_ending: '上章结尾800字',
      chapter_info: '本章蓝图信息（JSON）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      user_guidance: '作者本章微操指导（可选）：场景风格、节奏快慢、视角或描写比例等本章特例要求',
      filtered_context: '知识库检索结果',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      writing_style: '文风描述（可选）',
    },
    content: `你正在连载写作最新章节。

【★★★ 叙事一致性 Canon 上下文（必须严格遵循 · 优先级最高）★★★】
{{canon_context}}

【剧情记忆库与前置断点上下文】
- [全局剧情进展]：{{global_summary}}
- [角色状态监控]：{{character_states}}
- [近期三章简要]：{{short_summary}}
★【上一章结尾最后一小段（极其关键，起笔必须无缝衔接）】★：
{{previous_ending}}

【本章写作方向与核心任务】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【知识库资料（如有）】
{{filtered_context}}

【网文连载更新核心法则】
1. 无缝衔接断句：你的第一段必须自然、丝滑地接续上一章结尾，绝不允许出现场景瞬移或突兀的视角跳跃。
2. 动作与神态驱动：用动态的描写推动剧情，不要写"他们聊了很久"，用拔剑声、茶水滴落声、瞳孔的骤缩来代替。
3. 落实本章核心冲突：用{{word_number}}字左右的篇幅，踏踏实实地推演完本章目标，拒绝平淡流水账。
4. 悬念断章大法：全章的最后一段，必须卡在一个剧情的小高潮点或突发变故上。
5. 底线铁律：严禁碰触【全局写作要求与禁忌】：{{global_guidance}}。

【文风要求（如有，请严格遵循）】
{{writing_style}}`,
    systemSuffix: `★【作者本章微操指导（如有，最高优先级）】★：
{{user_guidance}}

说明：这段指导用于「场景风格 + 本章微调」——例如战斗场景重动作与距离、探索场景重环境与线索、日常场景重互动与生活感，或本章要更快/更慢、减少心理独白、增加对话、强化环境压迫感。它与全书文风（【文风要求】）叠加生效：本章要求优先于全书风格，但两者都不允许违背上面的 Canon 与全局禁忌。

【输出格式】
- 体量与节奏控制：大约 {{word_number}} 字左右。本章仅推演【本章信息】中规定的核心冲突，切忌注水！达成目标即立刻断章，绝不可擅自拓展后续大纲的情节。
- 仅输出纯文本正文！绝对不要在开头写"第x章 正文如下"。
- 强制要求纯文本，禁止使用任何 Markdown 语法符号。所有对话必使用双引号，严禁剧本式格式。
- **强制排版要求：【段落与段落之间必须毫无例外地保留一个空行作为分隔】。禁止将多个段落紧凑拼凑成一大块！**

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如"他知道，这一切才刚刚开始"、"命运的齿轮开始转动"）
- "仿佛"、"犹如"、"宛如"全章合计不超过3次
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结
- 禁止清单式罗列：不要写"第一条……第二条……"或把物资、灾难、规则整齐枚举成一串；只挑 2-3 个具体细节展开
- 禁止排比式设定倾泻：世界观、灾变、经济规则拆散到当下场景与对话里，一次只带出一个信息，不用"地震、海啸、大火、瘟疫、变异"这种整齐排比一次倒出
- 控制金句密度：全章最多 1 句"金句"，优先把冲击力放进动作与事实，不连续制造警句`,
    contentLocalized: {
      en: `You are continuing serialization with the latest chapter.

【★★★ Narrative Consistency Canon Context (MUST follow strictly · HIGHEST PRIORITY) ★★★】
{{canon_context}}

【Plot Memory Bank & Prior Breakpoint Context】
- [Global plot progress]: {{global_summary}}
- [Character state monitoring]: {{character_states}}
- [Recent three chapters brief]: {{short_summary}}
★【Last paragraph of the previous chapter (CRITICAL — opening must connect seamlessly)】★:
{{previous_ending}}

【This Chapter's Writing Direction & Core Task】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Knowledge Base Materials (if any)】
{{filtered_context}}

【Core Serialization Update Rules】
1. Seamless sentence bridging: Your first paragraph must naturally and smoothly continue from the previous chapter's ending — absolutely no scene jumps or abrupt POV shifts.
2. Action and body language driven: Use dynamic descriptions to push the plot. Don't write "they talked for a long time" — use the sound of a sword drawn, tea dripping, pupils contracting.
3. Execute this chapter's core conflict: In approximately {{word_number}} words, thoroughly play out this chapter's objective — no bland diary entries.
4. Suspense cliffhanger technique: The final paragraph must land on a minor climax or sudden twist.
5. Iron-bottom rule: Never violate [Global Writing Requirements]: {{global_guidance}}.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Вы продолжаете сериал сlatest главой.

【★★★ Контекст канона нарративной согласованности (СТРОГО соблюдать · ВЫСШИЙ ПРИОРИТЕТ) ★★★】
{{canon_context}}

【Банк памяти сюжета и контекст предыдущей точки разрыва】
- [Глобальный прогресс сюжета]: {{global_summary}}
- [Мониторинг состояния персонажей]: {{character_states}}
- [Краткое содержание последних трёх глав]: {{short_summary}}
★【Последний абзац предыдущей главы (КРИТИЧНО — начало должно бесшовно продолжать)】★:
{{previous_ending}}

【Направление написания этой главы и основная задача】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Материалы из базы знаний (если есть)】
{{filtered_context}}

【Основные правила обновления сериала】
1. Бесшовное соединение предложений: ваш первый абзац должен естественно и плавно продолжать концовку предыдущей главы — абсолютно никаких скачков сцены или резких переключений точки зрения.
2. Через действия и язык тела: используйте динамичные описания для продвижения сюжета. Не пишите «они долго разговаривали» — используйте звук вынутого меча, капающий чай, резкое сужение зрачков.
3. Выполните основной конфликт этой главы: в объёме примерно {{word_number}} слов тщательно разыграйте цель этой главы — никаких скучных дневниковых записей.
4. Техника интриги: последний абзац должен завершиться малой кульминацией или внезапным поворотом.
5. Железное правило: никогда не нарушайте [Глобальные требования к написанию]: {{global_guidance}}.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },
]
