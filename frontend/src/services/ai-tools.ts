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
import type { DataField, PageData } from '../types/page-data'
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
      '通过接口获取页面详情：配置、界面树、数据池（只读）。改界面/字段请继续调结构化修改工具',
    argsHint: '{ "pageId": "home" }',
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
      '通过接口在页面或组件中添加控件。parentNodeId 为空则挂到根布局',
    argsHint:
      '{ "scope": "page", "id": "home", "parentNodeId": "0:LinearLayout", "tag": "Button", "attrs": { "text": "提交" } }',
  },
  {
    name: 'update_widget_attrs',
    label: '修改控件属性',
    description: '通过接口更新指定节点属性；值为空字符串表示删除该属性',
    argsHint:
      '{ "scope": "page", "id": "home", "nodeId": "0:LinearLayout/1:Button", "attrs": { "text": "确定", "marginTop": "12" } }',
  },
  {
    name: 'remove_widget',
    label: '删除控件',
    description: '通过接口删除指定节点（根节点不可删）',
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
    description: '通过接口按字段名新增或更新数据池字段',
    argsHint:
      '{ "scope": "page", "id": "home", "field": { "name": "title", "type": "string", "remark": "标题", "value": "" } }',
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
    description: '通过接口列出页面全部方法（含预置）',
    argsHint: '{ "pageId": "home" }',
  },
  {
    name: 'save_page_method',
    label: '保存页面方法',
    description: '通过接口创建或更新方法；重命名时带 previousName',
    argsHint:
      '{ "pageId": "home", "method": { "name": "load", "params": [], "returnType": "void", "body": "" }, "previousName": "" }',
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
      '通过接口获取组件详情：配置、界面树、数据池（只读）。改界面/字段请继续调结构化修改工具',
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
    description: '通过接口列出组件方法',
    argsHint: '{ "componentId": "OrderCard" }',
  },
  {
    name: 'save_component_method',
    label: '保存组件方法',
    description: '通过接口创建或更新组件方法',
    argsHint:
      '{ "componentId": "OrderCard", "method": { "name": "refresh", "params": [], "returnType": "void", "body": "" } }',
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
    throw new Error(`属性 ${key} 必须是字符串/数字/布尔`)
  }
  return attrs
}

function optionalAttrs(args: Record<string, unknown>): Record<string, string> | undefined {
  if (args.attrs == null) return undefined
  return requireAttrs(args)
}

function requireMovePosition(args: Record<string, unknown>): MovePosition {
  const position = requireString(args, 'position')
  if (position !== 'before' && position !== 'after' && position !== 'inner') {
    throw new Error('position 必须是 before / after / inner')
  }
  return position
}

function normalizeDataField(raw: Record<string, unknown>): DataField {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new Error('field.name 不能为空')
  const type = typeof raw.type === 'string' ? raw.type.trim() : 'string'
  return {
    ...(raw as unknown as DataField),
    name,
    type: type as DataField['type'],
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    value: (raw.value ?? '') as DataField['value'],
  }
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

function summarize(data: unknown, max = 4000): string {
  try {
    const text = JSON.stringify(data, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n…(已截断，共 ${text.length} 字符)`
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
        return { ok: true, result: summarize(res) }
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
        const attrs = optionalAttrs(args)
        const { xml } = await loadXmlResource(projectPath, scope, id)
        let next = appendWidget(xml, parentNodeId, tag, {
          allowRootSiblings: scope === 'component',
          slot: optionalString(args, 'slot'),
        })
        if (attrs && Object.keys(attrs).length) {
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
            attrs: attrs ?? {},
          }),
        }
      }
      case 'update_widget_attrs': {
        const scope = requireScope(args)
        const id = requireString(args, 'id')
        const nodeId = requireString(args, 'nodeId')
        const attrs = requireAttrs(args)
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
        const next = removeWidget(xml, nodeId)
        const saved = await persistXml(projectPath, scope, id, next.xml)
        return {
          ok: true,
          result: summarize({
            scope,
            id: saved.id,
            removedNodeId: nodeId,
            parentId: next.parentId,
          }),
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
        return {
          ok: true,
          result: summarize(
            res.methods.map((m) => ({
              name: m.name,
              params: m.params,
              returnType: m.returnType,
            })),
          ),
        }
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
        return { ok: true, result: summarize(res) }
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
        return {
          ok: true,
          result: summarize(
            res.methods.map((m) => ({
              name: m.name,
              params: m.params,
              returnType: m.returnType,
            })),
          ),
        }
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
