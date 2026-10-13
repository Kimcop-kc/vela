/**
 * 内置 Prompt 模板：章节蓝图
 *
 * 正文是多行模板字符串，缩进即提示词内容的一部分，改动空白会直接影响发给模型的文本。
 * 模板数组的顺序不影响 PromptSettings 的展示顺序（那由 builtin/index.ts 决定）。
 */

import type { PromptTemplate } from '../prompt-template-types'

export const BLUEPRINT_PROMPTS: PromptTemplate[] = [
  // ================================================================
  // 章节蓝图生成
  // ================================================================

  {
    key: 'chapter_blueprint',
    name: '章节蓝图生成（全量）',
    description: '基于全书架构一次性生成所有章节的详细蓝图',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于我们此前推演出的【全书架构引擎】，为本书生成从第1章到第{{number_of_chapters}}章的具体"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【商业网文节奏设计原则】
1. 黄金三章法则：第1章极速抛出"生存/高压困境"，第2章激活金手指/最大反差变量，第3章完成首次"小型打脸/破局"，留钩子。
2. 小高潮循环：严格执行"3-5章一个小循环"。
3. 拒绝水文与流水账：每一章都必须发生"实质性的事件变动"。
4. 悬念钩子机制：每章结尾必须有一个让读者想连续翻页的变数。

【输出格式规定】
严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "引人入胜的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "主角做了什么，遭遇了什么反转，金手指怎么用的。100字左右具体说明",
      "suspenseHook": "一句话说明结尾留了什么悬念"
    },
    {
      "chapterNumber": 2
    }
  ]
}

要求：
- 每章的 keyEvents 控制在 100-150 字以内，信息密度必须极高。
- 仅给出最终的 JSON 文本，不要任何客套解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on our previously derived [Full Novel Architecture Engine], generate a detailed "comprehensive execution blueprint" for chapters 1 through {{number_of_chapters}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Commercial Web Novel Pacing Design Principles】
1. Golden Three Chapters Rule: Chapter 1 immediately presents a "survival / high-pressure dilemma"; Chapter 2 activates the golden finger / maximum contrast variable; Chapter 3 delivers the first "small face-slapping / breakthrough" with a hook.
2. Minor Climax Cycle: Strictly enforce a "small cycle every 3–5 chapters."
3. No filler or diary entries: Every chapter must feature a "substantive plot development."
4. Suspense Hook Mechanism: Every chapter ending must have a variable that makes readers want to turn the page.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What the protagonist did, what reversal they encountered, how the golden finger was used. Explain in about 100 words",
      "suspenseHook": "One sentence describing the cliffhanger left at the end"
    },
    {
      "chapterNumber": 2
    }
  ]
}

Requirements:
- Keep each chapter's keyEvents within 100–150 words with maximum information density.
- Output only the final JSON text — no pleasantries or explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе ранее выведенного [Полного архитектурного движка романа] создайте подробный «комплексный план выполнения» для глав 1–{{number_of_chapters}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Принципы проектирования темпа коммерческого веб-романа】
1. Правило первых трёх глав: Глава 1 немедленно представляет «ситуацию выживания / высокого давления»; Глава 2 активирует золотой палец / максимальную переменную контраста; Глава 3 выдаёт первое «маленькое унижение врага / прорыв» с крючком.
2. Цикл малых кульминаций: строго соблюдайте «малый цикл каждые 3–5 глав».
3. Никакой воды и дневниковых записей: каждая глава должна содержать «существенное развитие сюжета».
4. Механизм интриги: каждое завершение главы должно содержать переменную, заставляющую читателя перевернуть страницу.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что сделал герой, какой контратаки он столкнулся, как был использован золотой палец. Опишите примерно 100 слов",
      "suspenseHook": "Одно предложение, описывающее интригу конца главы"
    }
  ]
}

Требования:
- Удерживайте keyEvents каждой главы в пределах 100–150 слов с максимальной плотностью информации.
- Выводите только финальный JSON — никаких вступлений или объяснений.

【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },

  {
    key: 'chapter_blueprint_chunk',
    name: '章节蓝图续写（分块）',
    description: '在已有目录基础上续写后续章节蓝图，支持分块生成',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_list: '已生成的章节列表（最近100章）',
      number_of_chapters: '总章数',
      n: '起始章节号',
      m: '结束章节号',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于【全书架构引擎】与【已生成的目录进度】，为接下来的 第{{n}}章到第{{m}}章 生成极其严密的"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全书规模：共 {{number_of_chapters}} 章
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【前置剧情进度与连贯性检查】
以下是前置章节（简略截取，以防遗忘主线进度）：
{{chapter_list}}

【本次生成任务：接力推演】
请紧密承接上面最后一章的情节，继续严密推演 第{{n}}章 到 第{{m}}章。
1. 连续小高潮法则：维持每 3-5 章一个小高潮的节奏。
2. 伏笔强制回收与释放：如果前面章节留下了危机，这里必须引爆或解决。
3. 拒绝水文：每一章都必须有实质性进展。

【输出格式规定】
严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "引人入胜的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "具体发生了什么，金手指怎么运作的。100字左右",
      "suspenseHook": "结尾留的钩子"
    }
  ]
}

要求：
- 严格遵循上下文连贯，不要前后矛盾。
- 仅给出最终的 JSON 文本，不要解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on the [Full Novel Architecture Engine] and the [Existing Blueprint Progress], generate an extremely detailed "comprehensive execution blueprint" for the next chapters: Chapter {{n}} through Chapter {{m}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Total novel scale: {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Previous Plot Progress & Continuity Check】
Below is the preceding chapter summary (abridged to prevent losing sight of the main plot):
{{chapter_list}}

【This Generation Task: Relay Derivation】
Pick up seamlessly from the last chapter's plot and rigorously derive Chapter {{n}} through Chapter {{m}}.
1. Continuous Minor Climax Rule: Maintain the rhythm of one minor climax every 3–5 chapters.
2. Foreshadowing Enforcement: If previous chapters left a crisis hanging, it must detonate or resolve here.
3. No filler: Every chapter must have substantive progress.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What specifically happened, how the golden finger operated. About 100 words",
      "suspenseHook": "The hook left at the end"
    }
  ]
}

Requirements:
- Strictly maintain contextual continuity — no contradictions.
- Output only the final JSON text — no explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе [Полного архитектурного движка романа] и [Текущего прогресса плана] создайте максимально подробный «комплексный план выполнения» для следующих глав: Глава {{n}}–{{m}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Общий масштаб романа: {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Предыдущий прогресс сюжета и проверка непрерывности】
Ниже приведён краткий обзор предыдущих глав (сжатый, чтобы не потерять основную сюжетную линию):
{{chapter_list}}

【Задание по генерации: ретрансляция】
Плавно перенмите от сюжета последней главы и строго выведите Главы {{n}}–{{m}}.
1. Правило непрерывных малых кульминаций: поддерживайте ритм одной малой кульминации каждые 3–5 глав.
2. Обязательное раскрытие зацепок: если в предыдущих главах остался кризис — он должен здесь взорваться или разрешиться.
3. Никакой воды: каждая глава должна содержать существенное развитие.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что конкретно произошло, как работал золотой палец. Примерно 100 слов",
      "suspenseHook": "Крючок, оставленный в конце"
    }
  ]
}

Требования:
- Строго соблюдайте контекстуальную непрерывность — никаких противоречий.
- Выводите только финальный JSON — никаких объяснений.

★【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },
]
