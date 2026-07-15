<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Box,
  Coin,
  Document,
  EditPen,
  Lightning,
  Picture,
  Plus,
  View,
} from '@element-plus/icons-vue'
import {
  createPage,
  deletePageMethod,
  getPage,
  listPageMethods,
  listPages,
  savePageData,
  savePageMethod,
  savePageXml,
  type PageDetail,
  type PageSummary,
} from '../api/pages'
import {
  createComponent,
  deleteComponentMethod,
  getComponent,
  listComponentMethods,
  listComponents,
  saveComponentConfig,
  saveComponentData,
  saveComponentMethod,
  saveComponentXml,
  type ComponentDetail,
} from '../api/components'
import {
  getIconLibrary,
  saveIconLibrary as saveIconLibraryApi,
} from '../api/projects'
import DataPoolPanel from '../components/editor/DataPoolPanel.vue'
import IconLibraryPanel from '../components/editor/IconLibraryPanel.vue'
import MethodEditDialog from '../components/editor/MethodEditDialog.vue'
import MethodsPanel from '../components/editor/MethodsPanel.vue'
import ComponentMetaPanel from '../components/editor/ComponentMetaPanel.vue'
import PropsPanel, { type PropsTab } from '../components/editor/PropsPanel.vue'
import PageCanvas from '../components/xml/PageCanvas.vue'
import WidgetTree from '../components/xml/WidgetTree.vue'
import { useProjectStore } from '../stores/project'
import {
  createEmptyMethod,
  type PageMethod,
} from '../types/page-method'
import { runEventBindings } from '../utils/event-runtime'
import type { PreviewInteractPayload } from '../utils/event-runtime'
import { resolveComputedPageData } from '../utils/compute-runtime'
import { buildDollarProps } from '../utils/component-props'
import type { DataFieldValue } from '../types/page-data'
import {
  appendComponent,
  appendWidget,
  canDeleteNode,
  moveWidget,
  removeWidget,
  WIDGET_OPTIONS,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import type { ComponentConfig, ComponentSummary } from '../types/component'
import type { ComponentRenderMap } from '../types/component-render'
import type { PageData } from '../types/page-data'
import {
  createEmptyIconLibrary,
  type IconLibrary,
} from '../types/icon-library'

type WorkspaceMode = 'preview' | 'edit' | 'datapool' | 'icons' | 'methods'

const projectStore = useProjectStore()

type ResourceKind = 'page' | 'component'

const resourceKind = ref<ResourceKind>('page')
const pages = ref<PageSummary[]>([])
const components = ref<ComponentSummary[]>([])
const activePageId = ref('')
const activeComponentId = ref('')
const activePage = ref<PageDetail | null>(null)
const activeComponent = ref<ComponentDetail | null>(null)
const selectedNodeId = ref('')
const workspaceMode = ref<WorkspaceMode>('preview')
const addComponentVisible = ref(false)
const componentMap = ref<ComponentRenderMap>({})
const propsTab = ref<PropsTab>('style')
const openRepeatRequest = ref(0)
const loadingPages = ref(false)
const loadingPage = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const addWidgetVisible = ref(false)
const iconLibrary = ref<IconLibrary>(createEmptyIconLibrary())
/** 编辑态临时隐藏，不写入 XML；预览模式不生效 */
const editorHiddenNodeIds = ref<string[]>([])
const pageMethods = ref<PageMethod[]>([])
const methodDialogVisible = ref(false)
const editingMethod = ref<PageMethod | null>(null)
/** 预览态 navigateTo / navigateBack 历史 */
const pageHistory = ref<string[]>([])

const createForm = reactive({
  id: '',
  name: '',
  title: '',
})

const createRules = {
  id: [
    { required: true, message: '请输入页面 ID', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '仅支持字母、数字、下划线和短横线',
      trigger: 'blur',
    },
  ],
  name: [{ required: true, message: '请输入页面名称', trigger: 'blur' }],
}

const createFormRef = ref()

const canvasWidth = computed(
  () => projectStore.config?.canvas.width ?? 375,
)

const isPageResource = computed(() => resourceKind.value === 'page')
const isComponentResource = computed(() => resourceKind.value === 'component')
const activeDoc = computed(() =>
  isPageResource.value ? activePage.value : activeComponent.value,
)

/** 预览/画布使用：执行计算绑定后的数据池 */
const resolvedPageData = computed(() =>
  resolveComputedPageData(activeDoc.value?.data ?? { fields: [] }),
)

/** 编辑组件时：用 config.props 默认值作为 $props */
const editorDollarProps = computed(() => {
  if (!isComponentResource.value || !activeComponent.value) return undefined
  return buildDollarProps(activeComponent.value.config)
})

function parseFrameSize(
  value: string | undefined,
  fallback: number,
): number | 'auto' {
  if (!value || value === 'wrap_content') return 'auto'
  if (value === 'match_parent') return fallback
  const n = Number(value)
  // 0 / 非法固定值不应把画布压成空高度
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const canvasFrameWidth = computed(() => {
  if (isComponentResource.value && activeComponent.value) {
    const parsed = parseFrameSize(
      activeComponent.value.config.width,
      canvasWidth.value,
    )
    return parsed === 'auto' ? Math.min(canvasWidth.value, 320) : parsed
  }
  return canvasWidth.value
})

const canvasFrameHeight = computed(() => {
  if (isComponentResource.value && activeComponent.value) {
    return parseFrameSize(activeComponent.value.config.height, 667)
  }
  return undefined as number | 'auto' | undefined
})
const createDialogTitle = computed(() =>
  isComponentResource.value ? '新建组件' : '新建页面',
)

const isEditMode = computed(() => workspaceMode.value === 'edit')
const isDataPoolMode = computed(() => workspaceMode.value === 'datapool')
const isIconsMode = computed(() => workspaceMode.value === 'icons')
const isMethodsMode = computed(() => workspaceMode.value === 'methods')
const hideWidgetTree = computed(
  () => isDataPoolMode.value || isIconsMode.value || isMethodsMode.value,
)

const canDeleteSelected = computed(
  () =>
    isEditMode.value &&
    Boolean(activeDoc.value) &&
    canDeleteNode(selectedNodeId.value),
)

const showAddComponentButton = computed(
  () => isEditMode.value && isPageResource.value && Boolean(activePage.value),
)

const iconOptions = computed(() =>
  iconLibrary.value.icons.map((item) => ({
    id: item.id,
    label: item.label,
  })),
)

const modeTabs = [
  { key: 'preview' as const, label: '预览', icon: View },
  { key: 'edit' as const, label: '编辑', icon: EditPen },
  { key: 'datapool' as const, label: '数据池', icon: Coin },
  { key: 'icons' as const, label: '图标库', icon: Picture },
  { key: 'methods' as const, label: '方法', icon: Lightning },
]

const centerFileLabel = computed(() => {
  if (isDataPoolMode.value) return 'data.json'
  if (isIconsMode.value) return 'icons.json'
  if (isMethodsMode.value) return 'function/'
  return 'index.xml'
})

const propsPlaceholderText = computed(() => {
  if (!activePage.value && !isIconsMode.value) return '打开页面后可编辑'
  if (isDataPoolMode.value) return '数据池模式下请在中间区域编辑'
  if (isIconsMode.value) return '图标库模式下请在中间区域编辑'
  if (isMethodsMode.value) return '方法模式下请在中间区域编辑'
  if (isComponentResource.value && activeComponent.value && !selectedNodeId.value) {
    return '选中控件可编辑样式，或查看组件设置'
  }
  return isComponentResource.value ? '打开组件后可编辑' : '打开页面后可编辑'
})

async function loadPages(selectId?: string) {
  if (!projectStore.path) return

  loadingPages.value = true
  try {
    await loadIconLibrary()
    const [pageResult, componentResult] = await Promise.all([
      listPages(projectStore.path),
      listComponents(projectStore.path),
    ])
    pages.value = pageResult.pages
    components.value = componentResult.components
    await refreshComponentMap()

    if (resourceKind.value === 'component') {
      const nextId =
        selectId ||
        (activeComponentId.value &&
        componentResult.components.some((p) => p.id === activeComponentId.value)
          ? activeComponentId.value
          : componentResult.components[0]?.id)
      if (nextId) await openComponent(nextId)
      else {
        activeComponentId.value = ''
        activeComponent.value = null
        selectedNodeId.value = ''
      }
    } else {
      const nextId =
        selectId ||
        (activePageId.value && pageResult.pages.some((p) => p.id === activePageId.value)
          ? activePageId.value
          : pageResult.pages[0]?.id)
      if (nextId) await openPage(nextId)
      else {
        activePageId.value = ''
        activePage.value = null
        selectedNodeId.value = ''
      }
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载列表失败')
  } finally {
    loadingPages.value = false
  }
}

async function loadIconLibrary() {
  if (!projectStore.path) return
  try {
    iconLibrary.value = await getIconLibrary(projectStore.path)
  } catch (err) {
    iconLibrary.value = createEmptyIconLibrary()
    console.error(err)
  }
}

async function refreshComponentMap() {
  if (!projectStore.path) {
    componentMap.value = {}
    return
  }
  try {
    const { components: list } = await listComponents(projectStore.path)
    const details = await Promise.all(
      list.map((item) => getComponent(projectStore.path!, item.id)),
    )
    const next: ComponentRenderMap = {}
    for (const detail of details) {
      next[detail.id] = {
        id: detail.id,
        config: detail.config,
        xml: detail.xml,
        data: resolveComputedPageData(detail.data),
      }
    }
    componentMap.value = next
  } catch (err) {
    console.error(err)
  }
}

async function loadPageMethods(pageId?: string) {
  if (!projectStore.path) return
  const id =
    pageId ||
    (isComponentResource.value ? activeComponentId.value : activePageId.value)
  if (!id) {
    pageMethods.value = []
    return
  }
  try {
    const result = isComponentResource.value
      ? await listComponentMethods(projectStore.path, id)
      : await listPageMethods(projectStore.path, id)
    pageMethods.value = result.methods
  } catch (err) {
    pageMethods.value = []
    console.error(err)
  }
}

async function openPage(pageId: string, options?: { keepHistory?: boolean }) {
  if (!projectStore.path) return

  if (!options?.keepHistory) {
    pageHistory.value = []
  }

  resourceKind.value = 'page'
  activePageId.value = pageId
  activeComponentId.value = ''
  activeComponent.value = null
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  loadingPage.value = true
  try {
    activePage.value = await getPage(projectStore.path, pageId)
    await loadPageMethods(pageId)
  } catch (err) {
    activePage.value = null
    pageMethods.value = []
    ElMessage.error(err instanceof Error ? err.message : '打开页面失败')
  } finally {
    loadingPage.value = false
  }
}

async function openComponent(componentId: string) {
  if (!projectStore.path) return
  resourceKind.value = 'component'
  activeComponentId.value = componentId
  activePageId.value = ''
  activePage.value = null
  selectedNodeId.value = ''
  editorHiddenNodeIds.value = []
  pageHistory.value = []
  loadingPage.value = true
  try {
    activeComponent.value = await getComponent(projectStore.path, componentId)
    await loadPageMethods(componentId)
  } catch (err) {
    activeComponent.value = null
    pageMethods.value = []
    ElMessage.error(err instanceof Error ? err.message : '打开组件失败')
  } finally {
    loadingPage.value = false
  }
}

function switchResourceKind(kind: ResourceKind) {
  if (resourceKind.value === kind) return
  resourceKind.value = kind
  selectedNodeId.value = ''
  // 切换页面/组件资源时保持当前工作模式（编辑/数据池等），不要强制回预览
  if (kind === 'page') {
    const id = activePageId.value || pages.value[0]?.id
    if (id) void openPage(id)
    else {
      activePage.value = null
      pageMethods.value = []
    }
  } else {
    const id = activeComponentId.value || components.value[0]?.id
    if (id) void openComponent(id)
    else {
      activeComponent.value = null
      pageMethods.value = []
    }
  }
}

function toggleEditorHidden(nodeId: string) {
  const set = new Set(editorHiddenNodeIds.value)
  if (set.has(nodeId)) set.delete(nodeId)
  else set.add(nodeId)
  editorHiddenNodeIds.value = Array.from(set)
}

function openCreateDialog() {
  createForm.id = ''
  createForm.name = ''
  createForm.title = ''
  createVisible.value = true
}

async function handleCreatePage() {
  const form = createFormRef.value
  if (!form || !projectStore.path) return

  await form.validate(async (valid: boolean) => {
    if (!valid) return

    creating.value = true
    try {
      if (isComponentResource.value) {
        const component = await createComponent({
          projectPath: projectStore.path,
          id: createForm.id.trim(),
          name: createForm.name.trim(),
          title: createForm.title.trim() || undefined,
        })
        ElMessage.success(`已创建组件：${component.config.name}`)
        createVisible.value = false
        await loadPages(component.id)
      } else {
        const page = await createPage({
          projectPath: projectStore.path,
          id: createForm.id.trim(),
          name: createForm.name.trim(),
          title: createForm.title.trim() || undefined,
        })
        ElMessage.success(`已创建页面：${page.config.name}`)
        createVisible.value = false
        await loadPages(page.id)
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      creating.value = false
    }
  })
}

async function handleXmlUpdate(xml: string) {
  if (!projectStore.path || !activeDoc.value) return

  if (isComponentResource.value && activeComponent.value) {
    activeComponent.value = { ...activeComponent.value, xml }
    if (xmlSaveTimer) clearTimeout(xmlSaveTimer)
    xmlSaveTimer = setTimeout(async () => {
      if (!projectStore.path || !activeComponent.value) return
      try {
        activeComponent.value = await saveComponentXml({
          projectPath: projectStore.path,
          componentId: activeComponent.value.id,
          xml: activeComponent.value.xml,
        })
        await refreshComponentMap()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存失败')
      }
    }, 280)
    return
  }

  if (!activePage.value) return
  activePage.value = { ...activePage.value, xml }
  if (xmlSaveTimer) clearTimeout(xmlSaveTimer)
  xmlSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      activePage.value = await savePageXml({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        xml: activePage.value.xml,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存失败')
    }
  }, 280)
}

async function handlePreviewInteract(payload: PreviewInteractPayload) {
  if (workspaceMode.value !== 'preview' || !activeDoc.value) return

  await runEventBindings(payload.raw, {
    pageData: resolvedPageData.value,
    scope: payload.scope,
    hasPage: (pageId) => pages.value.some((item) => item.id === pageId),
    navigateTo: async (pageId) => {
      if (activePageId.value && activePageId.value !== pageId) {
        pageHistory.value.push(activePageId.value)
      }
      await openPage(pageId, { keepHistory: true })
    },
    navigateBack: async () => {
      const prev = pageHistory.value.pop()
      if (!prev) {
        ElMessage.info('没有可返回的页面')
        return
      }
      await openPage(prev, { keepHistory: true })
    },
    setData: (prop, value) => {
      applyPreviewSetData(prop, value)
    },
    onUnknownMethod: (name) => {
      if (name.startsWith('navigateTo:')) {
        ElMessage.warning(name.replace(/^navigateTo:\s*/, ''))
      }
    },
  })
}

function applyPreviewSetData(prop: string, value: import('../types/page-data').DataFieldValue) {
  if (!activeDoc.value) return
  const fields = [...(activeDoc.value.data?.fields ?? [])]
  const index = fields.findIndex((item) => item.name === prop)
  if (index < 0) {
    ElMessage.warning(`数据池不存在字段：${prop}`)
    return
  }
  fields[index] = { ...fields[index], value }
  void handleDataUpdate({ fields })
}

async function handleDataUpdate(data: import('../types/page-data').PageData) {
  if (!projectStore.path || !activeDoc.value) return

  /** 仅持久化已命名字段；空白草稿行留在本地，避免保存回写后被服务端过滤掉 */
  const persistableData = (): import('../types/page-data').PageData => ({
    fields: (activeDoc.value?.data.fields ?? []).filter((item) => {
      const name = item.name.trim()
      return Boolean(name) && name !== '$props'
    }),
  })

  if (isComponentResource.value && activeComponent.value) {
    activeComponent.value = { ...activeComponent.value, data }
    if (dataSaveTimer) clearTimeout(dataSaveTimer)
    dataSaveTimer = setTimeout(async () => {
      if (!projectStore.path || !activeComponent.value) return
      try {
        await saveComponentData({
          projectPath: projectStore.path,
          componentId: activeComponent.value.id,
          data: persistableData(),
        })
        // 不把服务端结果写回 data：避免清空未命名的「添加字段」草稿行
        await refreshComponentMap()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
      }
    }, 400)
    return
  }

  if (!activePage.value) return
  activePage.value = { ...activePage.value, data }

  if (dataSaveTimer) clearTimeout(dataSaveTimer)
  dataSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      await savePageData({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        data: persistableData(),
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
    }
  }, 400)
}

async function handleComponentConfigUpdate(config: ComponentConfig) {
  if (!projectStore.path || !activeComponent.value) return
  activeComponent.value = { ...activeComponent.value, config }
  try {
    activeComponent.value = await saveComponentConfig({
      projectPath: projectStore.path,
      componentId: activeComponent.value.id,
      config,
    })
    await refreshComponentMap()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存组件配置失败')
  }
}

let dataSaveTimer: ReturnType<typeof setTimeout> | null = null
let iconSaveTimer: ReturnType<typeof setTimeout> | null = null
let xmlSaveTimer: ReturnType<typeof setTimeout> | null = null

async function handleIconLibraryUpdate(library: IconLibrary) {
  if (!projectStore.path) return
  iconLibrary.value = library

  if (iconSaveTimer) clearTimeout(iconSaveTimer)
  iconSaveTimer = setTimeout(async () => {
    if (!projectStore.path) return
    try {
      iconLibrary.value = await saveIconLibraryApi({
        projectPath: projectStore.path,
        icons: iconLibrary.value.icons,
      })
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存图标库失败')
    }
  }, 400)
}

function openAddMethod() {
  editingMethod.value = createEmptyMethod()
  methodDialogVisible.value = true
}

function openEditMethod(method: PageMethod) {
  editingMethod.value = { ...method, params: method.params.map((p) => ({ ...p })) }
  methodDialogVisible.value = true
}

async function handleSaveMethod(method: PageMethod, previousName?: string) {
  if (!projectStore.path || !activeDoc.value) return
  try {
    const previous =
      previousName && previousName !== method.name ? previousName : undefined
    if (isComponentResource.value && activeComponent.value) {
      await saveComponentMethod({
        projectPath: projectStore.path,
        componentId: activeComponent.value.id,
        method,
        previousName: previous,
      })
    } else if (activePage.value) {
      await savePageMethod({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        method,
        previousName: previous,
      })
    }
    ElMessage.success('方法已保存')
    await loadPageMethods()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存方法失败')
  }
}

async function handleRemoveMethod(method: PageMethod) {
  if (!projectStore.path || !activeDoc.value || method.builtin) return
  try {
    await ElMessageBox.confirm(
      `确定删除方法「${method.name}」？对应 .ts 文件将一并删除。`,
      '删除方法',
      { type: 'warning' },
    )
    if (isComponentResource.value && activeComponent.value) {
      await deleteComponentMethod({
        projectPath: projectStore.path,
        componentId: activeComponent.value.id,
        name: method.name,
      })
    } else if (activePage.value) {
      await deletePageMethod({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        name: method.name,
      })
    }
    ElMessage.success('已删除')
    await loadPageMethods()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err instanceof Error ? err.message : '删除方法失败')
  }
}

function openAddWidgetDialog() {
  if (!activeDoc.value) return
  addWidgetVisible.value = true
}

function openAddComponentDialog() {
  if (!activePage.value) return
  addComponentVisible.value = true
}

async function handleAddComponentInstance(component: ComponentSummary) {
  if (!activePage.value || !projectStore.path) return
  try {
    let width = 'match_parent'
    let height = 'wrap_content'
    let name = component.name
    try {
      const detail = await getComponent(projectStore.path, component.id)
      width = detail.config.width || width
      height = detail.config.height || height
      name = detail.config.name || name
    } catch {
      // defaults
    }
    const { xml, newNodeId } = appendComponent(
      activePage.value.xml,
      selectedNodeId.value,
      {
        componentId: component.id,
        name,
        width,
        height,
      },
    )
    selectedNodeId.value = newNodeId
    addComponentVisible.value = false
    await handleXmlUpdate(xml)
    ElMessage.success(`已添加组件 ${name}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加组件失败')
  }
}

async function handleOpenRepeatConfig(nodeId: string) {
  if (!isEditMode.value || !nodeId) return
  selectedNodeId.value = nodeId
  propsTab.value = 'dynamic'
  await nextTick()
  openRepeatRequest.value += 1
}

async function handleAddWidget(tag: WidgetTag) {
  if (!activeDoc.value) return

  try {
    const { xml, newNodeId } = appendWidget(
      activeDoc.value.xml,
      selectedNodeId.value,
      tag,
    )
    addWidgetVisible.value = false
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success(`已添加 ${tag}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加控件失败')
  }
}

async function handleDeleteWidget() {
  if (!activeDoc.value || !canDeleteNode(selectedNodeId.value)) return

  const node = selectedNodeId.value
  try {
    await ElMessageBox.confirm(
      '删除后无法恢复，确定要删除该控件吗？',
      '删除控件',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  try {
    const { xml, parentId } = removeWidget(activeDoc.value.xml, node)
    selectedNodeId.value = parentId
    await handleXmlUpdate(xml)
    ElMessage.success('已删除控件')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除控件失败')
  }
}

async function handleMoveWidget(payload: {
  sourceId: string
  targetId: string
  position: MovePosition
}) {
  if (!activeDoc.value || !isEditMode.value) return

  try {
    const { xml, newNodeId } = moveWidget(
      activeDoc.value.xml,
      payload.sourceId,
      payload.targetId,
      payload.position,
    )
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success('已调整控件结构')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '移动控件失败')
  }
}

onMounted(() => {
  void loadPages()
})
</script>

<template>
  <div class="workspace">
    <aside class="side-panel">
      <div class="pages-section">
        <div class="section-header">
          <div class="resource-tabs">
            <button
              type="button"
              class="resource-tab"
              :class="{ active: isPageResource }"
              @click="switchResourceKind('page')"
            >
              页面
            </button>
            <button
              type="button"
              class="resource-tab"
              :class="{ active: isComponentResource }"
              @click="switchResourceKind('component')"
            >
              组件
            </button>
          </div>
          <el-button type="primary" :icon="Plus" size="small" @click="openCreateDialog">
            新建
          </el-button>
        </div>

        <div class="pages-body">
          <template v-if="isPageResource">
            <el-skeleton v-if="loadingPages && !pages.length" :rows="4" animated />
            <el-empty v-else-if="!pages.length" description="暂无页面，点击新建" :image-size="64" />
            <div v-else class="page-list">
              <button
                v-for="page in pages"
                :key="page.id"
                type="button"
                class="page-item"
                :class="{ active: page.id === activePageId }"
                @click="openPage(page.id)"
              >
                <el-icon><Document /></el-icon>
                <div class="page-meta">
                  <div class="page-name">{{ page.name }}</div>
                  <div class="page-id">{{ page.id }}</div>
                </div>
              </button>
            </div>
          </template>
          <template v-else>
            <el-skeleton v-if="loadingPages && !components.length" :rows="4" animated />
            <el-empty
              v-else-if="!components.length"
              description="暂无组件，点击新建"
              :image-size="64"
            />
            <div v-else class="page-list">
              <button
                v-for="item in components"
                :key="item.id"
                type="button"
                class="page-item"
                :class="{ active: item.id === activeComponentId }"
                @click="openComponent(item.id)"
              >
                <el-icon><Box /></el-icon>
                <div class="page-meta">
                  <div class="page-name">{{ item.name }}</div>
                  <div class="page-id">{{ item.id }}</div>
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>

      <WidgetTree
        v-if="activeDoc && !hideWidgetTree"
        :xml="activeDoc.xml"
        :selected-id="selectedNodeId"
        :editable="isEditMode"
        :hidden-ids="editorHiddenNodeIds"
        @select="selectedNodeId = $event"
        @open-repeat="handleOpenRepeatConfig"
        @move="handleMoveWidget"
        @toggle-hidden="toggleEditorHidden"
      />
    </aside>

    <section class="center-panel">
      <div class="preview-header">
        <template v-if="isIconsMode">
          <span class="preview-title">图标库</span>
          <span class="preview-sub">icons.json</span>
        </template>
        <template v-else-if="activeDoc">
          <span class="preview-title">{{ activeDoc.config.title || activeDoc.config.name }}</span>
          <span class="preview-sub">
            {{ isComponentResource ? 'components' : 'pages' }}/{{ activeDoc.id }}/{{ centerFileLabel }}
          </span>
        </template>
        <span v-else class="preview-title">{{ isComponentResource ? '组件预览' : '页面预览' }}</span>
      </div>

      <div class="preview-body">
        <el-skeleton v-if="loadingPage" :rows="8" animated />
        <IconLibraryPanel
          v-else-if="isIconsMode"
          :library="iconLibrary"
          @update:library="handleIconLibraryUpdate"
        />
        <el-empty
          v-else-if="!activeDoc"
          :description="isComponentResource ? '请选择或新建一个组件' : '请选择或新建一个页面'"
        />
        <DataPoolPanel
          v-else-if="isDataPoolMode"
          :data="activeDoc.data ?? { fields: [] }"
          :icon-options="iconOptions"
          @update:data="handleDataUpdate"
        />
        <MethodsPanel
          v-else-if="isMethodsMode"
          :methods="pageMethods"
          @add="openAddMethod"
          @edit="openEditMethod"
          @remove="handleRemoveMethod"
        />
        <PageCanvas
          v-else
          :xml="activeDoc.xml"
          :canvas-width="canvasFrameWidth"
          :canvas-height="canvasFrameHeight === undefined ? undefined : canvasFrameHeight"
          :selected-id="selectedNodeId"
          :selectable="isEditMode"
          :show-add-button="isEditMode"
          :show-add-component-button="showAddComponentButton"
          :show-delete-button="canDeleteSelected"
          :expand-repeat="workspaceMode === 'preview'"
          :page-data="resolvedPageData"
          :icon-library="iconLibrary"
          :component-map="componentMap"
          :dollar-props="editorDollarProps"
          :hidden-node-ids="isEditMode ? editorHiddenNodeIds : undefined"
          @select="selectedNodeId = $event"
          @open-repeat="handleOpenRepeatConfig"
          @interact="handlePreviewInteract"
          @add="openAddWidgetDialog"
          @add-component="openAddComponentDialog"
          @delete="handleDeleteWidget"
        />
      </div>

      <div class="mode-tabs">
        <el-tooltip
          v-for="tab in modeTabs"
          :key="tab.key"
          :content="tab.label"
          placement="top"
        >
          <button
            type="button"
            class="mode-tab"
            :class="{ active: workspaceMode === tab.key }"
            @click="workspaceMode = tab.key"
          >
            <el-icon :size="18"><component :is="tab.icon" /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </section>

    <template v-if="activeDoc && isEditMode && isComponentResource">
      <ComponentMetaPanel
        v-if="!selectedNodeId"
        :config="activeComponent!.config"
        :methods="pageMethods"
        :icon-options="iconOptions"
        @update:config="handleComponentConfigUpdate"
      />
      <div v-else class="props-with-back">
        <button type="button" class="back-component-meta" @click="selectedNodeId = ''">
          ← 返回组件设置
        </button>
        <PropsPanel
          v-model:tab="propsTab"
          :xml="activeDoc.xml"
          :selected-id="selectedNodeId"
          :data-fields="activeDoc.data?.fields ?? []"
          :icon-options="iconOptions"
          :methods="pageMethods"
          :component-map="componentMap"
          :open-repeat-request="openRepeatRequest"
          @update:xml="handleXmlUpdate"
        />
      </div>
    </template>
    <PropsPanel
      v-else-if="activeDoc && isEditMode"
      v-model:tab="propsTab"
      :xml="activeDoc.xml"
      :selected-id="selectedNodeId"
      :data-fields="activeDoc.data?.fields ?? []"
      :icon-options="iconOptions"
      :methods="pageMethods"
      :component-map="componentMap"
      :open-repeat-request="openRepeatRequest"
      @update:xml="handleXmlUpdate"
    />
    <aside v-else class="props-placeholder">
      <div class="panel-header">属性</div>
      <el-empty
        :description="propsPlaceholderText"
        :image-size="64"
      />
    </aside>

    <MethodEditDialog
      v-model="methodDialogVisible"
      :method="editingMethod"
      @save="handleSaveMethod"
    />

    <el-dialog v-model="createVisible" :title="createDialogTitle" width="480px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="88px">
        <el-form-item :label="isComponentResource ? '组件 ID' : '页面 ID'" prop="id">
          <el-input
            v-model="createForm.id"
            :placeholder="isComponentResource ? '例如：nav-bar' : '例如：home'"
          />
        </el-form-item>
        <el-form-item :label="isComponentResource ? '组件名称' : '页面名称'" prop="name">
          <el-input
            v-model="createForm.name"
            :placeholder="isComponentResource ? '例如：导航栏' : '例如：首页'"
          />
        </el-form-item>
        <el-form-item :label="isComponentResource ? '组件标题' : '页面标题'">
          <el-input v-model="createForm.title" placeholder="可选，默认与名称相同" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreatePage">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="addComponentVisible"
      title="添加组件"
      width="480px"
      destroy-on-close
    >
      <p class="add-hint">从组件列表选择，插入为 Component 节点。</p>
      <el-empty
        v-if="!components.length"
        description="暂无组件，请先在「组件」中新建"
        :image-size="64"
      />
      <div v-else class="widget-options">
        <button
          v-for="item in components"
          :key="item.id"
          type="button"
          class="widget-option"
          @click="handleAddComponentInstance(item)"
        >
          <div class="widget-option-title">{{ item.name }}</div>
          <div class="widget-option-desc">{{ item.id }}</div>
        </button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="addWidgetVisible"
      title="添加控件"
      width="480px"
      destroy-on-close
    >
      <p class="add-hint">
        将添加到当前选中的布局容器；若选中的是 Text/Button，则添加到其父布局。
      </p>
      <div class="widget-options">
        <button
          v-for="item in WIDGET_OPTIONS"
          :key="item.tag"
          type="button"
          class="widget-option"
          @click="handleAddWidget(item.tag)"
        >
          <div class="widget-option-title">{{ item.label }}</div>
          <div class="widget-option-desc">{{ item.description }}</div>
        </button>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border-right: 1px solid #ebeef5;
}

.pages-section {
  display: flex;
  flex-direction: column;
  flex: 0 0 42%;
  min-height: 160px;
  max-height: 50%;
  overflow: hidden;
}

.resource-tabs {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: #f1f5f9;
}

.resource-tab {
  border: none;
  background: transparent;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
}

.resource-tab.active {
  background: #fff;
  color: #303133;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.section-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid #ebeef5;
  font-weight: 600;
  color: #303133;
}

.pages-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.page-list {
  display: flex;
  flex-direction: column;
}

.page-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #303133;
}

.page-item:hover {
  background: #f5f7fa;
}

.page-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.page-meta {
  min-width: 0;
}

.page-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
}

.page-id {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.center-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.preview-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.preview-sub {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1;
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mode-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.mode-tab {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}

.mode-tab:hover {
  background: #f5f7fa;
  color: #303133;
}

.mode-tab.active {
  background: #ecf5ff;
  color: #409eff;
}

.props-with-back {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.back-component-meta {
  flex-shrink: 0;
  border: none;
  background: #f8fafc;
  border-bottom: 1px solid #ebeef5;
  text-align: left;
  padding: 10px 14px;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
}

.back-component-meta:hover {
  background: #ecf5ff;
}

.props-with-back :deep(.props-panel) {
  width: 100%;
  border-left: none;
}

.props-placeholder {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.panel-header {
  flex-shrink: 0;
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.add-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}

.widget-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-option {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.widget-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.widget-option-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.widget-option-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
