/**
 * open_module — 直接打开软件内的功能模块
 *
 * 只负责导航，不修改作品内容。用于让 Agent 在作者说“打开设置 / 知识库 /
 * 角色 / 大纲 / 导出”等指令时直接执行，而不是让作者手动寻找入口。
 */
import { buildAgentTool } from '../tool-registry'
import { useLayoutStore } from '../../../stores/layout-store'

type ModuleId =
  | 'settings'
  | 'project'
  | 'knowledge'
  | 'books'
  | 'characters'
  | 'tasks'
  | 'logs'
  | 'models'
  | 'export'
  | 'import_novel'

export const openModuleTool = buildAgentTool({
  name: 'open_module',
  userFacingName: '打开软件模块',
  description: '直接打开 Vela 的功能模块，不修改作品内容。作者说“打开设置/模型配置/知识库/拆书/角色/大纲/日志/任务/导出/导入”时使用。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      module: {
        type: 'string',
        enum: ['settings', 'project', 'knowledge', 'books', 'characters', 'tasks', 'logs', 'models', 'export', 'import_novel'],
        description: '要打开的模块：settings 设置、project 项目/大纲、knowledge 知识库、books 拆书、characters 角色、tasks 任务、logs 日志、models 模型调用、export 导出、import_novel 导入小说。',
      },
    },
    required: ['module'],
  },
  requiresConfirmation: false,
  isReadOnly: false,
  execute: async (args) => {
    const module = args.module as ModuleId
    const layout = useLayoutStore.getState()

    switch (module) {
      case 'settings':
        layout.openSettings()
        break
      case 'project':
        useLayoutStore.setState({ sidebarView: 'project', sidebarOpen: true })
        break
      case 'knowledge':
        useLayoutStore.setState({ sidebarView: 'knowledge', sidebarOpen: true })
        break
      case 'books':
        useLayoutStore.setState({ sidebarView: 'books', sidebarOpen: true })
        break
      case 'characters':
        useLayoutStore.setState({ sidebarView: 'characters', sidebarOpen: true })
        break
      case 'tasks':
        layout.openBottomTab('tasks')
        break
      case 'logs':
        layout.openBottomTab('log')
        break
      case 'models':
        layout.openBottomTab('models')
        break
      case 'export':
        layout.openExport()
        break
      case 'import_novel':
        layout.openImportNovel()
        break
      default:
        return { success: false, content: '', error: `未知模块：${String(module)}` }
    }

    return { success: true, content: `已打开模块：${module}` }
  },
})
