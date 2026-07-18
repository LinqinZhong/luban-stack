<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Coin,
  Connection,
  Cpu,
  Delete,
  Plus,
  Setting,
  Timer,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getServiceControllers,
  saveServiceControllers as saveServiceControllersApi,
} from '../../api/projects'
import {
  createEmptyServiceApi,
  createEmptyServiceController,
  HTTP_METHOD_OPTIONS,
  type ServiceApi,
  type ServiceController,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import ServiceProcessorPanel, {
  type ProcessorDebugTarget,
} from './ServiceProcessorPanel.vue'

type ServiceLayer = 'controller' | 'service' | 'data' | 'schedule'

const props = defineProps<{
  projectPath: string
  serviceId: string
  serviceName: string
  typeLibrary: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:layer': [layer: ServiceLayer]
  'update:debug-target': [target: ProcessorDebugTarget | null]
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

const activeLayer = ref<ServiceLayer>('controller')
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
  emit('update:layer', layer)
  if (layer !== 'data' && layer !== 'service') {
    emit('update:debug-target', null)
  }
}

function onDebugTarget(target: ProcessorDebugTarget | null) {
  emit('update:debug-target', target)
}

function applyDebugParams(params: Record<string, unknown>) {
  if (activeLayer.value === 'service') {
    businessProcessorPanelRef.value?.updateDebugParams(params)
    return
  }
  dataProcessorPanelRef.value?.updateDebugParams(params)
}

function applyFlowDebugCursor(state: {
  cursorNodeId: string | null
  visitedNodeIds: string[]
}) {
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
    activeLayer.value = 'controller'
    emit('update:layer', 'controller')
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
    if (!list.some((c) => c.id === activeControllerId.value)) {
      activeControllerId.value = list[0]!.id
    }
  },
  { deep: true },
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

function addApi() {
  if (!activeController.value) {
    ElMessage.warning('请先选择或创建控制器')
    return
  }
  patchActiveApis([...apis.value, createEmptyServiceApi(`api${apis.value.length + 1}`)])
}

function updateApi(index: number, patch: Partial<ServiceApi>) {
  const next = apis.value.map((api, i) => (i === index ? { ...api, ...patch } : api))
  patchActiveApis(next)
}

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
  patchActiveApis(apis.value.filter((_, i) => i !== index))
}

function onApiConfig() {
  ElMessage.info('API 配置稍后实现')
}
</script>

<template>
  <div class="svc-workspace">
    <div v-if="activeLayer === 'controller'" class="svc-workspace-body">
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
              <span v-if="ctrl.path" class="ctrl-path">{{ ctrl.path }}</span>
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
          <el-table :data="apis" border stripe empty-text="暂无 API，点击创建">
            <el-table-column label="名称" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.name"
                  placeholder="名称"
                  size="small"
                  @update:model-value="updateApi($index, { name: String($event) })"
                />
              </template>
            </el-table-column>
            <el-table-column label="路径" min-width="120">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.path"
                  placeholder="/path"
                  size="small"
                  @update:model-value="updateApi($index, { path: String($event) })"
                />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="100">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.remark"
                  placeholder="说明"
                  size="small"
                  @update:model-value="updateApi($index, { remark: String($event) })"
                />
              </template>
            </el-table-column>
            <el-table-column label="请求方法" width="110">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="row.method"
                  size="small"
                  style="width: 100%"
                  @update:model-value="updateApi($index, { method: $event })"
                >
                  <el-option
                    v-for="opt in HTTP_METHOD_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="入参 (选择DTO)" min-width="140">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="row.inputDtoRef"
                  clearable
                  filterable
                  placeholder="选择 DTO"
                  size="small"
                  style="width: 100%"
                  @update:model-value="
                    updateApi($index, { inputDtoRef: String($event ?? '') })
                  "
                >
                  <el-option
                    v-for="opt in dtoOptions"
                    :key="opt.id"
                    :label="opt.label"
                    :value="opt.id"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="请求头" min-width="100">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.headers"
                  placeholder="请求头"
                  size="small"
                  @update:model-value="updateApi($index, { headers: String($event) })"
                />
              </template>
            </el-table-column>
            <el-table-column label="需要鉴权" width="90" align="center">
              <template #default="{ row, $index }">
                <el-switch
                  :model-value="row.requireAuth"
                  size="small"
                  @update:model-value="
                    updateApi($index, { requireAuth: Boolean($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="配置" width="72" align="center">
              <template #default>
                <el-button type="primary" link :icon="Setting" @click="onApiConfig">
                  配置
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="删除" width="64" align="center">
              <template #default="{ $index }">
                <el-button
                  type="danger"
                  link
                  :icon="Delete"
                  @click="removeApi($index)"
                />
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
      @update:debug-target="onDebugTarget"
    />
    <ServiceProcessorPanel
      v-else-if="activeLayer === 'data'"
      ref="dataProcessorPanelRef"
      :project-path="projectPath"
      :service-id="serviceId"
      layer="data"
      :type-library="typeLibrary"
      @update:debug-target="onDebugTarget"
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
</style>
