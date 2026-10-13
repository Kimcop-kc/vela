/**
 * Vela 内置 Prompt 模板库（公开入口）
 *
 * 这个文件现在只做**转发**，实现已按域拆到 ./prompts/ 下 ——
 * 拆分前这里是 3478 行单文件，其中 3024 行（87%）是一个内置模板数组字面量，
 * 想改「首章正文」的提示词得在 3000 行里翻。
 *
 * 保留这个路径不动，是为了不影响 20 多个既有引用点（工作流命令、提示词设置页、
 * store 等），它们继续 `from '../prompt-templates'` 即可。
 *
 * 拆分后的组成：
 *   prompts/prompt-template-types.ts   PromptTemplate 类型、本地化取值、可编辑 key 清单
 *   prompts/builtin/*.ts               内置模板，按创作阶段分域（架构/蓝图/正文/修稿审稿/导入推断/文风）
 *   prompts/builtin/index.ts           按原顺序拼出 BUILTIN_PROMPTS
 *   prompts/prompt-registry.ts         三级覆盖（项目级 > 全局级 > 内置）、版本留档、渲染
 */
export * from './prompts/prompt-template-types'
export * from './prompts/builtin'
export * from './prompts/prompt-registry'
