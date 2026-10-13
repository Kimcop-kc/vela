/**
 * 内置 Prompt 模板：整本导入与批量推断
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const IMPORT_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // 逆向推演 — 从知识库内容反推全局配置（旧作续写）
  // ================================================================

  {
    key: 'infer_novel_config',
    name: '逆向推演全局配置',
    description: '从已有小说内容（知识库采样片段）反推出小说配置、四段架构和主角色卡，用于旧作续写场景',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sample_content: '知识库代表性采样内容（开头+中段+结尾）',
    },
    content: `请根据以下已有小说内容片段，逆向推演出这部小说的完整设定体系，用于支持续写工作。

【已有内容样本】
{{sample_content}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "只填一个值，必须严格取自以下列表，不得追加说明、不得自创：玄幻 / 仙侠 / 都市 / 科幻 / 历史 / 军事 / 游戏 / 末世 / 悬疑 / 灵异 / 言情 / 古言 / 现言 / 奇幻 / 武侠 / 轻小说 / 同人 / 职场",
    "targetAudience": "只填一个值，必须严格取自以下列表，不得追加说明：男频 / 女频 / 双性向 / 全龄",
    "subGenre": "细分类型及标签",
    "coreOutline": "核心大纲（300 字以内，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于内容推断，未能确定的字段填写"（待确认）"
3. currentState 应基于最新内容（结尾采样）推断，不是初始状态
4. 若接近输出长度上限，优先保证 JSON 完整闭合：宁可少写 1-2 张角色卡，也不能让 JSON 中途断开、缺少右括号或右引号。`,
    contentLocalized: {
      en: `Based on the following existing novel content excerpts, reverse-engineer the complete setting system of this novel to support continuation work.

【Existing Content Sample】
{{sample_content}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the content; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest content (ending sample), not the initial state.`,
      ru: `На основе следующих отрывков из существующего романа выполните обратное проектирование полной системы настроек этого романа для поддержки работы по продолжению.

【Образец существующего содержания】
{{sample_content}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из содержания; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из самого позднего контента (образец финала), а не из начального состояния.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },

  // ================================================================
  // 架构生成 — 从角色图谱提取初始角色卡
  // ================================================================

  {
    key: 'extract_initial_characters',
    name: '提取初始角色卡',
    description: '从角色图谱纯文本中提取结构化角色卡数据，用于架构生成后自动创建角色卡 JSON 文件',
    systemRole: '你是一位专业的小说数据结构化专家。',
    variables: {
      character_dynamics: '角色图谱纯文本',
      genre: '小说类型',
    },
    content: `请从以下角色图谱文本中提取所有重要角色的结构化信息。

【角色图谱文本】
{{character_dynamics}}

【小说类型】
{{genre}}

【任务要求】
1. 提取所有在图谱中明确描述的角色（主角、反派、重要配角），不要遗漏。
2. 龙套或仅一笔带过的角色不用提取。
3. 所有字段基于图谱内容提取：图谱里没写、也推不出来的字段直接填空字符串或省略，不要编造。
4. 每个字段都要短，务必让整份结果留在本轮输出上限之内：
   - appearance：只写 2-4 个能直接入文的辨识点（衣着、气质、独特标志），不超过 60 字；图谱没描写外貌时按身份背景合理推断，同样不超过 60 字，不要写成散文；
   - personality、motivation、relationships、arc、notes：各不超过 50 字；
   - background、abilities：各不超过 80 字；
   - currentState 里的每一项：不超过 20 字。
5. role 字段仅限以下取值：protagonist（主角）、antagonist（反派）、supporting（配角）、minor（龙套）。
6. currentState 是角色的初始状态（故事开始时），updatedAtChapter 固定为 0。
7. 【重要】写不下时宁可少写后面的角色，也不要在卡片中间断开：如果接近输出上限，必须先把当前这张角色卡的最后一个字段写完再收尾。写到一半的卡片会被整条丢弃。

【输出格式】
必须返回一个 JSON 对象，格式如下（characters 数组包含所有角色）：
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist",
      "gender": "性别",
      "age": "年龄或年龄段",
      "appearance": "外貌特征",
      "personality": "性格特点",
      "background": "背景故事",
      "abilities": "能力/技能/修为",
      "motivation": "核心动机与渴望",
      "relationships": "与其他角色的关系",
      "arc": "预期的角色弧光/成长轨迹",
      "notes": "其他补充说明",
      "currentState": {
        "location": "初始位置",
        "powerLevel": "初始境界/能力等级",
        "physicalState": "初始身体状态",
        "mentalState": "初始心理状态",
        "keyItems": "初始持有道具",
        "recentEvents": "故事开始前的背景事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

如果图谱中没有任何可提取的角色，返回 {"characters": []}。`,
    contentLocalized: {
      en: `Please extract all important characters' structured information from the following character dynamics text.

【Character Dynamics Text】
{{character_dynamics}}

【Novel Genre】
{{genre}}

【Task Requirements】
1. Extract all clearly described characters in the dynamics (protagonist, antagonist, key supporting characters) — do not omit any.
2. Do not extract background extras or characters mentioned only in passing.
3. All fields come from the dynamics text: if a field is neither stated nor reasonably inferable, leave it as an empty string or omit it - never fabricate.
4. Keep every field short so the whole result fits in one output window:
   - appearance: only 2-4 concrete identifying details (clothing, bearing, a distinctive mark), max 60 characters; if the dynamics do not describe appearance, infer it from background and personality, still max 60 characters, never a prose paragraph;
   - personality, motivation, relationships, arc, notes: max 50 characters each;
   - background, abilities: max 80 characters each;
   - each currentState field: max 20 characters.
5. The role field may only have these values: protagonist, antagonist, supporting, minor.
6. currentState represents the character's initial state (at story start); updatedAtChapter is fixed at 0.
7. IMPORTANT: if you run out of room, write fewer characters rather than cutting a card in half. When you approach the output limit, always finish the last field of the current character card before stopping. A half-written card is discarded entirely.

【Output Format】
Must return a JSON object in the following format (characters array contains all characters):
{
  "characters": [
    {
      "name": "Character name",
      "role": "protagonist",
      "gender": "Gender",
      "age": "Age or age range",
      "appearance": "Physical description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills / cultivation",
      "motivation": "Core motivation and desires",
      "relationships": "Relationships with other characters",
      "arc": "Expected character arc / growth trajectory",
      "notes": "Other supplementary notes",
      "currentState": {
        "location": "Initial location",
        "powerLevel": "Initial level / ability tier",
        "physicalState": "Initial physical condition",
        "mentalState": "Initial psychological state",
        "keyItems": "Initially held items",
        "recentEvents": "Background events before story start",
        "updatedAtChapter": 0
      }
    }
  ]
}

If the dynamics contain no extractable characters, return {"characters": []}.`,
      ru: `Пожалуйста, извлеките всю структурированную информацию о важных персонажах из следующего текста динамики персонажей.

【Текст динамики персонажей】
{{character_dynamics}}

【Жанр романа】
{{genre}}

【Требования к заданию】
1. Извлеките всех чётко описанных персонажей (главного героя, антагониста, ключевых второстепенных) — не пропускайте ни одного.
2. Не извлекайте фоновых extras или персонажей, упомянутых лишь мимоходом.
3. Все поля берутся из текста динамики: если поле не указано и не выводится разумно, оставьте пустую строку или пропустите его — не придумывайте.
4. Каждое поле должно быть коротким, чтобы весь результат уместился в один вывод:
   - appearance: только 2-4 конкретные узнаваемые детали (одежда, манера, особая примета), не более 60 символов; если внешность не описана, выведите её из предыстории и характера, тоже не более 60 символов, без «прозы»;
   - personality, motivation, relationships, arc, notes: не более 50 символов каждое;
   - background, abilities: не более 80 символов каждое;
   - каждое поле currentState: не более 20 символов.
5. Поле role может принимать только значения: protagonist, antagonist, supporting, minor.
6. currentState отражает начальное состояние персонажа (в начале истории); updatedAtChapter фиксируется на 0.
7. ВАЖНО: если места не хватает, лучше опишите меньше персонажей, но не обрывайте карточку посередине. При приближении к лимиту вывода обязательно допишите последнее поле текущей карточки. Наполовину записанная карточка отбрасывается целиком.

【Формат вывода】
Обязательно верните объект JSON в следующем формате (массив characters содержит всех персонажей):
{
  "characters": [
    {
      "name": "Имя персонажа",
      "role": "protagonist",
      "gender": "Пол",
      "age": "Возраст или возрастная категория",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки / уровень культивации",
      "motivation": "Основная мотивация и желания",
      "relationships": "Отношения с другими персонажами",
      "arc": "Ожидаемая арка персонажа / траектория развития",
      "notes": "Другие дополнительные заметки",
      "currentState": {
        "location": "Начальное местоположение",
        "powerLevel": "Начальный уровень",
        "physicalState": "Начальное физическое состояние",
        "mentalState": "Начальное психологическое состояние",
        "keyItems": "Начальные предметы",
        "recentEvents": "Предысторические события до начала истории",
        "updatedAtChapter": 0
      }
    }
  ]
}

Если в динамике нет извлекаемых персонажей, верните {"characters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a professional novel data structuring expert.',
      ru: 'Вы — профессиональный эксперт по структурированию данных романа.'
    },
  },

  // ================================================================
  // 逆向推演 — 按章蓝图精准推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_single_chapter_blueprint',
    name: '逆向推演单章蓝图',
    description: '从已有小说章节正文高精度反推出该章的结构化蓝图信息，用于导入旧作场景',
    systemRole: '你是一位专业的网文结构分析师，擅长从正文中提取结构化蓝图信息。',
    variables: {
      chapter_content: '本章正文全文',
      chapter_number: '本章序号',
      chapter_title: '本章标题（来自拆章）',
      novel_config_summary: '全局配置脱水版',
    },
    content: `请阅读以下已有章节正文，从中提取结构化蓝图信息。

【全局小说设定概要】
{{novel_config_summary}}

【章节信息】
- 章节序号：第 {{chapter_number}} 章
- 拆章标题：{{chapter_title}}

【本章正文】
{{chapter_content}}

---

请严格按以下 JSON 格式输出本章蓝图：

{
  "chapterNumber": {{chapter_number}},
  "title": "从正文内容中提炼的精准章节标题（如果拆章标题已经不错可保留）",
  "role": "本章在全书中的角色（起、承、转、合、伏笔、高潮、过渡 等）",
  "purpose": "本章主角最想解决的核心问题（一句话）",
  "characters": ["本章出场的重要角色名"],
  "keyEvents": "本章核心事件概述（100-150字，包含因果关系和结果）",
  "suspenseHook": "章末留下的悬念或钩子（一句话）"
}

要求：
1. keyEvents 必须基于正文实际内容提取，不可臆造。
2. characters 只列主要互动角色名（3-5个），不要列龙套。
3. role 从正文的叙事功能判断（建置/发展/转折/高潮/结局/过渡等）。
4. 仅输出 JSON，不要任何额外文字。`,
    contentLocalized: {
      en: `Please read the following existing chapter text and extract structured blueprint information from it.

【Global Novel Setting Summary】
{{novel_config_summary}}

【Chapter Info】
- Chapter number: {{chapter_number}}
- Split chapter title: {{chapter_title}}

【This Chapter's Full Text】
{{chapter_content}}

---

Please output this chapter's blueprint strictly in the following JSON format:

{
  "chapterNumber": {{chapter_number}},
  "title": "Precise chapter title distilled from the text (retain if the split title is already good)",
  "role": "This chapter's role in the overall novel (setup / development / turning point / climax / resolution / transition, etc.)",
  "purpose": "The core problem the protagonist most wants to solve this chapter (one sentence)",
  "characters": ["Important character names appearing in this chapter"],
  "keyEvents": "Summary of core events in this chapter (100–150 words, including cause-and-effect and outcome)",
  "suspenseHook": "Cliffhanger or hook left at the end (one sentence)"
}

Requirements:
1. keyEvents must be extracted from the actual text — do not fabricate.
2. characters should only list main interacting characters (3–5), not extras.
3. role is determined by the narrative function in the text (setup / development / turning point / climax / resolution / transition, etc.).
4. Output only JSON — no additional text.`,
      ru: `Пожалуйста, прочитайте следующий текст существующей главы и извлеките из него структурированную информацию о плане.

【Общая сводка настроек романа】
{{novel_config_summary}}

【Информация о главе】
- Номер главы: {{chapter_number}}
- Заголовок по разбиению: {{chapter_title}}

【Полный текст этой главы】
{{chapter_content}}

---

Выведите план этой главы строго в следующем формате JSON:

{
  "chapterNumber": {{chapter_number}},
  "title": "Точный заголовок главы, извлечённый из текста (сохраните, если заголовок по разбиению уже хорош)",
  "role": "Роль этой главы в общем романе (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.)",
  "purpose": "Основная проблема, которую герой хочет решить в этой главе (одно предложение)",
  "characters": ["Имена важных персонажей, появляющихся в этой главе"],
  "keyEvents": "Краткое изложение основных событий главы (100–150 слов, включая причинно-следственные связи и результат)",
  "suspenseHook": "Интрига или крючок, оставленный в конце (одно предложение)"
}

Требования:
1. keyEvents должны быть извлечены из фактического текста — не придумывайте.
2. characters должны включать только основных взаимодействующих персонажей (3–5), не фоновых extras.
3. role определяется повествовательной функцией в тексте (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.).
4. Выводите только JSON — никакого дополнительного текста.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst, skilled at extracting structured blueprint information from prose.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов, искусно извлекающий структурированную информацию о плане из прозы.'
    },
  },

  // ================================================================
  // 逆向推演 — 向量采样增强版配置推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_novel_config_with_vectors',
    name: '向量采样增强推演',
    description: '利用向量检索采样的精确内容片段，增强全局配置推演的准确度',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sampled_worldview: '向量检索：世界观与力量体系相关片段',
      sampled_protagonist: '向量检索：主角设定与金手指相关片段',
      sampled_conflict: '向量检索：核心矛盾与敌对势力相关片段',
      sampled_style: '向量检索：写作风格与叙事视角相关片段',
      first_chapter: '第一章正文（开局风格参考）',
      latest_chapter: '最新一章正文（当前进度参考）',
      total_chapters: '已有总章数',
    },
    content: `请根据以下从小说中精准提取的关键片段，逆向推演出这部小说的完整设定体系。

【第一章正文（开局风格参考）】
{{first_chapter}}

【最新一章正文（当前进度参考）】
{{latest_chapter}}

【总章数】{{total_chapters}} 章

【向量检索精选片段 — 世界观与力量体系】
{{sampled_worldview}}

【向量检索精选片段 — 主角设定与金手指】
{{sampled_protagonist}}

【向量检索精选片段 — 核心矛盾与敌对势力】
{{sampled_conflict}}

【向量检索精选片段 — 写作风格与叙事手法】
{{sampled_style}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "只填一个值，必须严格取自以下列表，不得追加说明、不得自创：玄幻 / 仙侠 / 都市 / 科幻 / 历史 / 军事 / 游戏 / 末世 / 悬疑 / 灵异 / 言情 / 古言 / 现言 / 奇幻 / 武侠 / 轻小说 / 同人 / 职场",
    "targetAudience": "只填一个值，必须严格取自以下列表，不得追加说明：男频 / 女频 / 双性向 / 全龄",
    "subGenre": "细分类型及标签",
    "plotStructure": "故事结构（three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform）",
    "narrativePOV": "叙事视角（third_limited/first_person/third_omniscient/multi_pov）",
    "coreOutline": "核心大纲（300 字以内，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于检索片段推断，未能确定的填写"（待确认）"
3. currentState 应基于最新章节推断当前状态，而非初始状态
4. plotStructure 和 narrativePOV 请根据实际叙事特征判断，而非猜测
5. 若接近输出长度上限，优先保证 JSON 完整闭合：宁可少写 1-2 张角色卡，也不能让 JSON 中途断开、缺少右括号或右引号。`,
    contentLocalized: {
      en: `Based on the following precisely extracted key passages from the novel, reverse-engineer the complete setting system of this novel.

【Chapter 1 Full Text (opening style reference)】
{{first_chapter}}

【Latest Chapter Full Text (current progress reference)】
{{latest_chapter}}

【Total chapters】{{total_chapters}}

【Vector Search Selected Passages — Worldbuilding & Power System】
{{sampled_worldview}}

【Vector Search Selected Passages — Protagonist Settings & Golden Finger】
{{sampled_protagonist}}

【Vector Search Selected Passages — Core Conflicts & Antagonist Forces】
{{sampled_conflict}}

【Vector Search Selected Passages — Writing Style & Narrative Techniques】
{{sampled_style}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "plotStructure": "Story structure (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Narrative POV (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the retrieved passages; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest chapter, not the initial state.
4. Determine plotStructure and narrativePOV based on actual narrative characteristics, not guesses.`,
      ru: `На основе следующих точно извлечённых ключевых отрывков из романа выполните обратное проектирование полной системы настроек этого романа.

【Полный текст Главы 1 (образец начального стиля)】
{{first_chapter}}

【Полный текст последней главы (образец текущего прогресса)】
{{latest_chapter}}

【Общее количество глав】{{total_chapters}}

【Избранные отрывки из векторного поиска — Мироздание и система сил】
{{sampled_worldview}}

【Избранные отрывки из векторного поиска — Настройки героя и золотой палец】
{{sampled_protagonist}}

【Избранные отрывки из векторного поиска — Основные конфликты и противостоящие силы】
{{sampled_conflict}}

【Избранные отрывки из векторного поиска — Стиль написания и повествовательные приёмы】
{{sampled_style}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "plotStructure": "Структура истории (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Точка зрения повествования (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из полученных отрывков; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из последней главы, а не из начального состояния.
4. Определите plotStructure и narrativePOV на основе фактических повествовательных характеристик, а не догадок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },

  // ================================================================
  // 定性审稿（连续性观察）
  // ================================================================
  {
    key: 'qualitative_review',
    name: '定性审稿',
    description: '对章节做连续性观察，输出可追溯的 observation（不做通过/失败判定）',
    systemRole: '你是一位资深小说编辑，擅长把「读起来不对劲的地方」说清楚：给出原文证据、说明影响，而不是给出通过或失败的判定。',
    variables: {
      chapter_info: '本章信息（章节号 / 标题 / 蓝图目标）',
      canon_context: '既定事实（时间线 / 角色状态 / 未回收伏笔 / 已知事实）',
      chapter_content: '待审章节正文',
      review_focus: '本次审稿的侧重点（可为空）',
    },
    content: `请阅读以下章节，按六个维度记录你的观察。

【本章信息】
{{chapter_info}}

【既定事实（Canon）】
{{canon_context}}

【待审正文】
{{chapter_content}}

【本次侧重点（如有，请优先关注）】
{{review_focus}}

【六个观察维度】
1. character-memory 角色记忆：角色是否知道了不该知道的事，或忘记了已经知道的事
2. prop-continuity 物资连续性：道具、钱财、装备、伤势是否凭空出现或消失
3. foreshadowing 伏笔回收：已埋的伏笔是否被遗忘，回收是否自然
4. outline-deviation 大纲偏离：本章是否完成蓝图规定的目标，有无跑偏
5. pacing 叙事节奏：信息密度、场景切换、张弛是否失衡
6. emotional-arc 情感弧线：情绪变化是否有铺垫与递进

【硬性要求】
- 只记录你**能在正文里找到原文证据**的观察；每条观察必须附至少一条原文引文（逐字照抄，不要改写、不要省略号省略）。
- 不要给章节打分，不要输出「通过 / 失败 / 合格」这类判定，也不要重写正文。
- severity 只能是 note（记录）/ watch（值得留意）/ concern（可能影响读者理解），它表示阅读优先级，不是判定。
- 没问题的维度不要为了凑数编造观察。
- 观察要具体：说清楚「哪里、怎么了、为什么值得注意」，不要写「人物塑造略显单薄」这类空话。
- 维度是 outline-deviation 的观察，必须额外给出 "classification"，取值只能是：done（大纲要求的情节已按计划完成）/ pending（大纲要求的部分还没写到）/ deviated（正文与大纲明显不符）/ missing（可能漏掉了大纲里的线索或人物行动）/ creative（大纲没规定、但属于合理的剧情发挥）/ conflict（与已确认设定冲突）。**偏离不等于错误**：作者可能在创作中调整方向，creative 与 deviated 要如实区分，不要一律当成问题。

【输出格式】
只输出 JSON，不要输出任何解释：
{
  "observations": [
    {
      "dimension": "character-memory",
      "classification": "仅 outline-deviation 维度需要，取值 done/pending/deviated/missing/creative/conflict",
      "severity": "watch",
      "title": "一句话标题",
      "detail": "具体描述：观察到什么，为什么值得注意",
      "evidence": [{ "quote": "正文原文，逐字照抄", "source": "第12章" }],
      "suggestion": "可以怎么改（可选，写成建议而不是命令）",
      "relatedChapters": [12]
    }
  ]
}`,
    contentLocalized: {
      en: `Read the following chapter and record your observations across six dimensions.

【Chapter Info】
{{chapter_info}}

【Established Facts (Canon)】
{{canon_context}}

【Chapter Text Under Review】
{{chapter_content}}

【Focus For This Pass (if any)】
{{review_focus}}

【Six Observation Dimensions】
1. character-memory: does a character know something they should not, or forget something they already knew
2. prop-continuity: do props, money, equipment, or injuries appear or vanish out of nowhere
3. foreshadowing: are planted setups forgotten, and are payoffs natural
4. outline-deviation: does this chapter achieve its blueprint goal, or drift away from it
5. pacing: are information density, scene transitions, and tension balanced
6. emotional-arc: are emotional shifts prepared and progressive

【Hard Requirements】
- Only record observations you can support with **verbatim evidence from the chapter**. Every observation needs at least one exact quote (copy it character by character, do not paraphrase or use ellipses).
- Do not grade the chapter. Do not output pass/fail/qualified verdicts. Do not rewrite the chapter.
- severity may only be note / watch / concern. It expresses reading priority, not a verdict.
- If a dimension has no issue, do not invent an observation for it.
- Be specific: say what, where, and why it matters. Avoid empty remarks like "the characterization feels thin".
- Observations with dimension outline-deviation must also include "classification", one of: done / pending / deviated / missing / creative / conflict. **Deviation is not an error**: the author may be deliberately changing direction, so distinguish creative (a reasonable addition the blueprint never specified) from deviated (the text clearly contradicts the blueprint).

【Output Format】
Output JSON only, with no explanation:
{
  "observations": [
    {
      "dimension": "character-memory",
      "classification": "only for outline-deviation: done/pending/deviated/missing/creative/conflict",
      "severity": "watch",
      "title": "One-line title",
      "detail": "What you observed and why it matters",
      "evidence": [{ "quote": "exact text from the chapter", "source": "Chapter 12" }],
      "suggestion": "How it could be changed (optional, phrased as a suggestion)",
      "relatedChapters": [12]
    }
  ]
}`,
      ru: `Прочитайте следующую главу и запишите наблюдения по шести измерениям.

【Информация о главе】
{{chapter_info}}

【Установленные факты (Canon)】
{{canon_context}}

【Текст главы на рецензию】
{{chapter_content}}

【Акцент этого прохода (если есть)】
{{review_focus}}

【Шесть измерений наблюдения】
1. character-memory: не знает ли персонаж то, чего знать не должен, или не забыл ли то, что уже знал
2. prop-continuity: не появляются и не исчезают ли предметы, деньги, снаряжение, травмы из ниоткуда
3. foreshadowing: не забыты ли заложенные завязки, естественна ли их отдача
4. outline-deviation: достигнута ли цель главы по конспекту, нет ли ухода в сторону
5. pacing: сбалансированы ли плотность информации, переходы между сценами и напряжение
6. emotional-arc: подготовлены ли эмоциональные сдвиги и есть ли развитие

【Жёсткие требования】
- Записывайте только те наблюдения, которые можно подтвердить **дословной цитатой из главы**. На каждое наблюдение нужна минимум одна точная цитата (копируйте знак в знак, без пересказа и многоточий).
- Не оценивайте главу баллами. Не выводите вердикты «прошло / не прошло / зачёт». Не переписывайте главу.
- severity может быть только note / watch / concern. Это приоритет чтения, а не вердикт.
- Если в измерении нет проблемы, не придумывайте наблюдение.
- Будьте конкретны: что, где и почему это важно. Избегайте пустых формулировок.
- Наблюдения с измерением outline-deviation обязаны содержать "classification" со значением из: done / pending / deviated / missing / creative / conflict. **Отклонение — не ошибка**: автор может сознательно менять направление, поэтому отличайте creative (разумное дополнение, которого не было в конспекте) от deviated (текст явно противоречит конспекту).

【Формат вывода】
Только JSON, без пояснений:
{
  "observations": [
    {
      "dimension": "character-memory",
      "classification": "только для outline-deviation: done/pending/deviated/missing/creative/conflict",
      "severity": "watch",
      "title": "Заголовок в одну строку",
      "detail": "Что замечено и почему это важно",
      "evidence": [{ "quote": "дословный фрагмент текста", "source": "Глава 12" }],
      "suggestion": "Как можно изменить (необязательно, в форме предложения)",
      "relatedChapters": [12]
    }
  ]
}`,
    },
    systemRoleLocalized: {
      en: 'You are a seasoned fiction editor, skilled at articulating what feels off in a chapter: you cite textual evidence and explain the impact instead of issuing a pass/fail verdict.',
      ru: 'Вы — опытный редактор художественной литературы, умеющий точно объяснить, что «не так» в главе: вы приводите текстовые доказательства и объясняете влияние вместо вынесения вердикта «прошло / не прошло».'
    },
  },
]
