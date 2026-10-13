/**
 * 数据库 IPC 控制器总入口
 *
 * 这里**只做注册汇总**，不放任何 handler 实现。
 *
 * 拆分前这个文件是 1045 行、121 个 handler 全部塞在一个 933 行的函数里，
 * 想找「撤销定稿时到底清了哪些数据」得在 900 行里翻。现在按业务域分到 ./db/ 下：
 *
 *   system-controller      系统级：作者状态文件、故事文档修订、库开关、LLM 遥测
 *   project-controller     项目主台账 + 章节蓝图
 *   character-controller   角色卡
 *   draft-controller       草稿生命周期 + 章节回滚快照
 *   revision-controller    修稿 / 审稿 / 审稿摘要 / 后处理跑批
 *   canon-controller       Canon 台账：时间线/角色状态/剧情线/事实/物品/境界/地点
 *   canon-memory-controller Canon 记忆层：摘要/原子写回/统一检索/分卷/状态历史
 *   reconstruct-controller 拆书创作：逐章分析 / 原创大纲 / 相似度报告
 *   pipeline-controller    写作流水线任务状态
 *
 * 拆分是**纯搬移**，handler 实现、通道名、参数、返回值与错误语义一字未改；
 * 通道清单由 electron/__tests__/ipc-channel-allowlist.test.ts 兜底（少一个就红）。
 *
 * 注册顺序不影响行为：ipcMain.handle 按通道名索引，各模块之间通道名不重叠。
 */
import { registerSystemController } from './db/system-controller'
import { registerProjectController } from './db/project-controller'
import { registerCharacterController } from './db/character-controller'
import { registerDraftController } from './db/draft-controller'
import { registerRevisionController } from './db/revision-controller'
import { registerCanonController } from './db/canon-controller'
import { registerCanonMemoryController } from './db/canon-memory-controller'
import { registerReconstructController } from './db/reconstruct-controller'
import { registerPipelineController } from './db/pipeline-controller'

export function registerDatabaseController() {
  registerSystemController()
  registerProjectController()
  registerCharacterController()
  registerDraftController()
  registerRevisionController()
  registerCanonController()
  registerCanonMemoryController()
  registerReconstructController()
  registerPipelineController()
}
