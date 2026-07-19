<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Coin,
  Connection,
  Cpu,
  Plus,
  Timer,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getServiceControllers,
  getServiceProcessors,
  saveServiceControllers as saveServiceControllersApi,
} from '../../api/projects'
import {
  createDefaultMethodFlow,
  createEmptyDataMethodConfig,
  createEmptyProcessorTypeExpr,
  createEmptyServiceApi,
  createEmptyServiceController,
  type MethodFlow,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
  type ServiceApi,
  type ServiceApiParamLocation,
  type ServiceController,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import EditServiceApiDialog, {
  type ServiceApiEditPayload,
} from './EditServiceApiDialog.vue'
import MethodFlowEditor from './method-flow/MethodFlowEditor.vue'
import ServiceProcessorPanel, {
  type ProcessorDebugTarget,
  type ProcessorSelectionState,
} from './ServiceProcessorPanel.vue'

type ServiceLayer = 'controller' | 'service' | 'data' | 'schedule'

const props = defineProps<{
  projectPath: string
  serviceId: string
  serviceName: string
  typeLibrary: DataTypeLibrary | null
  /** 受控：当前层（由工作区持久化） */
  layer?: ServiceLayer
  /** 恢复：控制器选中 */
  restoredControllerId?: string
  /** 恢复：业务层选中 */
  restoredBusiness?: {
    processorId: string
    methodId: string
    flowEditing: { processorId: string; methodId: string } | null
  } | null
  /** 恢复：数据层选中 */
  restoredData?: {
    processorId: string
    methodId: string
  } | null
}>()

const emit = defineEmits<{
  'update:layer': [layer: ServiceLayer]
  'update:debug-target': [target: ProcessorDebugTarget | null]
  'update:controller-id': [id: string]
  'update:business-selection': [state: ProcessorSelectionState]
  'update:data-selection': [state: ProcessorSelectionState]
}>()

const dataProcessorPanelRef = ref<InstanceType<typeof ServiceProcessorPanel> | null>(
  null,
)
const businessProcessorPanelRef = ref<InstanceType<
  typeof ServiceProcessorPanel
> | null>(null)

const layerTabs = [
  { key: 'controller' as const, label: '控制器', icon: Connection },
  { key: 'service' as const, label: '业务层', icon: Cpu },
  { key: 'data' as const, label: '数据层', icon: Coin },
  { key: 'schedule' as const, label: '定时任务', icon: Timer },
]

const activeLayer = computed({
  get: () => props.layer ?? 'controller',
  set: (layer: ServiceLayer) => {
    emit('update:layer', layer)
  },
})
const controllers = ref<ServiceController[]>([])
const activeControllerId = ref('')
const loading = ref(false)
const dialogVisible = ref(false)
const dialogName = ref('')
const dialogPath = ref('')
const dialogRemark = ref('')
const editingControllerId = ref<string | null>(null)

function setLayer(layer: ServiceLayer) {
  activeLayer.value = layer
  if (layer === 'schedule') {
    emit('update:debug-target', null)
  }
}

function onDebugTarget(target: ProcessorDebugTarget | null) {
  if (activeLayer.value === 'controller') return
  emit('update:debug-target', target)
}

function applyDebugParams(params: Record<string, unknown>) {
  if (activeLayer.value === 'controller') {
    updateApiDebugParams(params)
    return
  }
  if (activeLayer.value === 'service') {
    businessProcessorPanelRef.value?.updateDebugParams(params)
    return
  }
  dataProcessorPanelRef.value?.updateDebugParams(params)
}

function applyFlowDebugCursor(state: {
  cursorNodeId: string | null
  visitedNodeIds: string[]
  printByNode?: Record<string, string>
}) {
  if (activeLayer.value === 'controller') {
    onApiFlowDebugCursor(state)
    return
  }
  businessProcessorPanelRef.value?.applyFlowDebugCursor(state)
}

defineExpose({ applyDebugParams, applyFlowDebugCursor })

let saveTimer: ReturnType<typeof setTimeout> | null = null

const activeController = computed(
  () => controllers.value.find((c) => c.id === activeControllerId.value) ?? null,
)

const apis = computed(() => activeController.value?.apis ?? [])

const dtoOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (t.category === 'dto' || (!t.category && t.kind === 'interface')) {
        opts.push({
          id: t.id,
          label: t.name ? `${t.name}${t.remark ? ` · ${t.remark}` : ''}` : t.id,
        })
      }
    }
  }
  return opts
})

watch(
  () => [props.projectPath, props.serviceId] as const,
  ([path, id]) => {
    // 切服务时不再强制回控制器；层由父级持久化状态决定
    if (path && id) void loadControllers()
    else {
      controllers.value = []
      activeControllerId.value = ''
    }
  },
  { immediate: true },
)

watch(
  controllers,
  (list) => {
    if (!list.length) {
      activeControllerId.value = ''
      return
    }
    const prefer = props.restoredControllerId
    if (prefer && list.some((c) => c.id === prefer)) {
      activeControllerId.value = prefer
      return
    }
    if (!list.some((c) => c.id === activeControllerId.value)) {
      activeControllerId.value = list[0]!.id
    }
  },
  { deep: true },
)

watch(activeControllerId, (id) => {
  emit('update:controller-id', id)
})

watch(
  () => props.layer,
  (layer) => {
    if (layer === 'schedule') {
      emit('update:debug-target', null)
    }
  },
)

async function loadControllers() {
  if (!props.projectPath || !props.serviceId) return
  loading.value = true
  try {
    const res = await getServiceControllers(props.projectPath, props.serviceId)
    controllers.value = res.controllers
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载控制器失败')
    controllers.value = []
  } finally {
    loading.value = false
  }
}

function persistControllers() {
  if (!props.projectPath || !props.serviceId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const res = await saveServiceControllersApi({
        projectPath: props.projectPath,
        serviceId: props.serviceId,
        controllers: controllers.value,
      })
      controllers.value = res.controllers
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存控制器失败')
    }
  }, 400)
}

function openCreateDialog() {
  editingControllerId.value = null
  dialogName.value = ''
  dialogPath.value = ''
  dialogRemark.value = ''
  dialogVisible.value = true
}

function openEditDialog(ctrl: ServiceController) {
  editingControllerId.value = ctrl.id
  dialogName.value = ctrl.name
  dialogPath.value = ctrl.path
  dialogRemark.value = ctrl.remark
  dialogVisible.value = true
}

function submitDialog() {
  const name = dialogName.value.trim()
  if (!name) {
    ElMessage.warning('请输入控制器名称')
    return
  }
  const path = dialogPath.value.trim()
  const remark = dialogRemark.value.trim()
  const nameTaken = controllers.value.some(
    (c) =>
      c.name.trim().toLowerCase() === name.toLowerCase() &&
      c.id !== editingControllerId.value,
  )
  if (nameTaken) {
    ElMessage.warning(`控制器名称「${name}」已存在`)
    return
  }

  if (editingControllerId.value) {
    controllers.value = controllers.value.map((c) =>
      c.id === editingControllerId.value ? { ...c, name, path, remark } : c,
    )
  } else {
    const next = {
      ...createEmptyServiceController(name),
      path,
      remark,
    }
    controllers.value = [...controllers.value, next]
    activeControllerId.value = next.id
  }
  dialogVisible.value = false
  persistControllers()
}

async function removeController(ctrl: ServiceController) {
  try {
    await ElMessageBox.confirm(
      `确定删除控制器「${ctrl.name}」？其下 API 将一并删除。`,
      '删除控制器',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  controllers.value = controllers.value.filter((c) => c.id !== ctrl.id)
  persistControllers()
}

function patchActiveApis(nextApis: ServiceApi[]) {
  const id = activeControllerId.value
  if (!id) return
  controllers.value = controllers.value.map((c) =>
    c.id === id ? { ...c, apis: nextApis } : c,
  )
  persistControllers()
}

const apiDialogVisible = ref(false)
const apiEditIndex = ref(-1)
const apiDraft = ref<ServiceApi | null>(null)
const selectedApiId = ref('')

const editingApi = computed(() => apiDraft.value)

const apiReservedNames = computed(() =>
  apis.value
    .filter((_, i) => i !== apiEditIndex.value)
    .map((a) => a.name.trim())
    .filter(Boolean),
)

function apiInputLocationClass(location: ServiceApiParamLocation): string {
  switch (location) {
    case 'query':
      return 'api-in-query'
    case 'param':
      return 'api-in-param'
    case 'body':
      return 'api-in-body'
    case 'httpHeader':
      return 'api-in-header'
    default:
      return ''
  }
}

function apiInputItems(api: ServiceApi): Array<{
  name: string
  location: ServiceApiParamLocation
  className: string
}> {
  return (api.inputs ?? [])
    .map((p) => {
      const name = p.varName.trim()
      if (!name) return null
      return {
        name,
        location: p.location,
        className: apiInputLocationClass(p.location),
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
}

function apiInputsTitle(api: ServiceApi): string {
  const list = apiInputItems(api)
  if (!list.length) return '无'
  return list.map((p) => `${p.location}:${p.name}`).join('、')
}

function addApi() {
  if (!activeController.value) {
    ElMessage.warning('请先选择或创建控制器')
    return
  }
  openApiDesign(-1)
}

/** 设计：弹窗编辑 API 元信息 */
function openApiDesign(index: number) {
  if (!activeController.value) return
  apiEditIndex.value = index
  if (index < 0) {
    apiDraft.value = createEmptyServiceApi(`api${apis.value.length + 1}`)
  } else {
    const api = apis.value[index]
    if (!api) return
    apiDraft.value = {
      ...api,
      inputs: (api.inputs ?? []).map((p) => ({ ...p })),
      flow: api.flow ?? createDefaultMethodFlow(),
    }
    selectedApiId.value = api.id
  }
  apiDialogVisible.value = true
}

function saveApiEdit(payload: ServiceApiEditPayload) {
  if (apiEditIndex.value < 0) {
    const base = apiDraft.value ?? createEmptyServiceApi(payload.name)
    patchActiveApis([
      ...apis.value,
      {
        ...base,
        name: payload.name,
        path: payload.path,
        remark: payload.remark,
        method: payload.method,
        inputs: payload.inputs,
        requireAuth: payload.requireAuth,
        flow: base.flow ?? createDefaultMethodFlow(),
      },
    ])
    selectedApiId.value = base.id
  } else {
    const next = apis.value.map((api, i) =>
      i === apiEditIndex.value
        ? {
            ...api,
            name: payload.name,
            path: payload.path,
            remark: payload.remark,
            method: payload.method,
            inputs: payload.inputs,
            requireAuth: payload.requireAuth,
          }
        : api,
    )
    patchActiveApis(next)
  }
  apiEditIndex.value = -1
  apiDraft.value = null
}

/** API 流程图编辑中 */
const apiFlowEditing = ref<{ controllerId: string; apiId: string } | null>(
  null,
)
const businessProcessors = ref<ServiceProcessor[]>([])
const dataLayerProcessors = ref<ServiceProcessor[]>([])
const flowProcessorsLoading = ref(false)
const apiFlowSelectedNodeId = ref<string | null>(null)
const apiFlowDebugCursorId = ref<string | null>(null)
const apiFlowDebugVisitedIds = ref<string[]>([])
const apiFlowDebugPrintByNode = ref<Record<string, string>>({})

const apiFlowEditingApi = computed(() => {
  const ctx = apiFlowEditing.value
  if (!ctx) return null
  const ctrl = controllers.value.find((c) => c.id === ctx.controllerId)
  return ctrl?.apis.find((a) => a.id === ctx.apiId) ?? null
})

const apiFlowEditingFlow = computed(
  () => apiFlowEditingApi.value?.flow ?? createDefaultMethodFlow(),
)

const selectedApi = computed(
  () => apis.value.find((a) => a.id === selectedApiId.value) ?? null,
)

function findTypeDef(id: string) {
  if (!id) return null
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}

function buildApiMethodParams(api: ServiceApi): ProcessorMethodParam[] {
  if (!api.inputs?.length) return []
  return api.inputs.map((p) => {
    const varName =
      p.varName.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'input'
    const def = p.typeRef ? findTypeDef(p.typeRef) : null
    const type = p.typeRef ? 'json' : p.type || 'string'
    return {
      id: p.id || `api_input_${varName}`,
      name: varName,
      remark: p.remark || def?.remark || `${p.location} · ${varName}`,
      typeExpr: {
        ...createEmptyProcessorTypeExpr(type),
        typeRef: p.typeRef || '',
      },
    }
  })
}

/** API 入参：供流程图环境变量使用（非 body 对象已平铺） */
const apiFlowMethodParams = computed((): ProcessorMethodParam[] => {
  const api = apiFlowEditingApi.value
  if (!api) return []
  return buildApiMethodParams(api)
})

const apiFlowMethodOutput = computed(
  (): ProcessorTypeExpr => createEmptyProcessorTypeExpr(),
)

function apiAsProcessorMethod(api: ServiceApi): ProcessorMethod {
  return {
    id: api.id,
    name: api.name,
    remark: api.remark,
    scope: 'public',
    params: buildApiMethodParams(api),
    output: createEmptyProcessorTypeExpr(),
    dataConfig: createEmptyDataMethodConfig(),
    debugParams: api.debugParams ?? {},
    flow: api.flow ?? createDefaultMethodFlow(),
  }
}

const apiFlowDebugTarget = computed<ProcessorDebugTarget | null>(() => {
  if (activeLayer.value !== 'controller') return null
  if (!props.projectPath || !props.serviceId) return null

  if (apiFlowEditing.value && apiFlowEditingApi.value) {
    const api = apiFlowEditingApi.value
    const ctrl = activeController.value
    return {
      kind: 'flow',
      projectPath: props.projectPath,
      serviceId: props.serviceId,
      processorId: ctrl?.id || 'controller',
      processorName: ctrl?.name || '控制器',
      method: apiAsProcessorMethod(api),
      flow: api.flow ?? createDefaultMethodFlow(),
      selectedNodeId: apiFlowSelectedNodeId.value,
      dataProcessors: dataLayerProcessors.value,
      businessProcessors: businessProcessors.value,
      mode: 'canvas',
    }
  }

  if (!selectedApi.value) return null
  return {
    kind: 'flow',
    projectPath: props.projectPath,
    serviceId: props.serviceId,
    processorId: activeController.value?.id || 'controller',
    processorName: activeController.value?.name || '控制器',
    method: apiAsProcessorMethod(selectedApi.value),
    flow: selectedApi.value.flow ?? createDefaultMethodFlow(),
    selectedNodeId: apiFlowSelectedNodeId.value || 'start',
    dataProcessors: dataLayerProcessors.value,
    businessProcessors: businessProcessors.value,
    mode: 'list',
  }
})

watch(
  apiFlowDebugTarget,
  (target) => {
    if (activeLayer.value !== 'controller') return
    emit('update:debug-target', target)
  },
  { immediate: true },
)

async function loadFlowProcessors() {
  if (!props.projectPath || !props.serviceId) {
    businessProcessors.value = []
    dataLayerProcessors.value = []
    return
  }
  flowProcessorsLoading.value = true
  try {
    const [biz, data] = await Promise.all([
      getServiceProcessors(props.projectPath, props.serviceId, 'business'),
      getServiceProcessors(props.projectPath, props.serviceId, 'data'),
    ])
    businessProcessors.value = biz.processors
    dataLayerProcessors.value = data.processors
  } catch (err) {
    businessProcessors.value = []
    dataLayerProcessors.value = []
    console.error(err)
  } finally {
    flowProcessorsLoading.value = false
  }
}

watch(
  () =>
    [
      activeLayer.value,
      props.projectPath,
      props.serviceId,
    ] as const,
  ([layer, path, id]) => {
    if (layer === 'controller' && path && id) void loadFlowProcessors()
  },
  { immediate: true },
)

function clearApiFlowDebug() {
  apiFlowSelectedNodeId.value = null
  apiFlowDebugCursorId.value = null
  apiFlowDebugVisitedIds.value = []
  apiFlowDebugPrintByNode.value = {}
}

function onApiFlowSelectedNode(nodeId: string | null) {
  apiFlowSelectedNodeId.value = nodeId
}

function onApiFlowDebugCursor(state: {
  cursorNodeId: string | null
  visitedNodeIds: string[]
  printByNode?: Record<string, string>
}) {
  apiFlowDebugCursorId.value = state.cursorNodeId
  apiFlowDebugVisitedIds.value = state.visitedNodeIds
  apiFlowDebugPrintByNode.value = state.printByNode ?? {}
}

function updateApiDebugParams(params: Record<string, unknown>) {
  const apiId = apiFlowEditing.value?.apiId ?? selectedApiId.value
  const ctrlId = apiFlowEditing.value?.controllerId ?? activeControllerId.value
  if (!apiId || !ctrlId) return
  controllers.value = controllers.value.map((c) => {
    if (c.id !== ctrlId) return c
    return {
      ...c,
      apis: c.apis.map((a) =>
        a.id === apiId ? { ...a, debugParams: { ...params } } : a,
      ),
    }
  })
  persistControllers()
}

/** 编辑：打开 API 流程图（与业务层方法一致） */
async function openApiFlow(index: number) {
  const api = apis.value[index]
  if (!api || !activeControllerId.value) return
  if (!api.flow?.nodes?.length) {
    updateApiFlow(api.id, createDefaultMethodFlow())
  }
  selectedApiId.value = api.id
  clearApiFlowDebug()
  apiFlowEditing.value = {
    controllerId: activeControllerId.value,
    apiId: api.id,
  }
  await loadFlowProcessors()
}

function closeApiFlow() {
  apiFlowEditing.value = null
  clearApiFlowDebug()
}

function updateApiFlow(apiId: string, flow: MethodFlow) {
  const ctrlId = activeControllerId.value
  if (!ctrlId) return
  controllers.value = controllers.value.map((c) => {
    if (c.id !== ctrlId) return c
    return {
      ...c,
      apis: c.apis.map((a) => (a.id === apiId ? { ...a, flow } : a)),
    }
  })
  persistControllers()
}

function onApiFlowUpdate(flow: MethodFlow) {
  const ctx = apiFlowEditing.value
  if (!ctx) return
  updateApiFlow(ctx.apiId, flow)
}

watch(
  () => [props.projectPath, props.serviceId] as const,
  () => {
    apiFlowEditing.value = null
    clearApiFlowDebug()
  },
)

watch(activeControllerId, () => {
  apiFlowEditing.value = null
  clearApiFlowDebug()
})

watch(selectedApiId, () => {
  if (!apiFlowEditing.value) clearApiFlowDebug()
})

async function removeApi(index: number) {
  const target = apis.value[index]
  if (!target) return
  try {
    await ElMessageBox.confirm(
      `确定删除 API「${target.name || target.path || target.id}」？`,
      '删除 API',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (selectedApiId.value === target.id) selectedApiId.value = ''
  if (apiFlowEditing.value?.apiId === target.id) apiFlowEditing.value = null
  patchActiveApis(apis.value.filter((_, i) => i !== index))
}

watch(
  apis,
  (list) => {
    if (!list.length) {
      selectedApiId.value = ''
      return
    }
    if (!list.some((a) => a.id === selectedApiId.value)) {
      selectedApiId.value = list[0]!.id
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  apiFlowEditing.value = null
  emit('update:debug-target', null)
})
</script>

<template>
  <div class="svc-workspace">
    <MethodFlowEditor
      v-if="activeLayer === 'controller' && apiFlowEditing && apiFlowEditingApi"
      :method-name="apiFlowEditingApi.name"
      title-kind="API"
      input-source-mode="business"
      :flow="apiFlowEditingFlow"
      :method-params="apiFlowMethodParams"
      :method-output="apiFlowMethodOutput"
      :data-processors="dataLayerProcessors"
      :business-processors="businessProcessors"
      current-processor-id=""
      current-method-id=""
      bound-data-processor-id=""
      :type-library="typeLibrary"
      :debug-cursor-id="apiFlowDebugCursorId"
      :debug-visited-ids="apiFlowDebugVisitedIds"
      :debug-print-by-node="apiFlowDebugPrintByNode"
      @back="closeApiFlow"
      @update:flow="onApiFlowUpdate"
      @update:selected-node="onApiFlowSelectedNode"
    />
    <div
      v-else-if="activeLayer === 'controller'"
      class="svc-workspace-body"
    >
      <aside class="ctrl-pane">
        <div class="pane-head">
          <span class="pane-title">控制器</span>
          <el-button type="primary" link :icon="Plus" @click="openCreateDialog">
            创建
          </el-button>
        </div>
        <el-skeleton v-if="loading" :rows="4" animated style="padding: 12px" />
        <el-empty
          v-else-if="!controllers.length"
          description="暂无控制器，点击创建"
          :image-size="56"
        />
        <ul v-else class="ctrl-list">
          <el-dropdown
            v-for="ctrl in controllers"
            :key="ctrl.id"
            trigger="contextmenu"
            class="ctrl-dropdown"
            @command="
              (cmd) =>
                cmd === 'edit'
                  ? openEditDialog(ctrl)
                  : void removeController(ctrl)
            "
          >
            <li
              class="ctrl-item"
              :class="{ active: ctrl.id === activeControllerId }"
              @click="activeControllerId = ctrl.id"
              @dblclick="openEditDialog(ctrl)"
              @contextmenu.prevent
            >
              <span
                class="ctrl-name"
                :title="ctrl.remark || ctrl.path || ctrl.name"
              >
                {{ ctrl.name }}
              </span>
              <span v-if="ctrl.path" class="ctrl-path">({{ ctrl.path }})</span>
            </li>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided>
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </ul>
      </aside>

      <section class="api-pane">
        <div class="pane-head">
          <span class="pane-title">API</span>
          <el-button
            type="primary"
            link
            :icon="Plus"
            :disabled="!activeController"
            @click="addApi"
          >
            创建
          </el-button>
        </div>
        <el-empty
          v-if="!activeController"
          description="请选择或创建左侧控制器"
          :image-size="64"
        />
        <div v-else class="api-table">
          <el-table
            :data="apis"
            border
            stripe
            empty-text="暂无 API，点击创建"
            highlight-current-row
            :row-class-name="
              ({ row }) => (row.id === selectedApiId ? 'is-selected-row' : '')
            "
            @row-click="(row) => (selectedApiId = (row as ServiceApi).id)"
          >
            <el-table-column label="名称" min-width="100">
              <template #default="{ row }">
                <span class="cell-text">{{ row.name || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="路径" min-width="110">
              <template #default="{ row }">
                <span class="cell-text muted">{{ row.path || '/' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="100">
              <template #default="{ row }">
                <span class="cell-text muted">{{ row.remark || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="请求方法" width="88" align="center">
              <template #default="{ row }">
                <span class="cell-text">{{ row.method }}</span>
              </template>
            </el-table-column>
            <el-table-column label="入参" min-width="180">
              <template #default="{ row }">
                <span
                  v-if="!apiInputItems(row).length"
                  class="cell-text muted"
                >无</span>
                <span
                  v-else
                  class="api-inputs"
                  :title="apiInputsTitle(row)"
                >
                  <template
                    v-for="(item, i) in apiInputItems(row)"
                    :key="`${item.location}-${item.name}-${i}`"
                  >
                    <span
                      v-if="i > 0"
                      class="api-inputs-sep"
                    >、</span>
                    <span
                      class="api-input-name"
                      :class="item.className"
                    >{{ item.name }}</span>
                  </template>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="鉴权" width="64" align="center">
              <template #default="{ row }">
                <span class="cell-text">{{ row.requireAuth ? '是' : '否' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160" align="center" fixed="right">
              <template #default="{ $index }">
                <el-button
                  type="primary"
                  link
                  size="small"
                  @click.stop="openApiDesign($index)"
                >
                  设计
                </el-button>
                <el-button
                  type="primary"
                  link
                  size="small"
                  @click.stop="openApiFlow($index)"
                >
                  编辑
                </el-button>
                <el-button
                  type="danger"
                  link
                  size="small"
                  @click.stop="removeApi($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>
    <ServiceProcessorPanel
      v-else-if="activeLayer === 'service'"
      ref="businessProcessorPanelRef"
      :project-path="projectPath"
      :service-id="serviceId"
      layer="business"
      :type-library="typeLibrary"
      :restored="restoredBusiness"
      @update:debug-target="onDebugTarget"
      @update:selection="emit('update:business-selection', $event)"
    />
    <ServiceProcessorPanel
      v-else-if="activeLayer === 'data'"
      ref="dataProcessorPanelRef"
      :project-path="projectPath"
      :service-id="serviceId"
      layer="data"
      :type-library="typeLibrary"
      :restored="
        restoredData
          ? {
              processorId: restoredData.processorId,
              methodId: restoredData.methodId,
              flowEditing: null,
            }
          : null
      "
      @update:debug-target="onDebugTarget"
      @update:selection="emit('update:data-selection', $event)"
    />
    <div v-else class="layer-placeholder">
      <el-empty description="定时任务稍后实现" :image-size="80" />
    </div>

    <div class="layer-tabs">
      <el-tooltip
        v-for="tab in layerTabs"
        :key="tab.key"
        :content="tab.label"
        placement="top"
      >
        <button
          type="button"
          class="layer-tab"
          :class="{ active: activeLayer === tab.key }"
          @click="setLayer(tab.key)"
        >
          <el-icon :size="18"><component :is="tab.icon" /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <el-dialog
      v-model="dialogVisible"
      title="控制器"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-width="64px" @submit.prevent="submitDialog">
        <el-form-item label="名称">
          <el-input
            v-model="dialogName"
            placeholder="如 goods"
            maxlength="64"
            autofocus
          />
        </el-form-item>
        <el-form-item label="路径">
          <el-input
            v-model="dialogPath"
            placeholder="如 /goods"
            maxlength="128"
          />
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="dialogRemark"
            type="textarea"
            :rows="2"
            placeholder="可选说明"
            maxlength="256"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitDialog">确定</el-button>
      </template>
    </el-dialog>

    <EditServiceApiDialog
      v-model="apiDialogVisible"
      :api="editingApi"
      :dto-options="dtoOptions"
      :reserved-names="apiReservedNames"
      @save="saveApiEdit"
    />
  </div>
</template>

<style scoped>
.svc-workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.svc-workspace-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  overflow: hidden;
}

.ctrl-pane,
.api-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ctrl-pane {
  border-right: 1px solid #ebeef5;
  background: #fafafa;
}

.pane-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  box-sizing: border-box;
  padding: 0 12px;
  border-bottom: 1px solid #ebeef5;
  background: #fff;
}

.pane-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.ctrl-list {
  margin: 0;
  padding: 8px;
  list-style: none;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.ctrl-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.ctrl-dropdown :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
}

.ctrl-item {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  list-style: none;
}

.ctrl-item:hover {
  background: #f0f2f5;
}

.ctrl-item.active {
  background: #ecf5ff;
}

.ctrl-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctrl-path {
  flex-shrink: 0;
  max-width: 72px;
  margin-right: 2px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.api-inputs {
  display: inline;
  font-size: 13px;
  line-height: 1.4;
  word-break: break-all;
}

.api-inputs-sep {
  color: #c0c4cc;
}

.api-input-name.api-in-query {
  color: #67c23a;
}

.api-input-name.api-in-param {
  color: #e6a23c;
}

.api-input-name.api-in-body {
  color: #9b59b6;
}

.api-input-name.api-in-header {
  color: #409eff;
}

.layer-placeholder {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.layer-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.layer-tab {
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

.layer-tab:hover {
  background: #f5f7fa;
  color: #303133;
}

.layer-tab.active {
  background: #ecf5ff;
  color: #409eff;
}

.cell-text {
  font-size: 13px;
  color: #303133;
  word-break: break-all;
}

.cell-text.muted {
  color: #909399;
}

.api-table :deep(.is-selected-row > td.el-table__cell) {
  background: #ecf5ff !important;
}
</style>
