/**
 * 内置 Prompt 模板：全局架构与设定
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const ARCHITECTURE_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // AI 一键配置生成
  // ================================================================
  {
    key: 'generate_global_config',
    name: '全文配置生成',
    description: '根据用户一句话灵感，生成完整的小说配置 JSON',
    systemRole: '你是一位入行十年的顶尖网文主编与白金大神作家，擅长从一句话灵感中提炼完整的商业小说配置。',
    variables: {
      user_idea: '用户输入的灵感/想法',
      number_of_chapters: '计划总章数',
      word_number: '每章计划字数',
    },
    content: `基于作者提供的一句话点子或初步脑洞，请按照当今最成熟、最具商业霸榜潜力的网文核心结构，扩展并补全一部小说的全局爆款设定。

作者初步脑洞：
{{user_idea}}

小说规模（重要！请严格根据此参数设计节奏）：
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【核心任务要求】
1. 深度挖掘商业价值：提取强烈的"爽点"、"情绪痛点"，构建极具张力的起承转合。
2. 专业化设定：应用"角色图谱"和"三维世界观"理念，杜绝假大空，所有设定必须为推动情节和产生直接冲突服务。
3. 契合市场：如果作者未指定基础类型，请推断一个最契合的爆火类型。
4. 节奏定制：globalGuidance 中的前/中/后期章节区间、小/中/大高潮频率，必须严格基于【{{number_of_chapters}} 章】的实际规模推算，禁止使用与实际章数不符的数字。
5. 智能推荐：根据类型和题材推荐最合适的故事结构和叙事视角。`,
    systemSuffix: `【输出格式限制】
- 必须以标准的 JSON 格式返回，确保匹配以下结构。
- 只输出上面列出的字段，不要输出 totalChapters / wordsPerChapter（章数与每章字数由界面参数决定）。
- 各字段信息写完即止，不要为凑字数注水；若接近输出长度上限，优先保证 JSON 完整闭合：宁可把当前字段写短，也绝不能让 JSON 中途断开、缺少右括号或右引号。

【JSON 字段结构】
{
    "genre": "只填一个值，必须严格取自以下列表，不得追加说明、不得自创：玄幻 / 仙侠 / 都市 / 科幻 / 历史 / 军事 / 游戏 / 末世 / 悬疑 / 灵异 / 言情 / 古言 / 现言 / 奇幻 / 武侠 / 轻小说 / 同人 / 职场",
    "targetAudience": "只填一个值，必须严格取自以下列表，不得追加说明：男频 / 女频 / 双性向 / 全龄",
    "subGenre": "细分子类型及核心标签（如：末日废土、苟道流、权谋、大女主逆袭）",
    "plotStructure": "只填一个枚举值，不得追加说明：three_act（三幕结构）/ heros_journey（英雄之旅）/ save_the_cat（节拍表）/ kishotenketsu（起承转合）/ multi_thread（多线叙事）/ freeform（自由结构）；选择理由写进 globalGuidance 开头一行",
    "narrativePOV": "只填一个枚举值，不得追加说明：third_limited（第三人称有限视角）/ first_person（第一人称）/ third_omniscient（第三人称全知视角）/ multi_pov（多视角轮换）；选择理由写进 globalGuidance 开头一行",
    "coreOutline": "核心大纲（300 字左右，上限 400 字，含：主角的致命危机/开局困境、必须完成的核心目标、终极大危机、主要爽点起伏）",
    "worldSetting": "独特的背景设定（物理维度、权力断层、核心资源争夺机制）",
    "goldenFinger": "核心卖点与金手指体系（获取方式、具体功能、进阶成长路径、副作用/限制）",
    "protagonistProfile": "主角人设档案（极具反差的性格弱点、表面伪装标签、核心驱动力：物质目标+深层灵魂渴望）",
    "globalGuidance": "全局写作指导与核心禁忌（严格基于{{number_of_chapters}}章规模：前/中/后期各占多少章、小/中/大高潮的具体章节频率、严禁触碰的毒点）",
    "writingStyle": "文风配置（120 字左右，上限 200 字，涵盖：叙述节奏快慢与场景切换频率、描写密度偏好、对话风格与口语化程度、用词偏好古风/现代/专业术语、情感基调热血/冷峻/诙谐/沉重、标志性修辞手法与过渡技巧。请根据类型和受众推荐最匹配的写作风格）"
}`,
    contentLocalized: {
      en: `Based on the author's one-line idea or initial concept, please expand and complete a novel's global bestseller configuration following the most mature and commercially dominant web novel core structure.

Author's initial concept:
{{user_idea}}

Novel scale (IMPORTANT! Design pacing strictly according to these parameters):
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Core Requirements】
1. Deep commercial value mining: Extract powerful "satisfaction points" and "emotional pain points" to build a compelling setup-development-twist-resolution arc.
2. Professional-grade settings: Apply "character graph" and "3D worldbuilding" principles. All settings must serve plot progression and direct conflict — no empty filler.
3. Market fit: If the author hasn't specified a base genre, infer the most commercially explosive type.
4. Pacing customization: The early/mid/late chapter ranges and minor/medium/major climax frequencies in globalGuidance must be strictly calculated based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
5. Smart recommendations: Recommend the most suitable story structure and narrative POV based on the genre and theme.`,
      ru: `Основываясь на одной идее или начальном наброске автора, пожалуйста, расширьте и дополньте глобальную конфигурацию романа-бестселлера, следуя самой зрелой и коммерчески доминирующей структуре веб-романа.

Начальная идея автора:
{{user_idea}}

Масштаб романа (ВАЖНО! Пacing проектируйте строго по этим параметрам):
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Основные требования】
1. Глубокая挖掘 коммерческой ценности: извлекайте мощные «точки удовлетворения» и «эмоциональные болевые точки» для построения захватывающей арки завязки-развития-кульминации-развязки.
2. Профессиональные настройки: применяйте принципы «карты персонажей» и «3D-мировоззрения». Все настройки должны служить продвижению сюжета и созданию прямых конфликтов — никакой пустой воды.
3. Соответствие рынку: если автор не указал базовый жанр, угадайте самый коммерчески взрывной тип.
4. Кастомизация темпа: диапазоны глав начальной/средней/финальной частей и частота малых/средних/крупных кульминаций в globalGuidance должны быть строго рассчитаны по фактическому масштабу [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
5. Умные рекомендации: рекомендуйте наиболее подходящую структуру故事 и повествовательную точку зрения на основе жанра и темы.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and platinum-selling author with ten years of industry experience, skilled at distilling a one-line idea into a complete commercial novel configuration.',
      ru: 'Вы — ведущий редактор веб-романов и платиновый автор с десятилетним опытом, искусно превращающий одну идею в полную коммерческую конфигурацию романа.'
    },
  },

  // ================================================================
  // 架构生成 — 四步流水线
  // ================================================================

  {
    key: 'premise',
    name: '故事前提',
    description: '故事架构第一步：提炼故事前提（Story Premise），浓缩全书的核心卖点与冲突链',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      genre: '小说类型',
      sub_genre: '细分类型',
      topic: '核心主题/故事简介',
      target_audience: '目标受众',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      core_setting: '世界观基盘设定',
      golden_finger: '核心金手指/卖点',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请提炼本书的故事前提（Story Premise）。这是一本【{{genre}}】（细分类别：{{sub_genre}}）小说。

【核心设定参数】
- 核心大纲：{{topic}}
- 目标受众：{{target_audience}}
- 预期篇幅：约{{number_of_chapters}}章（每章{{word_number}}字）
- 世界观基盘：{{core_setting}}
- 核心金手指/系统：{{golden_finger}}
- 主角核心人设：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请生成一份 300-500 字的结构化故事前提，严格按以下四个小节输出：

## 一句话前提（Logline）
用 30-50 字极度浓缩全书核心："当 [主角身份] 遭遇 [触发事件]，必须 [核心行动] 否则 [灾难后果]。"

## 核心冲突链
展开描述：主角的初始困境 → 打破平衡的触发事件 → 核心主线目标 → 主要阻碍势力。（约 100 字）

## 金手指定位
详细说明：金手指的获取方式 → 核心机制与功能 → 与世界观规则的交互点 → 进阶路线与限制/代价。（约 100-150 字）

## 悬念骨架
描述：显性冲突线（当前最大威胁）+ 隐藏主线暗示（终极悬念/深层真相）。（约 100 字）

【要求】
1. 金手指必须是推动情节的核心手段，要具体描述其独特机制，不要泛泛而谈。
2. 必须体现主角基于设定的核心欲望或执念。
3. 冲突链必须包含显性敌人与深层危机两个层次。
4. 严格避开全局写作要求与禁忌中的毒点。
5. 使用上述 Markdown 小节标题分隔，不要添加额外解释。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Please distill the story premise for this novel. This is a [{{genre}}] novel (sub-genre: {{sub_genre}}).

【Core Setting Parameters】
- Core outline: {{topic}}
- Target audience: {{target_audience}}
- Expected length: approximately {{number_of_chapters}} chapters ({{word_number}} words each)
- Worldbuilding foundation: {{core_setting}}
- Golden finger / core selling point: {{golden_finger}}
- Protagonist profile: {{protagonist_profile}}
- Global writing requirements and prohibitions: {{global_guidance}}

【Generation Task】
Generate a 300–500 word structured story premise, strictly following these four sections:

## One-Line Premise (Logline)
Condense the entire novel's core in 30–50 words: "When [protagonist identity] encounters [triggering event], they must [core action] or else [catastrophic consequence]."

## Core Conflict Chain
Elaborate: protagonist's initial dilemma → the event that shatters equilibrium → core main-line objective → primary antagonistic forces. (~100 words)

## Golden Finger Positioning
Detail: how the golden finger is obtained → core mechanics and functions → interaction points with world rules → progression paths and limitations/costs. (~100–150 words)

## Suspense Skeleton
Describe: the overt conflict line (current biggest threat) + hidden main-line hints (ultimate mystery / deep truth). (~100 words)

【Requirements】
1. The golden finger must be a core plot-driving mechanism — describe its unique mechanics in detail, no vague hand-waving.
2. Must embody the protagonist's core desire or obsession derived from their setting.
3. The conflict chain must include both an overt enemy and a deeper crisis.
4. Strictly avoid any prohibited elements listed in global writing requirements.
5. Use the Markdown section headings above as separators; do not add extra commentary.

【Reference Works (if any — match tone and pacing)】
{{reference_works}}`,
      ru: `Пожалуйста, сформулируйте сюжетную посылку для этого романа. Это роман жанра [{{genre}}] (поджанр: {{sub_genre}}).

【Параметры основных настроек】
- Основной конспект: {{topic}}
- Целевая аудитория: {{target_audience}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав (по {{word_number}} слов в каждой)
- Фундамент мироздания: {{core_setting}}
- Золотой палец / ключевая фишка: {{golden_finger}}
- Профиль главного героя: {{protagonist_profile}}
- Глобальные требования и запреты на написание: {{global_guidance}}

【Задание по генерации】
Создайте структурированную сюжетную посылку из 300–500 слов, строго следуя четырём разделам:

## Однострочная посылка (Логлайн)
Уместите ядро всего романа в 30–50 слов: «Когда [идентичность героя] сталкивается с [триггерным событием], он должен [ключевое действие], иначе [катастрофическое последствие].»

## Цепь основных конфликтов
Разверните: начальная дилемма героя → событие, разрушающее равновесие → основная главная цель → главные противостоящие силы. (~100 слов)

## Позиционирование золотого пальца
Детализируйте: способ получения золотого пальца → основные механики и функции → точки взаимодействия с правилами мира → пути развития и ограничения/цена. (~100–150 слов)

## Каркас интриги
Опишите: линия явного конфликта (текущая главная угроза) + скрытые подсказки основной линии (тайна финала / глубинная правда). (~100 слов)

【Требования】
1. Золотой палец должен быть ключевым двигателем сюжета — опишите его уникальные механики подробно, без абстрактных общих фраз.
2. Должно отражаться основное желание или одержимость героя, вытекающие из его сеттинга.
3. Цепь конфликтов должна включать как явного врага, так и более глубокую угрозу.
4. Строго избегайте любых запрещённых элементов из глобальных требований.
5. Используйте заголовки разделов выше как разделители; не добавляйте лишних комментариев.

【Эталонные произведения (если есть — ориентируйтесь на тон и ритм)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'character_dynamics',
    name: '角色图谱',
    description: '故事架构第二步：构建核心角色关系网与角色弧光',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      protagonist_profile: '主角人设',
      golden_finger: '金手指体系',
      world_building: '世界观设定',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请基于故事前提为本书塑造一个极具戏剧张力的核心角色图谱。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 主角预设档案：{{protagonist_profile}}
- 金手指体系：{{golden_finger}}
- 世界观背景：{{world_building}}
- 预期篇幅：约{{number_of_chapters}}章
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
围绕主角，根据小说篇幅（{{number_of_chapters}}章）设计合理数量的核心角色（短篇3-4人，中长篇4-6人）。角色切忌脸谱化。请生成包含以下结构的角色图谱：

1. 【第一核心：主角】
- 表面追求与终极渴望（根据档案补全性格的明暗两面）
- 标志性外貌特征（衣着、气质、独特标志等）
- 金手指使用风格（基于「{{golden_finger}}」的具体机制，设计独特的使用习惯或战斗/升级策略）
- 灵魂软肋与蜕变预期（角色弧光起始点 → 终点）

2. 【核心角色阵营】
为每位角色提供：姓名/代号、身份背景、标志性外貌特征、与主角的关系张力、暗藏秘密。
角色设计原则（非固定模板，根据故事需要灵活配置）：
- 至少 1 位与主角有深度羁绊的盟友/伙伴（互补而非附庸）
- 至少 1 位与主角理念对立的竞争者/对手（有自己的正当动机）
- 可选：1 位隐藏变数/灰色角色（立场不定，可能带来反转）
- 可选：根据故事需要增加导师、阴谋家、势力代言人等

3. 【核心矛盾交织网】
简述所有角色如何因为世界观下的生存压力、资源争夺或信念冲突产生不可避免的碰撞。

【要求】
1. 主角必须严格符合主角档案基调，不可偏离。
2. 所有角色的设计必须贴合「{{genre}}」类型的读者期待。
3. 默认避免圣母、降智反派或纯工具人（除非作者明确要求）。
4. 主角与每位核心角色都要单独写一行「身份档案」，格式固定为：性别｜年龄｜当前身份与境界（一句话讲清，不要展开）。这一行会在后续提取角色卡时被直接取用，务必写准。
5. 仅返回角色图谱文本，不要任何客套话。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Based on the story premise, create a highly dramatic core character map for this novel.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Protagonist profile: {{protagonist_profile}}
- Golden finger system: {{golden_finger}}
- Worldbuilding: {{world_building}}
- Expected length: approximately {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}}

【Generation Task】
Design a reasonable number of core characters around the protagonist, proportional to the novel's length (3–4 for short stories, 4–6 for medium/long works). Characters must avoid being one-dimensional. Generate a character map with the following structure:

1. 【The Core: Protagonist】
- Surface desires vs. ultimate yearning (flesh out both light and dark sides of the personality)
- Signature physical traits (clothing, aura, distinctive marks, etc.)
- Golden finger usage style (based on the specific mechanics of "{{golden_finger}}", design unique usage habits or combat/leveling strategies)
- Soul vulnerability and transformation arc (starting point → endpoint)

2. 【Core Character Camp】
For each character provide: name/code, background, signature physical traits, tension in their relationship with the protagonist, hidden secrets.
Character design principles (flexible, not a rigid template — configure based on story needs):
- At least 1 ally/partner with deep bonds to the protagonist (complementary, not subordinate)
- At least 1 rival/opponent with opposing ideologies (who has their own legitimate motivations)
- Optional: 1 hidden wild card / morally grey character (unpredictable allegiance, potential for twists)
- Optional: add mentor, mastermind, faction spokesperson, etc. as the story requires

3. 【Core Conflict Web】
Briefly describe how all characters inevitably clash due to survival pressures, resource competition, or ideological conflict within the world.

【Requirements】
1. Protagonist must strictly match the protagonist profile's tone — no deviations.
2. All character designs must fit reader expectations for the "{{genre}}" genre.
3. By default avoid saintly sages, idiotic villains, or pure utility characters (unless the author explicitly requests them).
4. The protagonist and every core character must each have one dedicated "identity file" line in this exact form: gender | age | current identity and tier (one short sentence, do not elaborate). It is read verbatim when character cards are extracted later, so keep it accurate.
5. Return only the character map text — no pleasantries.

【Reference Works (if any)】
{{reference_works}}`,
      ru: `На основе сюжетной посылки создайте максимально драматичную карту ключевых персонажей для этого романа.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Профиль главного героя: {{protagonist_profile}}
- Система золотого пальца: {{golden_finger}}
- Мироздание: {{world_building}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
Спроектируйте разумное количество ключевых персонажей вокруг героя, пропорциональное объёму романа (3–4 для коротких историй, 4–6 для средних/длинных). Персонажи должны избегать шаблонности. Создайте карту персонажей со следующей структурой:

1. 【Ядро: Главный герой】
- Поверхностные желания vs. глубинная тоска (раскройте обе стороны личности — светлую и тёмную)
- Характерные внешние черты (одежда, аура, уникальные приметы и т.д.)
- Стиль использования золотого пальца (на основе конкретных механик «{{golden_finger}}» придумайте уникальные привычки использования или боевую/прогрессирующую стратегию)
- Душевная уязвимость и арка трансформации (начальная точка → конечная)

2. 【Лагерь ключевых персонажей】
Для каждого персонажа укажите: имя/код, предысторию, характерные внешние черты, напряжённость в отношениях с героем, скрытые тайны.
Принципы проектирования (гибкие, а не шаблон — настраивайте по потребностям истории):
- Как минимум 1 союзник/партнёр с глубокой связью с героем (дополняющий, а не подчинённый)
- Как минимум 1 соперник/противник с противоположными идеологиями (имеющий свои обоснованные мотивы)
- По желанию: 1 скрытый wild card / морально серый персонаж (непредсказуемая позиция, потенциал для переворотов)
- По желанию: добавьте наставника, интригана, представителя фракции и т.д. по необходимости

3. 【Сеть основных конфликтов】
Кратко опишите, как все персонажи неизбежно сталкиваются из-за давления выживания, конкуренции за ресурсы или идеологических противоречий в мире.

【Требования】
1. Главный герой должен строго соответствовать тону профиля — никаких отклонений.
2. Все персонажи должны соответствовать ожиданиям читателей жанра «{{genre}}».
3. По умолчанию избегайте безоговорочно святых, тупых злодеев или чисто функциональных персонажей (если автор явно не попросил).
4. Для главного героя и каждого ключевого персонажа добавьте отдельную строку «личное дело» строго в таком виде: пол | возраст | текущий статус и уровень (одно короткое предложение, без подробностей). Эта строка считывается напрямую при извлечении карточек персонажей, поэтому пишите её точно.
5. Возвращайте только текст карты персонажей — никаких вступлений.

【Эталонные произведения (если есть)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'world_building',
    name: '世界观构建',
    description: '故事架构第三步：构建自带冲突引擎的世界观矩阵',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      core_setting: '世界观基盘',
      golden_finger: '金手指体系',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将基础设定转化为能直接引发冲突的"剧情游乐场"。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 核心世界观设定：{{core_setting}}
- 金手指体系：{{golden_finger}}
- 主角定位：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请基于核心世界观，根据「{{genre}}」类型的特点，构建以下三个维度的世界观设定。每个设定都必须"自带冲突点"，能直接驱动情节。

1. 【核心规则与体系漏洞】
- 本世界运转的核心规则是什么？（根据类型可以是：修炼体系、科技等级、社会制度、超自然法则等）
- 规则中的绝对优势是什么？主角的金手指「{{golden_finger}}」如何在这套规则下占据独特的非对称优势？

2. 【阶层断层与资源战场】
- 这个世界里存在哪些不可调和的势力/阶层/阵营对立？
- 最稀缺的核心资源是什么？它是如何分配的？主角处于什么位置，需要向谁争夺？

3. 【隐喻与深层危机】
- 世界背后的终极灾变或最大谜团是什么？
- 有什么流传的禁忌、历史谎言或被掩盖的真相，恰好与主角的命运产生交汇？

【要求】
1. 所有设定必须围绕「{{genre}}」题材的核心看点，不要写无法融入正文的废话设定。
2. 金手指与世界规则的交互必须具体、可操作，避免泛泛而谈。
3. 严格遵循全局写作要求与禁忌，禁止崩坏。
4. 仅返回世界观设定文本，不要生成任何无关代码或解释。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Transform the base settings into a "plot playground" that directly generates conflict.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Core worldbuilding: {{core_setting}}
- Golden finger system: {{golden_finger}}
- Protagonist positioning: {{protagonist_profile}}
- Global writing requirements: {{global_guidance}}

【Generation Task】
Based on the core worldbuilding and the characteristics of the "{{genre}}" genre, construct world settings across the following three dimensions. Every element must "carry built-in conflict points" that directly drive the plot.

1. 【Core Rules & System Exploits】
- What are the fundamental rules governing this world? (Depending on genre: cultivation system, technology tiers, social structure, supernatural laws, etc.)
- What is the absolute advantage within these rules? How does the protagonist's golden finger "{{golden_finger}}" create a unique asymmetric edge within this system?

2. 【Class Fractures & Resource Battlegrounds】
- What irreconcilable faction/class/factional oppositions exist in this world?
- What is the scarcest core resource? How is it distributed? Where does the protagonist stand, and who must they compete against?

3. 【Metaphor & Hidden Crisis】
- What is the ultimate catastrophe or greatest mystery behind this world?
- Are there forbidden knowledge, historical lies, or suppressed truths that happen to intersect with the protagonist's destiny?

【Requirements】
1. All settings must revolve around the core appeal of the "{{genre}}" genre — no empty settings that can't be woven into the narrative.
2. The interaction between golden finger and world rules must be specific and actionable — no vague generalities.
3. Strictly follow global writing requirements and prohibitions.
4. Return only the worldbuilding text — no irrelevant code or explanations.`,
      ru: `Преобразуйте базовые настройки в «сюжетную площадку», непосредственно порождающую конфликты.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Основное мироздание: {{core_setting}}
- Система золотого пальца: {{golden_finger}}
- Позиционирование героя: {{protagonist_profile}}
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
На основе основного мироздания и характеристик жанра «{{genre}}» постройте настройки мира по трём измерениям. Каждый элемент должен «нести встроенные точки конфликта», непосредственно движущие сюжет.

1. 【Основные правила и уязвимости системы】
- Каковы фундаментальные правила, управляющие этим миром? (В зависимости от жанра: система культивации, уровни технологии, социальная структура, сверхъестественные законы и т.д.)
- Какое абсолютное преимущество существует в рамках этих правил? Как золотой палец героя «{{golden_finger}}» создаёт уникальное асимметричное преимущество в этой системе?

2. 【Классовые разломы и ресурсные арены】
- Какие непримиримые противостояния фракций/классов/лагерей существуют в этом мире?
- Какой ресурс является самым дефицитным? Как он распределяется? Где находится герой и с кем ему приходится конкурировать?

3. 【Метафора и скрытый кризис】
- Какова终极ная катастрофа или величайшая тайна, стоящая за этим миром?
- Существуют ли запретные знания, историческая ложь или скрытая правда, которая пересекается с судьбой героя?

【Требования】
1. Все настройки должны вращаться вокруг ключевой привлекательности жанра «{{genre}}» — никаких пустых настроек, которые нельзя вплести в повествование.
2. Взаимодействие золотого пальца и правил мира должно быть конкретным и применимым — никаких абстрактных общих фраз.
3. Строго следуйте глобальным требованиям и запретам на написание.
4. Возвращайте только текст мироздания — никакого лишнего кода или пояснений.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'synopsis',
    name: '情节大纲',
    description: '故事架构第四步：整合所有碎片，按用户选择的故事结构模式生成情节大纲',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      character_dynamics: '角色图谱',
      world_building: '世界观',
      genre: '小说类型',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      plot_structure_guide: '故事结构详细指导（由系统根据用户选择的结构模式动态注入）',
      narrative_pov: '叙事视角描述',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将前序生成的所有碎片整合为全书的情节大纲。

【核心资产】
- 小说类型：{{genre}}
- 叙事视角：{{narrative_pov}}
- 故事前提：{{premise}}
- 角色图谱：{{character_dynamics}}
- 世界观矩阵：{{world_building}}
- 全局写作要求与禁忌：{{global_guidance}}

【篇幅参数（极其重要！结构节点必须严格基于此）】
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【故事结构模式——严格按以下结构组织大纲】
{{plot_structure_guide}}

【生成任务】
严密推演涵盖全书的情节大纲。写"结构拐点"而非细纲。请根据「{{genre}}」类型的核心看点调整节奏策略。

【要求】
1. 结构节点的章节区间必须基于【{{number_of_chapters}}章】的实际规模标注具体范围，禁止使用与实际章数不符的数字。
2. 每个结构节点都要提到"具体会发生什么事"，不能泛泛而谈。
3. 节奏策略要匹配「{{genre}}」类型（如爽文侧重打脸与升级节奏，悬疑侧重线索与反转，言情侧重情感与误会）。
4. 叙事视角为「{{narrative_pov}}」，大纲设计时需考虑视角限制对信息揭露、悬念制造的影响。
5. 绝不能触碰全局写作要求与禁忌中的毒点。
6. 仅返回情节大纲纯文本，禁止一切废话或旁白。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Integrate all prior outputs into a complete plot synopsis for the entire novel.

【Core Assets】
- Novel genre: {{genre}}
- Narrative POV: {{narrative_pov}}
- Story premise: {{premise}}
- Character dynamics: {{character_dynamics}}
- Worldbuilding matrix: {{world_building}}
- Global writing requirements: {{global_guidance}}

【Scale Parameters (CRITICAL! Structural beats must be based on these)】
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Story Structure Model — organize the outline strictly according to this structure】
{{plot_structure_guide}}

【Generation Task】
Rigorously derive a plot synopsis covering the entire novel. Write "structural turning points," not a detailed scene-by-scene outline. Adjust pacing strategy based on the core appeal of the "{{genre}}" genre.

【Requirements】
1. Chapter ranges for structural beats must be labeled with specific ranges based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
2. Each structural beat must specify "what exactly will happen" — no vague generalities.
3. Pacing strategy must match the "{{genre}}" genre (e.g., power fantasy focuses on face-slapping and leveling rhythm; mystery focuses on clues and reversals; romance focuses on emotion and misunderstandings).
4. The narrative POV is "{{narrative_pov}}" — the outline design must account for how POV limitations affect information reveal and suspense creation.
5. Never violate any prohibitions listed in global writing requirements.
6. Return only the plot synopsis as plain text — no filler or narration.`,
      ru: `Объедините все предыдущие выходы в полный сюжетный синопсис на весь роман.

【Основные активы】
- Жанр романа: {{genre}}
- Точка зрения повествования: {{narrative_pov}}
- Сюжетная посылка: {{premise}}
- Динамика персонажей: {{character_dynamics}}
- Матрица мироздания: {{world_building}}
- Глобальные требования к написанию: {{global_guidance}}

【Параметры масштаба (КРИТИЧНО! Структурные узлы должны строиться на основе этих данных)】
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Модель структуры истории — организуйте конспект строго по этой структуре】
{{plot_structure_guide}}

【Задание по генерации】
Строгий вывод сюжетного конспекта на весь роман. Пишите «структурные поворотные точки», а не подробный посценарный план. Корректируйте стратегию темпа на основе ключевой привлекательности жанра «{{genre}}».

【Требования】
1. Диапазоны глав для структурных узлов должны быть обозначены конкретными диапазонами на основе фактического масштаба [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
2. Каждый структурный узел должен указывать, «что именно произойдёт» — никаких абстрактных общих фраз.
3. Стратегия темпа должна соответствовать жанру «{{genre}}» (например, фэнтези силы делает акцент на унижении врагов и ритме прокачки; детектив — на уликах и поворотах; романтика — на эмоциях и недопонимании).
4. Точка зрения повествования — «{{narrative_pov}}» — при проектировании конспекта учитывайте, как ограничения точки зрения влияют на раскрытие информации и создание интриги.
5. Никогда не нарушайте запреты из глобальных требований к написанию.
6. Возвращайте только текст сюжетного конспекта — никакой воды или авторских ремарок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },
]
