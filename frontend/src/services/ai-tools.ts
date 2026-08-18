import {
  createComponent,
  deleteComponent,
  deleteComponentMethod,
  getComponent,
  getComponentLifecycle,
  listComponentMethods,
  listComponents,
  renameComponent,
  saveComponentConfig,
  saveComponentData,
  saveComponentLifecycle,
  saveComponentMethod,
  saveComponentXml,
} from '../api/components'
import {
  copyPage,
  createPage,
  deletePage,
  deletePageMethod,
  getPage,
  getPageLifecycle,
  listPageMethods,
  listPages,
  savePageConfig,
  savePageData,
  savePageLifecycle,
  savePageMethod,
  savePageXml,
} from '../api/pages'
import {
  getColorPalette,
  getDataTypeLibrary,
  getIconLibrary,
  setProjectEntryPage,
} from '../api/projects'
import type { PageData } from '../types/page-data'
import { normalizeAiDataField } from '../types/page-data'
import {
  appendComponent,
  appendWidget,
  moveWidget,
  removeWidget,
  setNodeAttributes,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import {
  executePlatformAiTool,
  PLATFORM_AI_TOOL_CATALOG,
} from './ai-tools-platform'
import {
  parseFrontendTestCases,
  runFrontendTestsForAi,
} from './ai-frontend-debug'
import {
  buildWidgetTreeForAi,
  ensureSensibleWidgetAttrs,
  getWidgetDetailForAi,
  normalizeWidgetAttrsForAi,
} from './ai-widget-view'
import {
  findLayoutNode,
} from './page-preview-session'
import {
  getLastCanvasPreviewSnapshot,
  requireCanvasPreviewCommand,
} from './canvas-preview-bridge'
import {
  parseWorkspaceNavigateCommand,
  requestWorkspaceNavigate,
  requestWorkspaceUiSnapshot,
} from './workspace-nav'
import { useAiAssistantStore } from '../stores/ai-assistant'

export type AiToolName = string

export type AiToolDef = {
  name: AiToolName
  label: string
  description: string
  argsHint: string
}

const WIDGET_TAGS = new Set<string>([
  'Text',
  'Button',
  'Input',
  'Image',
  'Icon',
  'LinearLayout',
  'RelativeLayout',
  'Swiper',
  'MultiWindow',
  'Modal',
  'Component',
  'Slot',
])

/** 前端工具清单（页面/组件等）。全栈平台工具见 PLATFORM_AI_TOOL_CATALOG。 */
const FRONTEND_AI_TOOL_CATALOG: AiToolDef[] = [
  {
    name: 'list_pages',
    label: '列出页面',
    description: '通过接口检索项目中全部页面摘要（id/name/title/是否入口）',
    argsHint: '{}',
  },
  {
    name: 'get_page',
    label: '读取页面',
    description:
      '通过接口获取页面详情：配置、数据池、紧凑界面树（含 nodeId 与已解析事件）。完整单节点属性请再用 get_widget',
    argsHint: '{ "pageId": "home" }',
  },
  {
    name: 'get_widget',
    label: '读取控件详情',
    description:
      '通过接口读取页面/组件中单个节点的完整属性与事件绑定（含误用 click 等无效事件提示）',
    argsHint:
      '{ "scope": "page", "id": "home", "nodeId": "0:LinearLayout/1:Button" }',
  },
  {
    name: 'create_page',
    label: '创建页面',
    description: '通过接口创建空白页面',
    argsHint: '{ "id": "OrderList", "name": "订单列表", "title": "订单列表" }',
  },
  {
    name: 'copy_page',
    label: '复制页面',
    description: '通过接口从已有页面复制为新 id',
    argsHint: '{ "pageId": "home", "newId": "OrderList2", "name": "订单列表2" }',
  },
  {
    name: 'delete_page',
    label: '删除页面',
    description: '通过接口删除整个页面',
    argsHint: '{ "pageId": "OrderList" }',
  },
  {
    name: 'save_page_config',
    label: '保存页面配置',
    description: '通过接口保存名称/标题/状态栏/queryParams 等',
    argsHint: '{ "pageId": "home", "name": "首页", "title": "首页" }',
  },
  {
    name: 'add_widget',
    label: '添加控件',
    description:
      '添加单个控件。要一次加多个或带子节点时请用 add_widgets（一次保存）。未写 height 默认 wrap_content；禁止 height=0。parentNodeId 为空则挂到根布局。事件：onClick/onLongClick/onTouchStart/onTouchMove/onTouchEnd；滚动容器另有 onScroll/onScrollToLower/onScrollToUpper。值为 JSON：[{"id":"bind_1","method":"clear","args":{}}]。Button 按压：pressFeedback=none|scale|ripple|rippleScale，波纹色 pressRippleColor',
    argsHint:
      '{ "scope": "page", "id": "home", "parentNodeId": "0:LinearLayout", "tag": "Button", "attrs": { "text": "提交", "width": "match_parent", "height": "44", "background": "#409eff", "textColor": "#ffffff", "onClick": "[{\\"id\\":\\"bind_1\\",\\"method\\":\\"submit\\",\\"args\\":{}}]" } }',
  },
  {
    name: 'add_widgets',
    label: '批量添加控件',
    description:
      '一次在同一父节点下批量添加多个控件（可嵌套 children），只读盘/写盘一次。优先于多次 add_widget。整块 UI（九宫格/多行/整段表单）应一次写完，禁止拆成每次 2～3 个；含嵌套合计最多约 80。未写 height 默认 wrap_content；禁止 height=0。widgets 为树：每项含 tag、可选 attrs/slot/children。返回 created（含各 nodeId）与最新 tree；之后旧 nodeId 作废请用返回 tree',
    argsHint:
      '{ "scope": "page", "id": "home", "parentNodeId": "0:LinearLayout", "widgets": [ { "tag": "LinearLayout", "attrs": { "orientation": "vertical", "width": "match_parent", "height": "wrap_content" }, "children": [ { "tag": "LinearLayout", "attrs": { "orientation": "horizontal", "width": "match_parent", "height": "wrap_content" }, "children": [ { "tag": "Button", "attrs": { "text": "1", "width": "match_parent", "weight": "1", "height": "48" } }, { "tag": "Button", "attrs": { "text": "2", "width": "match_parent", "weight": "1", "height": "48" } }, { "tag": "Button", "attrs": { "text": "3", "width": "match_parent", "weight": "1", "height": "48" } } ] }, { "tag": "LinearLayout", "attrs": { "orientation": "horizontal", "width": "match_parent", "height": "wrap_content" }, "children": [ { "tag": "Button", "attrs": { "text": "4", "width": "match_parent", "weight": "1", "height": "48" } }, { "tag": "Button", "attrs": { "text": "5", "width": "match_parent", "weight": "1", "height": "48" } }, { "tag": "Button", "attrs": { "text": "6", "width": "match_parent", "weight": "1", "height": "48" } } ] } ] } ] }',
  },
  {
    name: 'update_widget_attrs',
    label: '修改控件属性',
    description:
      '通过接口更新指定节点属性；值为空字符串表示删除该属性。事件用 onClick/onTouch*/onScroll* 等。禁止 width=0 / height=0；未写高度视为 wrap_content。背景用 background（不是 backgroundColor）；注意对比度。dynamicStyles 须为 {"states":[...]}；按压反馈 pressFeedback=none|scale|ripple|rippleScale，波纹色 pressRippleColor',
    argsHint:
      '{ "scope": "page", "id": "home", "nodeId": "0:LinearLayout/1:Button", "attrs": { "text": "确定", "width": "match_parent", "height": "44", "background": "#409eff", "textColor": "#ffffff" } }',
  },
  {
    name: 'remove_widget',
    label: '删除控件',
    description:
      '删除指定节点（根不可删）。成功返回最新 tree；删后旧 nodeId 全部作废，必须用返回 tree',
    argsHint:
      '{ "scope": "page", "id": "home", "nodeId": "0:LinearLayout/1:Button" }',
  },
  {
    name: 'move_widget',
    label: '移动控件',
    description: '通过接口移动节点：position 为 before/after/inner',
    argsHint:
      '{ "scope": "page", "id": "home", "nodeId": "0:LinearLayout/1:Button", "targetNodeId": "0:LinearLayout/0:Text", "position": "after" }',
  },
  {
    name: 'insert_component_ref',
    label: '插入组件实例',
    description: '通过接口在页面/组件中插入组件引用节点',
    argsHint:
      '{ "scope": "page", "id": "home", "parentNodeId": "0:LinearLayout", "componentId": "OrderCard", "name": "订单卡片" }',
  },
  {
    name: 'upsert_data_field',
    label: '新增或更新数据字段',
    description:
      '通过接口按字段名新增或更新数据池字段。array/json 的 value 必须是真实数组/对象（禁止 JSON 字符串）；number/boolean 用数字/布尔；computed 须同时给 computeBody',
    argsHint:
      '{ "scope": "page", "id": "home", "field": { "name": "prizes", "type": "array", "itemType": "json", "remark": "奖品", "value": [{"emoji":"🍎","name":"苹果"}] } }',
  },
  {
    name: 'delete_data_field',
    label: '删除数据字段',
    description: '通过接口按字段名删除数据池字段',
    argsHint: '{ "scope": "page", "id": "home", "name": "title" }',
  },
  {
    name: 'list_page_methods',
    label: '列出页面方法',
    description: '通过接口列出页面全部方法（含预置；含 body 摘要）',
    argsHint: '{ "pageId": "home" }',
  },
  {
    name: 'get_page_method',
    label: '读取页面方法',
    description: '通过接口读取单个页面方法的完整定义（含 body）',
    argsHint: '{ "pageId": "home", "name": "clear" }',
  },
  {
    name: 'save_page_method',
    label: '保存页面方法',
    description:
      '创建或更新方法。body 只写方法体：读字段用名字，写字段用 setData(\'field\', value) 两参数；禁止 setData({prop,value})。可用 setTimeout/clearTimeout',
    argsHint:
      '{ "pageId": "home", "method": { "name": "clear", "params": [], "returnType": "void", "body": "setData(\'display\', \'0\')" }, "previousName": "" }',
  },
  {
    name: 'delete_page_method',
    label: '删除页面方法',
    description: '通过接口删除自定义方法',
    argsHint: '{ "pageId": "home", "name": "load" }',
  },
  {
    name: 'get_page_lifecycle',
    label: '读取页面生命周期',
    description: '通过接口读取页面生命周期绑定',
    argsHint: '{ "pageId": "home" }',
  },
  {
    name: 'save_page_lifecycle',
    label: '保存页面生命周期',
    description: '通过接口保存页面生命周期绑定',
    argsHint: '{ "pageId": "home", "lifecycle": { "onMounted": "..." } }',
  },
  {
    name: 'list_components',
    label: '列出组件',
    description: '通过接口检索项目中全部组件摘要',
    argsHint: '{}',
  },
  {
    name: 'get_component',
    label: '读取组件',
    description:
      '通过接口获取组件详情：配置、数据池、紧凑界面树（含 nodeId 与事件）。单节点完整属性请用 get_widget',
    argsHint: '{ "componentId": "SpecBar" }',
  },
  {
    name: 'create_component',
    label: '创建组件',
    description: '通过接口创建空白组件',
    argsHint: '{ "id": "OrderCard", "name": "订单卡片", "title": "订单卡片" }',
  },
  {
    name: 'rename_component',
    label: '重命名组件',
    description: '通过接口重命名组件 id，并更新引用',
    argsHint: '{ "componentId": "Old", "newId": "New", "name": "新名称" }',
  },
  {
    name: 'delete_component',
    label: '删除组件',
    description: '通过接口删除整个组件',
    argsHint: '{ "componentId": "OrderCard" }',
  },
  {
    name: 'save_component_config',
    label: '保存组件配置',
    description: '通过接口保存 props/events/exposedMethods 等配置',
    argsHint: '{ "componentId": "OrderCard", "config": { ... } }',
  },
  {
    name: 'list_component_methods',
    label: '列出组件方法',
    description: '通过接口列出组件方法（含 body 摘要）',
    argsHint: '{ "componentId": "OrderCard" }',
  },
  {
    name: 'get_component_method',
    label: '读取组件方法',
    description: '通过接口读取单个组件方法的完整定义（含 body）',
    argsHint: '{ "componentId": "OrderCard", "name": "refresh" }',
  },
  {
    name: 'save_component_method',
    label: '保存组件方法',
    description:
      '创建或更新组件方法。body 语法同页面：setData(\'field\', value)；可用 updateProps / emit / $props',
    argsHint:
      '{ "componentId": "Pager", "method": { "name": "reset", "params": [], "returnType": "void", "body": "setData(\'hasNext\', true)" } }',
  },
  {
    name: 'delete_component_method',
    label: '删除组件方法',
    description: '通过接口删除组件自定义方法',
    argsHint: '{ "componentId": "OrderCard", "name": "refresh" }',
  },
  {
    name: 'get_component_lifecycle',
    label: '读取组件生命周期',
    description: '通过接口读取组件生命周期绑定',
    argsHint: '{ "componentId": "OrderCard" }',
  },
  {
    name: 'save_component_lifecycle',
    label: '保存组件生命周期',
    description: '通过接口保存组件生命周期绑定',
    argsHint: '{ "componentId": "OrderCard", "lifecycle": {} }',
  },
  {
    name: 'get_icon_library',
    label: '读取图标库',
    description: '通过接口查看可用图标；增删改请用 upsert_icon / delete_icon',
    argsHint: '{}',
  },
  {
    name: 'get_color_palette',
    label: '读取调色板',
    description: '通过接口查看主题色；增删改请用 upsert_palette_color / delete_palette_color',
    argsHint: '{}',
  },
  {
    name: 'get_data_type_library',
    label: '读取类型库',
    description:
      '通过接口查看完整类型库；摘要用 list_data_types，增删改用 upsert_data_type* / delete_data_type*',
    argsHint: '{}',
  },
  {
    name: 'set_project_entry_page',
    label: '设置入口页',
    description: '通过接口设置或清除项目入口页面',
    argsHint: '{ "pageId": "home" }',
  },
  {
    name: 'preview_page',
    label: '打开真实预览',
    description:
      '在主工作区打开页面/组件预览画布（用户可见）。返回 layoutRisks / viewportOverflow（是否超出屏幕）。后续 simulate_event / assert / run_frontend_tests 均驱动此画布',
    argsHint: '{ "pageId": "test" } 或 { "componentId": "OrderCard", "query": { "id": "1" } }',
  },
  {
    name: 'simulate_event',
    label: '模拟控件事件',
    description: '在真实预览画布上触发节点 onClick 等（等同用户点击）',
    argsHint:
      '{ "nodeId": "0:LinearLayout/1:LinearLayout/0:Button", "eventKey": "onClick" }  // 亦可 onTouchStart / onTouchEnd 等',
  },
  {
    name: 'set_preview_data',
    label: '设置预览数据',
    description: '在真实预览画布数据池写入字段并重算 computed',
    argsHint: '{ "field": "display", "value": "0" }',
  },
  {
    name: 'run_page_method',
    label: '运行页面方法',
    description: '在真实预览画布上直接调用自定义方法',
    argsHint: '{ "name": "inputDigit", "args": { "digit": "7" } }',
  },
  {
    name: 'get_preview_state',
    label: '读取预览状态',
    description:
      '读取真实预览画布数据池、toast/logs、layoutRisks、viewportOverflow；includeLayout=true 时附带布局树。生成 UI 后必须检查是否溢出屏幕',
    argsHint: '{ "includeLayout": true }',
  },
  {
    name: 'assert_preview',
    label: '断言预览状态',
    description:
      '对真实预览画布断言：field+equals/contains，或 nodeId+visible/textEquals/textContains，或 nodeId+background/textColor',
    argsHint:
      '{ "field": "display", "equals": "7" } 或 { "nodeId": "...", "background": "#555555", "visible": true }',
  },
  {
    name: 'run_frontend_tests',
    label: '运行前端测试套件',
    description:
      '在真实预览画布上批量跑用例。steps 支持 wait(ms≤8000)、assertStyle。click/runMethod 报错则失败；禁止 setData 后直接 assert 同一字段。需主编辑器窗口已打开',
    argsHint:
      '{ "pageId": "calculator", "cases": [{ "name": "按压样式", "steps": [{ "op": "reset", "pageId": "calculator" }, { "op": "setData", "field": "pressedKey", "value": "7" }, { "op": "assertStyle", "nodeId": "0:LinearLayout/3:LinearLayout/0:Button", "background": "#555555" }, { "op": "wait", "ms": 200 }] }] }',
  },
  {
    name: 'get_workspace_ui',
    label: '读取编辑器 UI 状态',
    description:
      '读取主工作区当前左侧活动栏、底部模式、打开的页面/组件、选中节点、属性页、后端层等',
    argsHint: '{}',
  },
  {
    name: 'switch_workspace_nav',
    label: '切换左侧活动栏',
    description:
      '切换主工作区左侧：frontend / backend / datatypes / mysql / oss / icons / palette',
    argsHint: '{ "topNav": "frontend" }',
  },
  {
    name: 'switch_workspace_mode',
    label: '切换前端底部模式',
    description: '切换预览/编辑/数据池/方法/生命周期（会切到前端活动栏）',
    argsHint: '{ "mode": "edit" }',
  },
  {
    name: 'open_editor_resource',
    label: '打开页面或组件',
    description: '在主工作区打开指定页面/组件，可选同时切换 mode',
    argsHint:
      '{ "scope": "page", "id": "calculator", "mode": "edit" }',
  },
  {
    name: 'select_widget',
    label: '选中控件',
    description: '打开资源并选中 nodeId（必要时切到编辑模式）',
    argsHint:
      '{ "scope": "page", "resourceId": "calculator", "nodeId": "0:LinearLayout/1:Button" }',
  },
  {
    name: 'focus_props_tab',
    label: '切换属性页签',
    description: '属性面板 style / event / dynamic（会切到编辑模式）',
    argsHint: '{ "tab": "event" }',
  },
  {
    name: 'open_backend_workspace',
    label: '打开后端工作区',
    description: '切到后端并选中服务/层/控制器或处理器方法',
    argsHint:
      '{ "serviceId": "order", "layer": "data", "processorId": "...", "methodId": "page" }',
  },
  {
    name: 'reveal_in_editor',
    label: '在编辑器中定位',
    description:
      '一站式导航：活动栏+模式+资源+节点+属性页。改完界面后建议调用让用户看到结果',
    argsHint:
      '{ "scope": "page", "resourceId": "calculator", "mode": "edit", "nodeId": "0:LinearLayout/0:Button", "propsTab": "event" }',
  },
  {
    name: 'set_canvas_scene',
    label: '切换画布场景',
    description: '画布预览设备：h5 或 miniprogram',
    argsHint: '{ "scene": "h5" }',
  },
]

/** 提供给 AI 的全部可调用操作（前端 + 全栈平台）。 */
export const AI_TOOL_CATALOG: AiToolDef[] = [
  ...FRONTEND_AI_TOOL_CATALOG,
  ...PLATFORM_AI_TOOL_CATALOG,
]

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少参数 ${key}`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串`)
  return value.trim()
}

function requireObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`参数 ${key} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function requireScope(args: Record<string, unknown>): 'page' | 'component' {
  const scope = requireString(args, 'scope')
  if (scope !== 'page' && scope !== 'component') {
    throw new Error('scope 必须是 page 或 component')
  }
  return scope
}

function requireWidgetTag(args: Record<string, unknown>): WidgetTag {
  const tag = requireString(args, 'tag')
  if (!WIDGET_TAGS.has(tag)) {
    throw new Error(`不支持的控件 tag：${tag}`)
  }
  return tag as WidgetTag
}

function requireAttrs(args: Record<string, unknown>): Record<string, string> {
  const raw = requireObject(args, 'attrs')
  const attrs: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      attrs[key] = ''
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attrs[key] = String(value)
      continue
    }
    // 允许事件绑定直接传数组/对象，写入前再规范化
    if (typeof value === 'object') {
      attrs[key] = JSON.stringify(value)
      continue
    }
    throw new Error(`属性 ${key} 必须是字符串/数字/布尔/对象/数组`)
  }
  return normalizeWidgetAttrsForAi(attrs)
}

/** 解析 attrs，并按控件 tag 补齐合理宽高 */
function requireAttrsForTag(
  args: Record<string, unknown>,
  tag?: string,
  fillDefaults = true,
): Record<string, string> {
  return ensureSensibleWidgetAttrs(requireAttrs(args), tag, { fillDefaults })
}

function optionalAttrsForTag(
  args: Record<string, unknown>,
  tag?: string,
  fillDefaults = true,
): Record<string, string> | undefined {
  if (args.attrs == null) return undefined
  return requireAttrsForTag(args, tag, fillDefaults)
}

type AiWidgetSpec = {
  tag: WidgetTag
  attrs: Record<string, string>
  slot?: string
  children?: AiWidgetSpec[]
}

type AiCreatedWidget = {
  tag: string
  nodeId: string
  children?: AiCreatedWidget[]
}

const MAX_BATCH_WIDGETS = 80

function countWidgetSpecs(specs: AiWidgetSpec[]): number {
  let n = 0
  for (const spec of specs) {
    n += 1
    if (spec.children?.length) n += countWidgetSpecs(spec.children)
  }
  return n
}

function parseWidgetSpec(raw: unknown, path: string): AiWidgetSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${path} 必须是对象`)
  }
  const row = raw as Record<string, unknown>
  const tag = requireWidgetTag(row)
  const attrs =
    optionalAttrsForTag(row, tag) ?? ensureSensibleWidgetAttrs({}, tag)
  const slot = optionalString(row, 'slot')
  let children: AiWidgetSpec[] | undefined
  if (row.children != null) {
    if (!Array.isArray(row.children)) {
      throw new Error(`${path}.children 必须是数组`)
    }
    children = row.children.map((item, i) =>
      parseWidgetSpec(item, `${path}.children[${i}]`),
    )
  }
  return {
    tag,
    attrs,
    ...(slot ? { slot } : {}),
    ...(children?.length ? { children } : {}),
  }
}

function requireWidgetSpecs(args: Record<string, unknown>): AiWidgetSpec[] {
  const raw = args.widgets
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('widgets 必须是非空数组')
  }
  const specs = raw.map((item, i) => parseWidgetSpec(item, `widgets[${i}]`))
  const total = countWidgetSpecs(specs)
  if (total > MAX_BATCH_WIDGETS) {
    throw new Error(
      `单次最多添加 ${MAX_BATCH_WIDGETS} 个控件（含嵌套），当前 ${total}`,
    )
  }
  return specs
}

/** 在同一父节点下按序追加控件树（内存中改 XML，不落盘） */
function appendWidgetSpecs(
  xml: string,
  parentNodeId: string,
  specs: AiWidgetSpec[],
  options: { allowRootSiblings: boolean },
): { xml: string; created: AiCreatedWidget[] } {
  let current = xml
  const created: AiCreatedWidget[] = []
  for (const spec of specs) {
    let next = appendWidget(current, parentNodeId, spec.tag, {
      allowRootSiblings: options.allowRootSiblings,
      slot: spec.slot,
    })
    if (Object.keys(spec.attrs).length) {
      const patched = setNodeAttributes(next.xml, next.newNodeId, spec.attrs)
      next = { xml: patched, newNodeId: next.newNodeId }
    }
    current = next.xml
    let childCreated: AiCreatedWidget[] | undefined
    if (spec.children?.length) {
      const nested = appendWidgetSpecs(current, next.newNodeId, spec.children, options)
      current = nested.xml
      childCreated = nested.created
    }
    created.push({
      tag: spec.tag,
      nodeId: next.newNodeId,
      ...(childCreated?.length ? { children: childCreated } : {}),
    })
  }
  return { xml: current, created }
}

function summarizeMethodList(
  methods: Array<{
    name: string
    params?: unknown
    returnType?: string
    body?: string
    builtin?: boolean
  }>,
): string {
  return summarize(
    methods.map((m) => ({
      name: m.name,
      params: m.params,
      returnType: m.returnType,
      builtin: m.builtin,
      body:
        typeof m.body === 'string' && m.body.length > 800
          ? `${m.body.slice(0, 800)}\n…(body 已截断，用 get_page_method / get_component_method 取全文)`
          : m.body ?? '',
    })),
    24000,
  )
}

function summarizePageOrComponentDetail(res: {
  id: string
  config?: unknown
  xml: string
  data?: unknown
}): string {
  const tree = buildWidgetTreeForAi(res.xml)
  return summarize(
    {
      id: res.id,
      config: res.config,
      data: res.data,
      tree,
      hint: '界面已返回紧凑 tree（含 nodeId/events）。单节点完整 attrs 请调用 get_widget；事件属性名：onClick/onLongClick/onTouchStart/onTouchMove/onTouchEnd，滚动容器另有 onScroll/onScrollToLower/onScrollToUpper，值为 [{"id","method","args"}]。',
    },
    48000,
  )
}

function requireMovePosition(args: Record<string, unknown>): MovePosition {
  const position = requireString(args, 'position')
  if (position !== 'before' && position !== 'after' && position !== 'inner') {
    throw new Error('position 必须是 before / after / inner')
  }
  return position
}

function normalizeDataField(raw: Record<string, unknown>) {
  return normalizeAiDataField(raw)
}

async function loadXmlResource(
  projectPath: string,
  scope: 'page' | 'component',
  id: string,
): Promise<{ xml: string }> {
  if (scope === 'page') {
    const res = await getPage(projectPath, id)
    return { xml: res.xml }
  }
  const res = await getComponent(projectPath, id)
  return { xml: res.xml }
}

async function persistXml(
  projectPath: string,
  scope: 'page' | 'component',
  id: string,
  xml: string,
): Promise<{ id: string; xml: string }> {
  if (scope === 'page') {
    return savePageXml({ projectPath, pageId: id, xml })
  }
  return saveComponentXml({ projectPath, componentId: id, xml })
}

async function loadDataResource(
  projectPath: string,
  scope: 'page' | 'component',
  id: string,
): Promise<PageData> {
  if (scope === 'page') {
    const res = await getPage(projectPath, id)
    return res.data ?? { fields: [] }
  }
  const res = await getComponent(projectPath, id)
  return res.data ?? { fields: [] }
}

async function persistData(
  projectPath: string,
  scope: 'page' | 'component',
  id: string,
  data: PageData,
): Promise<{ id: string; data: PageData }> {
  if (scope === 'page') {
    return savePageData({ projectPath, pageId: id, data })
  }
  return saveComponentData({ projectPath, componentId: id, data })
}

function summarize(data: unknown, max = 12000): string {
  try {
    const text = JSON.stringify(data, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n…(已截断，共 ${text.length} 字符；请用更细粒度工具如 get_widget / get_page_method 继续读取)`
  } catch {
    return String(data)
  }
}

export function toolLabel(name: string, fallback?: string): string {
  const hit = AI_TOOL_CATALOG.find((item) => item.name === name)
  return hit?.label || fallback || name
}

export async function executeAiTool(options: {
  projectPath: string
  tool: string
  args?: Record<string, unknown>
}): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const args = options.args ?? {}
  const projectPath = options.projectPath
  try {
    switch (options.tool as AiToolName) {
      case 'list_pages': {
        const res = await listPages(projectPath)
        return { ok: true, result: summarize(res.pages) }
      }
      case 'get_page': {
        const pageId = requireString(args, 'pageId')
        const res = await getPage(projectPath, pageId)
        return { ok: true, result: summarizePageOrComponentDetail(res) }
      }
      case 'get_widget': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const nodeId = requireString(args, 'nodeId')
        const { xml } = await loadXmlResource(projectPath, scope, id)
        const detail = getWidgetDetailForAi(xml, nodeId)
        return { ok: true, result: summarize(detail, 24000) }
      }
      case 'create_page': {
        const id = requireString(args, 'id')
        const name = requireString(args, 'name')
        const res = await createPage({
          projectPath,
          id,
          name,
          title: optionalString(args, 'title'),
        })
        return { ok: true, result: summarize({ id: res.id, name: res.config.name }) }
      }
      case 'copy_page': {
        const pageId = requireString(args, 'pageId')
        const newId = requireString(args, 'newId')
        const res = await copyPage({
          projectPath,
          pageId,
          newId,
          name: optionalString(args, 'name'),
          title: optionalString(args, 'title'),
        })
        return { ok: true, result: summarize({ id: res.id, name: res.config.name }) }
      }
      case 'delete_page': {
        const pageId = requireString(args, 'pageId')
        const res = await deletePage({ projectPath, pageId })
        return { ok: true, result: summarize(res) }
      }
      case 'save_page_config': {
        const pageId = requireString(args, 'pageId')
        const name = requireString(args, 'name')
        const res = await savePageConfig({
          projectPath,
          pageId,
          name,
          title: optionalString(args, 'title'),
          statusBar: args.statusBar as never,
          queryParams: args.queryParams as never,
          debugQuery: args.debugQuery as never,
        })
        return { ok: true, result: summarize({ id: res.id, config: res.config }) }
      }
      case 'add_widget': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const tag = requireWidgetTag(args)
        const parentNodeId = optionalString(args, 'parentNodeId') ?? ''
        // 未传 attrs 时也补 Button 等默认宽高，避免只有平台占位尺寸
        const attrs = optionalAttrsForTag(args, tag) ??
          ensureSensibleWidgetAttrs({}, tag)
        const { xml } = await loadXmlResource(projectPath, scope, id)
        let next = appendWidget(xml, parentNodeId, tag, {
          allowRootSiblings: scope === 'component',
          slot: optionalString(args, 'slot'),
        })
        if (Object.keys(attrs).length) {
          const patched = setNodeAttributes(next.xml, next.newNodeId, attrs)
          next = { xml: patched, newNodeId: next.newNodeId }
        }
        const saved = await persistXml(projectPath, scope, id, next.xml)
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            tag,
            nodeId: next.newNodeId,
            attrs,
          }),
        }
      }
      case 'add_widgets': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const parentNodeId = optionalString(args, 'parentNodeId') ?? ''
        const widgets = requireWidgetSpecs(args)
        const { xml } = await loadXmlResource(projectPath, scope, id)
        const next = appendWidgetSpecs(xml, parentNodeId, widgets, {
          allowRootSiblings: scope === 'component',
        })
        const saved = await persistXml(projectPath, scope, id, next.xml)
        const tree = buildWidgetTreeForAi(saved.xml)
        return {
          ok: true,
          result: summarize(
            {
              scope,
              id: saved.id,
              parentNodeId: parentNodeId || null,
              added: countWidgetSpecs(widgets),
              created: next.created,
              tree,
              hint: '已批量写入；后续请用返回的 tree / created.nodeId，旧路径作废',
            },
            48000,
          ),
        }
      }
      case 'update_widget_attrs': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const nodeId = requireString(args, 'nodeId')
        const tagFromId = nodeId.includes(':')
          ? nodeId.slice(nodeId.lastIndexOf(':') + 1)
          : undefined
        const attrs = requireAttrsForTag(args, tagFromId, false)
        const { xml } = await loadXmlResource(projectPath, scope, id)
        const nextXml = setNodeAttributes(xml, nodeId, attrs)
        const saved = await persistXml(projectPath, scope, id, nextXml)
        return {
          ok: true,
          result: summarize({ scope, id: saved.id, nodeId, attrs }),
        }
      }
      case 'remove_widget': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const nodeId = requireString(args, 'nodeId')
        const { xml } = await loadXmlResource(projectPath, scope, id)
        let next: { xml: string; parentId: string }
        try {
          next = removeWidget(xml, nodeId)
        } catch (err) {
          const tree = buildWidgetTreeForAi(xml)
          throw new Error(
            `${err instanceof Error ? err.message : String(err)}\n当前树（请用其中的 nodeId）：\n${summarize(tree, 24000)}`,
          )
        }
        const saved = await persistXml(projectPath, scope, id, next.xml)
        const tree = buildWidgetTreeForAi(saved.xml)
        return {
          ok: true,
          result: summarize(
            {
              scope,
              id: saved.id,
              removedNodeId: nodeId,
              parentId: next.parentId,
              tree,
              hint: 'nodeId 已失效的旧路径不可再用；后续操作请用返回的 tree',
            },
            48000,
          ),
        }
      }
      case 'move_widget': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const nodeId = requireString(args, 'nodeId')
        const targetNodeId = requireString(args, 'targetNodeId')
        const position = requireMovePosition(args)
        const { xml } = await loadXmlResource(projectPath, scope, id)
        const next = moveWidget(xml, nodeId, targetNodeId, position, {
          slot: optionalString(args, 'slot'),
        })
        const saved = await persistXml(projectPath, scope, id, next.xml)
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            nodeId: next.newNodeId,
            position,
            targetNodeId,
          }),
        }
      }
      case 'insert_component_ref': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const componentId = requireString(args, 'componentId')
        const parentNodeId = optionalString(args, 'parentNodeId') ?? ''
        const { xml } = await loadXmlResource(projectPath, scope, id)
        const next = appendComponent(xml, parentNodeId, {
          componentId,
          name: optionalString(args, 'name'),
          width: optionalString(args, 'width'),
          height: optionalString(args, 'height'),
          allowRootSiblings: scope === 'component',
          slot: optionalString(args, 'slot'),
        })
        const saved = await persistXml(projectPath, scope, id, next.xml)
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            componentId,
            nodeId: next.newNodeId,
          }),
        }
      }
      case 'upsert_data_field': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const field = normalizeDataField(requireObject(args, 'field'))
        const data = await loadDataResource(projectPath, scope, id)
        const fields = [...(data.fields ?? [])]
        const index = fields.findIndex((item) => item.name === field.name)
        if (index >= 0) fields[index] = { ...fields[index], ...field }
        else fields.push(field)
        const saved = await persistData(projectPath, scope, id, { fields })
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            field: field.name,
            fieldCount: saved.data.fields?.length ?? 0,
            action: index >= 0 ? 'updated' : 'created',
          }),
        }
      }
      case 'delete_data_field': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const name = requireString(args, 'name')
        const data = await loadDataResource(projectPath, scope, id)
        const before = data.fields?.length ?? 0
        const fields = (data.fields ?? []).filter((item) => item.name !== name)
        if (fields.length === before) {
          throw new Error(`未找到数据字段：${name}`)
        }
        const saved = await persistData(projectPath, scope, id, { fields })
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            removed: name,
            fieldCount: saved.data.fields?.length ?? 0,
          }),
        }
      }
      case 'list_page_methods': {
        const pageId = requireString(args, 'pageId')
        const res = await listPageMethods(projectPath, pageId)
        return { ok: true, result: summarizeMethodList(res.methods) }
      }
      case 'get_page_method': {
        const pageId = requireString(args, 'pageId')
        const name = requireString(args, 'name')
        const res = await listPageMethods(projectPath, pageId)
        const method = res.methods.find((m) => m.name === name)
        if (!method) throw new Error(`未找到方法：${name}`)
        return { ok: true, result: summarize(method, 24000) }
      }
      case 'save_page_method': {
        const pageId = requireString(args, 'pageId')
        const method = requireObject(args, 'method') as never
        const res = await savePageMethod({
          projectPath,
          pageId,
          method,
          previousName: optionalString(args, 'previousName'),
        })
        return { ok: true, result: summarize(res.method) }
      }
      case 'delete_page_method': {
        const pageId = requireString(args, 'pageId')
        const name = requireString(args, 'name')
        const res = await deletePageMethod({ projectPath, pageId, name })
        return { ok: true, result: summarize(res) }
      }
      case 'get_page_lifecycle': {
        const pageId = requireString(args, 'pageId')
        const res = await getPageLifecycle(projectPath, pageId)
        return { ok: true, result: summarize(res.lifecycle) }
      }
      case 'save_page_lifecycle': {
        const pageId = requireString(args, 'pageId')
        const lifecycle = requireObject(args, 'lifecycle') as never
        const res = await savePageLifecycle({ projectPath, pageId, lifecycle })
        return { ok: true, result: summarize(res.lifecycle) }
      }
      case 'list_components': {
        const res = await listComponents(projectPath)
        return { ok: true, result: summarize(res.components) }
      }
      case 'get_component': {
        const componentId = requireString(args, 'componentId')
        const res = await getComponent(projectPath, componentId)
        return { ok: true, result: summarizePageOrComponentDetail(res) }
      }
      case 'create_component': {
        const id = requireString(args, 'id')
        const name = requireString(args, 'name')
        const res = await createComponent({
          projectPath,
          id,
          name,
          title: optionalString(args, 'title'),
        })
        return { ok: true, result: summarize({ id: res.id, name: res.config.name }) }
      }
      case 'rename_component': {
        const componentId = requireString(args, 'componentId')
        const newId = requireString(args, 'newId')
        const res = await renameComponent({
          projectPath,
          componentId,
          newId,
          name: optionalString(args, 'name'),
        })
        return { ok: true, result: summarize(res) }
      }
      case 'delete_component': {
        const componentId = requireString(args, 'componentId')
        const res = await deleteComponent({ projectPath, componentId })
        return { ok: true, result: summarize(res) }
      }
      case 'save_component_config': {
        const componentId = requireString(args, 'componentId')
        const config = requireObject(args, 'config') as never
        const res = await saveComponentConfig({ projectPath, componentId, config })
        return { ok: true, result: summarize({ id: res.id, config: res.config }) }
      }
      case 'list_component_methods': {
        const componentId = requireString(args, 'componentId')
        const res = await listComponentMethods(projectPath, componentId)
        return { ok: true, result: summarizeMethodList(res.methods) }
      }
      case 'get_component_method': {
        const componentId = requireString(args, 'componentId')
        const name = requireString(args, 'name')
        const res = await listComponentMethods(projectPath, componentId)
        const method = res.methods.find((m) => m.name === name)
        if (!method) throw new Error(`未找到方法：${name}`)
        return { ok: true, result: summarize(method, 24000) }
      }
      case 'save_component_method': {
        const componentId = requireString(args, 'componentId')
        const method = requireObject(args, 'method') as never
        const res = await saveComponentMethod({
          projectPath,
          componentId,
          method,
          previousName: optionalString(args, 'previousName'),
        })
        return { ok: true, result: summarize(res.method) }
      }
      case 'delete_component_method': {
        const componentId = requireString(args, 'componentId')
        const name = requireString(args, 'name')
        const res = await deleteComponentMethod({ projectPath, componentId, name })
        return { ok: true, result: summarize(res) }
      }
      case 'get_component_lifecycle': {
        const componentId = requireString(args, 'componentId')
        const res = await getComponentLifecycle(projectPath, componentId)
        return { ok: true, result: summarize(res.lifecycle) }
      }
      case 'save_component_lifecycle': {
        const componentId = requireString(args, 'componentId')
        const lifecycle = requireObject(args, 'lifecycle') as never
        const res = await saveComponentLifecycle({
          projectPath,
          componentId,
          lifecycle,
        })
        return { ok: true, result: summarize(res.lifecycle) }
      }
      case 'get_icon_library': {
        const res = await getIconLibrary(projectPath)
        return { ok: true, result: summarize(res) }
      }
      case 'get_color_palette': {
        const res = await getColorPalette(projectPath)
        return { ok: true, result: summarize(res) }
      }
      case 'get_data_type_library': {
        const res = await getDataTypeLibrary(projectPath)
        return { ok: true, result: summarize(res) }
      }
      case 'set_project_entry_page': {
        const pageId = args.pageId == null ? null : requireString(args, 'pageId')
        const res = await setProjectEntryPage({ projectPath, pageId })
        return { ok: true, result: summarize(res) }
      }
      case 'get_workspace_ui': {
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceUiSnapshot({
          projectPath,
          requestLocalRefresh: (requestId) => store.requestUiQuery(requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'switch_workspace_nav': {
        const command = parseWorkspaceNavigateCommand('switchNav', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'switch_workspace_mode': {
        const command = parseWorkspaceNavigateCommand('switchMode', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'open_editor_resource': {
        const command = parseWorkspaceNavigateCommand('openResource', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'select_widget': {
        const command = parseWorkspaceNavigateCommand('selectWidget', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'focus_props_tab': {
        const command = parseWorkspaceNavigateCommand('focusPropsTab', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'open_backend_workspace': {
        const command = parseWorkspaceNavigateCommand('openBackend', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'reveal_in_editor': {
        const command = parseWorkspaceNavigateCommand('reveal', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'set_canvas_scene': {
        const command = parseWorkspaceNavigateCommand('setCanvasScene', args)
        const store = useAiAssistantStore.getState()
        const snapshot = await requestWorkspaceNavigate({
          projectPath,
          command,
          enqueueLocal: (cmd, requestId) => store.requestNavigate(cmd, requestId),
        })
        return { ok: true, result: summarize(snapshot) }
      }
      case 'preview_page': {
        const pageId = optionalString(args, 'pageId')
        const componentId = optionalString(args, 'componentId')
        const query =
          args.query && typeof args.query === 'object' && !Array.isArray(args.query)
            ? (args.query as Record<string, unknown>)
            : undefined
        const store = useAiAssistantStore.getState()
        if (!pageId && !componentId) {
          throw new Error('preview_page 需要 pageId 或 componentId')
        }
        const snap = await requireCanvasPreviewCommand({
          projectPath,
          command: pageId
            ? { op: 'open', scope: 'page', id: pageId, query }
            : { op: 'open', scope: 'component', id: componentId! },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        return {
          ok: true,
          result: summarize(
            {
              state: {
                kind: snap.kind,
                id: snap.id,
                fields: snap.fields,
                toast: snap.toast,
                logs: snap.logs,
                layoutRisks: snap.layoutRisks ?? [],
              },
              layout: snap.layout,
              viewportOverflow: snap.viewportOverflow ?? null,
              hint:
                snap.viewportOverflow?.overflowing
                  ? `检测到屏幕溢出：${snap.viewportOverflow.hint}。请按溢出策略处理或 ask_user；layoutRisks 含详情。`
                  : '已打开主工作区真实预览；检查 layoutRisks / viewportOverflow。用 simulate_event / set_preview_data / assert_preview / run_frontend_tests 继续',
            },
            48000,
          ),
        }
      }
      case 'simulate_event': {
        const nodeId = requireString(args, 'nodeId')
        const eventKey = optionalString(args, 'eventKey')
        const scope =
          args.scope && typeof args.scope === 'object' && !Array.isArray(args.scope)
            ? (args.scope as { item?: unknown; index?: number })
            : undefined
        const eventArgs =
          args.eventArgs &&
          typeof args.eventArgs === 'object' &&
          !Array.isArray(args.eventArgs)
            ? (args.eventArgs as Record<string, unknown>)
            : undefined
        const store = useAiAssistantStore.getState()
        const payload = await requireCanvasPreviewCommand({
          projectPath,
          command: {
            op: 'click',
            nodeId,
            eventKey,
            scope,
            eventArgs,
          },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        return {
          ok: true,
          result: summarize(
            {
              eventKey: eventKey || 'onClick',
              nodeId,
              state: {
                kind: payload.kind,
                id: payload.id,
                fields: payload.fields,
                toast: payload.toast,
                logs: payload.logs,
              },
            },
            24000,
          ),
        }
      }
      case 'set_preview_data': {
        const field = requireString(args, 'field')
        if (!('value' in args)) throw new Error('缺少参数 value')
        const store = useAiAssistantStore.getState()
        const snap = await requireCanvasPreviewCommand({
          projectPath,
          command: { op: 'setData', field, value: args.value },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        return {
          ok: true,
          result: summarize(
            {
              kind: snap.kind,
              id: snap.id,
              fields: snap.fields,
              toast: snap.toast,
              logs: snap.logs,
            },
            24000,
          ),
        }
      }
      case 'run_page_method': {
        const name = requireString(args, 'name')
        const methodArgs =
          args.args && typeof args.args === 'object' && !Array.isArray(args.args)
            ? (args.args as Record<string, unknown>)
            : undefined
        const store = useAiAssistantStore.getState()
        const snap = await requireCanvasPreviewCommand({
          projectPath,
          command: { op: 'runMethod', name, args: methodArgs },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        return {
          ok: true,
          result: summarize(
            {
              kind: snap.kind,
              id: snap.id,
              fields: snap.fields,
              toast: snap.toast,
              logs: snap.logs,
            },
            24000,
          ),
        }
      }
      case 'get_preview_state': {
        const includeLayout = args.includeLayout === true
        const store = useAiAssistantStore.getState()
        const snap = await requireCanvasPreviewCommand({
          projectPath,
          command: { op: 'getState', includeLayout },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        const state = {
          kind: snap.kind,
          id: snap.id,
          fields: snap.fields,
          toast: snap.toast,
          logs: snap.logs,
          layoutRisks: snap.layoutRisks ?? [],
          viewportOverflow: snap.viewportOverflow ?? null,
        }
        return {
          ok: true,
          result: summarize(
            includeLayout
              ? {
                  state,
                  layout: snap.layout,
                  hint: snap.viewportOverflow?.overflowing
                    ? snap.viewportOverflow.hint
                    : undefined,
                }
              : state,
            48000,
          ),
        }
      }
      case 'assert_preview': {
        const store = useAiAssistantStore.getState()
        const needLayout = Boolean(
          optionalString(args, 'nodeId') ||
            args.background ||
            args.textColor ||
            args.containsBackground ||
            'visible' in args ||
            args.textEquals ||
            args.textContains,
        )
        const snap = await requireCanvasPreviewCommand({
          projectPath,
          command: { op: 'getState', includeLayout: needLayout },
          enqueueLocal: (cmd, requestId) =>
            store.requestCanvasPreview(cmd, requestId),
        })
        const state = {
          kind: snap.kind,
          id: snap.id,
          fields: snap.fields,
          toast: snap.toast,
          logs: snap.logs,
        }
        const field = optionalString(args, 'field')
        const nodeId = optionalString(args, 'nodeId')
        if (field) {
          const actual = state.fields[field]
          if ('equals' in args) {
            const expected = JSON.stringify(args.equals)
            const got = JSON.stringify(actual)
            if (expected !== got) {
              throw new Error(`字段 ${field} 期望 ${expected}，实际 ${got}`)
            }
          }
          if (typeof args.contains === 'string' && args.contains) {
            const text = JSON.stringify(actual) ?? ''
            if (!text.includes(args.contains)) {
              throw new Error(
                `字段 ${field} 不含「${args.contains}」，实际 ${text}`,
              )
            }
          }
          if (
            !('equals' in args) &&
            !(typeof args.contains === 'string' && args.contains)
          ) {
            throw new Error('assert_preview 指定 field 时需要 equals 或 contains')
          }
        }
        if (nodeId) {
          const layout =
            snap.layout ?? getLastCanvasPreviewSnapshot(projectPath)?.layout
          if (!layout) throw new Error('无布局快照')
          const node = findLayoutNode(layout, nodeId)
          if (!node) throw new Error(`未找到节点：${nodeId}`)
          if ('visible' in args) {
            const want = Boolean(args.visible)
            if (node.visible !== want) {
              throw new Error(
                `节点 ${nodeId} visible 期望 ${want}，实际 ${node.visible}`,
              )
            }
          }
          const text = node.text ?? ''
          if (typeof args.textEquals === 'string') {
            if (text !== args.textEquals) {
              throw new Error(
                `节点 ${nodeId} 文案期望「${args.textEquals}」，实际「${text}」`,
              )
            }
          }
          if (typeof args.textContains === 'string' && args.textContains) {
            if (!text.includes(args.textContains)) {
              throw new Error(
                `节点 ${nodeId} 文案不含「${args.textContains}」，实际「${text}」`,
              )
            }
          }
          const bg = (node.backgroundColor ?? '').trim().toLowerCase()
          if (typeof args.background === 'string' && args.background) {
            if (bg !== args.background.trim().toLowerCase()) {
              throw new Error(
                `节点 ${nodeId} background 期望「${args.background}」，实际「${node.backgroundColor ?? ''}」`,
              )
            }
          }
          if (
            typeof args.containsBackground === 'string' &&
            args.containsBackground
          ) {
            if (!bg.includes(args.containsBackground.trim().toLowerCase())) {
              throw new Error(
                `节点 ${nodeId} background 不含「${args.containsBackground}」，实际「${node.backgroundColor ?? ''}」`,
              )
            }
          }
          if (typeof args.textColor === 'string' && args.textColor) {
            const fg = (node.textColor ?? '').trim().toLowerCase()
            if (fg !== args.textColor.trim().toLowerCase()) {
              throw new Error(
                `节点 ${nodeId} textColor 期望「${args.textColor}」，实际「${node.textColor ?? ''}」`,
              )
            }
          }
        }
        if (!field && !nodeId) {
          throw new Error('assert_preview 需要 field 或 nodeId')
        }
        return {
          ok: true,
          result: summarize({ passed: true, state }, 24000),
        }
      }
      case 'run_frontend_tests': {
        const cases = parseFrontendTestCases(args.cases)
        const suite = await runFrontendTestsForAi({
          projectPath,
          cases,
          pageId: optionalString(args, 'pageId'),
          componentId: optionalString(args, 'componentId'),
        })
        return {
          ok: true,
          result: summarize({
            passed: suite.passed,
            total: suite.total,
            passedCount: suite.passedCount,
            failedCount: suite.failedCount,
            results: suite.results,
            message: suite.passed
              ? '全部前端测试通过（真实预览画布），可以 finish'
              : '存在失败用例，请修复后重新 run_frontend_tests',
          }),
        }
      }
      default: {
        const platform = await executePlatformAiTool(options)
        if (platform) return platform
        throw new Error(`未知操作：${options.tool}`)
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '操作失败',
    }
  }
}

export function buildToolCatalogPrompt(): string {
  return AI_TOOL_CATALOG.map(
    (tool) =>
      `- ${tool.name}（${tool.label}）：${tool.description}\n  args 示例：${tool.argsHint}`,
  ).join('\n')
}
