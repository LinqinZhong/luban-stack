<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { Delete, EditPen, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getServiceProcessors,
  saveServiceProcessors as saveServiceProcessorsApi,
} from '../../api/projects'
import {
  createEmptyProcessorMethod,
  createEmptyProcessorTypeExpr,
  createEmptyServiceProcessor,
  DATA_METHOD_OPERATION_OPTIONS,
  type ProcessorLayerKind,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  typeLabel,
  type DataFieldType,
} from '../../types/page-data'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import EditDataMethodDialog, {
  type DataMethodEditPayload,
} from './EditDataMethodDialog.vue'
import type { DataMethodDebugTarget } from './DataMethodDebugPanel.vue'
import MethodParamsDialog from './MethodParamsDialog.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = ['color', 'ref', 'icon']

const props = defineProps<{
  projectPath: string
  serviceId: string
  layer: ProcessorLayerKind
  typeLibrary: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:debug-target': [target: DataMethodDebugTarget | null]
}>()

const processors = ref<ServiceProcessor[]>([])
const dataLayerProcessors = ref<ServiceProcessor[]>([])
const activeProcessorId = ref('')
const loading = ref(false)
const dialogVisible = ref(false)
const dialogName = ref('')
const dialogRemark = ref('')
const dialogEntityRef = ref('')
const dialogDataProcessorRef = ref('')
const editingProcessorId = ref<string | null>(null)

const paramsDialogVisible = ref(false)
const editingMethodIndex = ref(-1)
const editingParams = ref<ProcessorMethodParam[]>([])

const genericDialogVisible = ref(false)
const genericDialogIndex = ref(-1)
const genericDialogNames = ref<string[]>([])
const genericDialogTypeName = ref('')
const genericDialogArgs = ref<Record<string, string>>({})
const genericDialogTarget = ref<'output' | 'param'>('output')
const genericDialogParamIndex = ref(-1)

const dataMethodDialogVisible = ref(false)
const dataMethodEditIndex = ref(-1)
const selectedMethodId = ref('')

let saveTimer: ReturnType<typeof setTimeout> | null = null

const isDataLayer = computed(() => props.layer === 'data')
const isBusinessLayer = computed(() => props.layer === 'business')

const layerLabel = computed(() =>
  props.layer === 'business' ? '业务层' : '数据层',
)

const activeProcessor = computed(
  () => processors.value.find((p) => p.id === activeProcessorId.value) ?? null,
)

const methods = computed(() => activeProcessor.value?.methods ?? [])

const entityOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (t.kind !== 'interface' || t.category !== 'entity') continue
      if (!t.name.trim()) continue
      opts.push({
        id: t.id,
        label: t.remark ? `${t.name} · ${t.remark}` : t.name,
      })
    }
  }
  return opts
})

const dataProcessorOptions = computed(() =>
  dataLayerProcessors.value.map((p) => ({
    id: p.id,
    label: p.remark ? `${p.name} · ${p.remark}` : p.name,
  })),
)

const typeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
      const kind =
        t.kind === 'enum'
          ? '枚举'
          : t.category === 'dto'
            ? 'DTO'
            : t.category === 'vo'
              ? 'VO'
              : t.category === 'entity'
                ? '实体'
                : t.kind === 'interface'
                  ? '接口'
                  : t.kind
      opts.push({
        id: t.id,
        label: `${t.name}（${kind}）${t.remark ? ` · ${t.remark}` : ''}`,
      })
    }
  }
  return opts
})

function entityLabel(ref: string): string {
  if (!ref) return ''
  return entityOptions.value.find((o) => o.id === ref)?.label ?? ref
}

function dataProcessorLabel(ref: string): string {
  if (!ref) return ''
  return dataProcessorOptions.value.find((o) => o.id === ref)?.label ?? ref
}

function processorSub(proc: ServiceProcessor): string {
  if (isDataLayer.value && proc.entityRef) {
    return entityLabel(proc.entityRef)
  }
  if (isBusinessLayer.value && proc.dataProcessorRef) {
    return dataProcessorLabel(proc.dataProcessorRef)
  }
  return proc.remark
}

function typeDefById(id: string) {
  if (!id) return null
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}

function genericNamesOf(typeRef: string): string[] {
  return (typeDefById(typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array') {
    if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
    return expr.itemTypeRef || ''
  }
  return expr.typeRef || ''
}

function formatTypeWithGenerics(
  typeRef: string,
  args: Record<string, string>,
): string {
  const def = typeDefById(typeRef)
  if (!def?.name) return typeRef || '—'
  const names = genericNamesOf(typeRef)
  if (!names.length) return def.name
  const inner = names
    .map((n) => {
      const ref = args[n] ?? ''
      if (!ref) return 'any'
      return typeDefById(ref)?.name || ref
    })
    .join(', ')
  return `${def.name}<${inner}>`
}

function formatTypeExpr(expr: ProcessorTypeExpr): string {
  const named = leafNamedRef(expr)
  const namedLabel = named
    ? formatTypeWithGenerics(named, expr.genericArgs ?? {})
    : ''
  if (expr.type === 'array') {
    if (expr.itemType === 'array') {
      const leaf =
        namedLabel ||
        typeLabel((expr.itemItemType || 'string') as DataFieldType)
      return `数组 / 数组 / ${leaf}`
    }
    const leaf =
      namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
    return `数组 / ${leaf}`
  }
  if (named) return namedLabel
  return typeLabel((expr.type || 'string') as DataFieldType)
}

function operationLabel(method: ProcessorMethod): string {
  const op = method.dataConfig?.operation
  return (
    DATA_METHOD_OPERATION_OPTIONS.find((o) => o.value === op)?.label || '—'
  )
}

function payloadToTypeExpr(
  payload: TypeSelectPayload,
  prev?: ProcessorTypeExpr,
): ProcessorTypeExpr {
  const next: ProcessorTypeExpr = {
    ...createEmptyProcessorTypeExpr(payload.type),
    type: payload.type,
    typeRef: payload.typeRef ?? '',
    itemType: payload.itemType ?? '',
    itemTypeRef: payload.itemTypeRef ?? '',
    itemItemType: payload.itemItemType ?? '',
    itemItemTypeRef: payload.itemItemTypeRef ?? '',
    genericArgs: {},
  }
  const named = leafNamedRef(next)
  const prevNamed = prev ? leafNamedRef(prev) : ''
  if (named && named === prevNamed) {
    next.genericArgs = { ...(prev?.genericArgs ?? {}) }
  } else {
    for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
  }
  return next
}

function paramsSummary(params: ProcessorMethodParam[]): string {
  if (!params.length) return '点击编辑入参'
  return params
    .map((p) => {
      const label = formatTypeExpr(p.typeExpr)
      return p.name ? `${p.name}: ${label}` : label
    })
    .join(', ')
}

watch(
  () => [props.projectPath, props.serviceId, props.layer] as const,
  ([path, id]) => {
    if (path && id) void loadProcessors()
    else {
      processors.value = []
      dataLayerProcessors.value = []
      activeProcessorId.value = ''
    }
  },
  { immediate: true },
)

watch(
  processors,
  (list) => {
    if (!list.length) {
      activeProcessorId.value = ''
      return
    }
    if (!list.some((p) => p.id === activeProcessorId.value)) {
      activeProcessorId.value = list[0]!.id
    }
  },
  { deep: true },
)

async function loadProcessors() {
  if (!props.projectPath || !props.serviceId) return
  loading.value = true
  try {
    const res = await getServiceProcessors(
      props.projectPath,
      props.serviceId,
      props.layer,
    )
    processors.value = res.processors
    if (props.layer === 'business') {
      const dataRes = await getServiceProcessors(
        props.projectPath,
        props.serviceId,
        'data',
      )
      dataLayerProcessors.value = dataRes.processors
    } else {
      dataLayerProcessors.value = []
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载处理器失败')
    processors.value = []
    dataLayerProcessors.value = []
  } finally {
    loading.value = false
  }
}

function persistProcessors() {
  if (!props.projectPath || !props.serviceId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const res = await saveServiceProcessorsApi({
        projectPath: props.projectPath,
        serviceId: props.serviceId,
        layer: props.layer,
        processors: processors.value,
      })
      processors.value = res.processors
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存处理器失败')
    }
  }, 400)
}

function openCreateDialog() {
  editingProcessorId.value = null
  dialogName.value = ''
  dialogRemark.value = ''
  dialogEntityRef.value = ''
  dialogDataProcessorRef.value = ''
  dialogVisible.value = true
}

function openEditDialog(proc: ServiceProcessor) {
  editingProcessorId.value = proc.id
  dialogName.value = proc.name
  dialogRemark.value = proc.remark
  dialogEntityRef.value = proc.entityRef
  dialogDataProcessorRef.value = proc.dataProcessorRef
  dialogVisible.value = true
}

function submitDialog() {
  const name = dialogName.value.trim()
  if (!name) {
    ElMessage.warning('请输入处理器名称')
    return
  }
  if (isDataLayer.value && !dialogEntityRef.value) {
    ElMessage.warning('数据层处理器必须绑定实体')
    return
  }
  const remark = dialogRemark.value.trim()
  const entityRef = isDataLayer.value ? dialogEntityRef.value : ''
  const dataProcessorRef = isBusinessLayer.value
    ? dialogDataProcessorRef.value
    : ''
  const nameTaken = processors.value.some(
    (p) =>
      p.name.trim().toLowerCase() === name.toLowerCase() &&
      p.id !== editingProcessorId.value,
  )
  if (nameTaken) {
    ElMessage.warning(`处理器名称「${name}」已存在`)
    return
  }

  if (editingProcessorId.value) {
    processors.value = processors.value.map((p) =>
      p.id === editingProcessorId.value
        ? { ...p, name, remark, entityRef, dataProcessorRef }
        : p,
    )
  } else {
    const next = {
      ...createEmptyServiceProcessor(name),
      remark,
      entityRef,
      dataProcessorRef,
    }
    processors.value = [...processors.value, next]
    activeProcessorId.value = next.id
  }
  dialogVisible.value = false
  persistProcessors()
}

async function removeProcessor(proc: ServiceProcessor) {
  try {
    await ElMessageBox.confirm(
      `确定删除处理器「${proc.name}」？其下方法将一并删除。`,
      '删除处理器',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  processors.value = processors.value.filter((p) => p.id !== proc.id)
  persistProcessors()
}

type ProcMenuCommand = 'edit' | 'delete'

function handleProcMenu(command: ProcMenuCommand, proc: ServiceProcessor) {
  if (command === 'edit') openEditDialog(proc)
  else void removeProcessor(proc)
}

function patchActiveMethods(nextMethods: ProcessorMethod[]) {
  const id = activeProcessorId.value
  if (!id) return
  processors.value = processors.value.map((p) =>
    p.id === id ? { ...p, methods: nextMethods } : p,
  )
  persistProcessors()
}

function addMethod() {
  if (!activeProcessor.value) {
    ElMessage.warning('请先选择或创建处理器')
    return
  }
  patchActiveMethods([
    ...methods.value,
    createEmptyProcessorMethod(`method${methods.value.length + 1}`),
  ])
}

function updateMethod(index: number, patch: Partial<ProcessorMethod>) {
  patchActiveMethods(
    methods.value.map((m, i) => (i === index ? { ...m, ...patch } : m)),
  )
}

async function removeMethod(index: number) {
  const target = methods.value[index]
  if (!target) return
  try {
    await ElMessageBox.confirm(
      `确定删除方法「${target.name || target.id}」？`,
      '删除方法',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  patchActiveMethods(methods.value.filter((_, i) => i !== index))
}

function openParamsDialog(index: number) {
  const method = methods.value[index]
  if (!method) return
  editingMethodIndex.value = index
  editingParams.value = method.params.map((p) => ({
    ...p,
    typeExpr: {
      ...p.typeExpr,
      genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
    },
  }))
  paramsDialogVisible.value = true
}

function saveParams(params: ProcessorMethodParam[]) {
  if (editingMethodIndex.value < 0) return
  updateMethod(editingMethodIndex.value, { params })
  editingMethodIndex.value = -1
}

function handleOutputChange(index: number, payload: TypeSelectPayload) {
  const prev = methods.value[index]?.output
  const next = payloadToTypeExpr(payload, prev)
  updateMethod(index, { output: next })
  const named = leafNamedRef(next)
  if (genericNamesOf(named).length) openOutputGenerics(index, next)
}

function openOutputGenerics(index: number, expr?: ProcessorTypeExpr) {
  const method = methods.value[index]
  const output = expr ?? method?.output
  if (!output) return
  const named = leafNamedRef(output)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericDialogTarget.value = 'output'
  genericDialogIndex.value = index
  genericDialogParamIndex.value = -1
  genericDialogNames.value = names
  genericDialogTypeName.value = typeDefById(named)?.name ?? ''
  genericDialogArgs.value = { ...(output.genericArgs ?? {}) }
  genericDialogVisible.value = true
}

function saveGenericArgs(args: Record<string, string>) {
  if (genericDialogTarget.value === 'output') {
    if (genericDialogIndex.value < 0) return
    const method = methods.value[genericDialogIndex.value]
    if (!method) return
    updateMethod(genericDialogIndex.value, {
      output: { ...method.output, genericArgs: args },
    })
  }
  genericDialogIndex.value = -1
}

const editingDataMethod = computed(() => {
  if (dataMethodEditIndex.value < 0) return null
  return methods.value[dataMethodEditIndex.value] ?? null
})

const selectedMethod = computed(() => {
  if (!isDataLayer.value || !selectedMethodId.value) return null
  return methods.value.find((m) => m.id === selectedMethodId.value) ?? null
})

const debugTarget = computed<DataMethodDebugTarget | null>(() => {
  if (!isDataLayer.value || !activeProcessor.value || !selectedMethod.value) {
    return null
  }
  return {
    projectPath: props.projectPath,
    serviceId: props.serviceId,
    processorId: activeProcessor.value.id,
    processorName: activeProcessor.value.name,
    method: selectedMethod.value,
  }
})

watch(
  debugTarget,
  (target) => emit('update:debug-target', target),
  { immediate: true },
)

onBeforeUnmount(() => {
  emit('update:debug-target', null)
})

watch(
  () => [activeProcessorId.value, methods.value.map((m) => m.id).join(',')] as const,
  () => {
    if (!isDataLayer.value) {
      selectedMethodId.value = ''
      return
    }
    if (
      selectedMethodId.value &&
      !methods.value.some((m) => m.id === selectedMethodId.value)
    ) {
      selectedMethodId.value = methods.value[0]?.id ?? ''
    } else if (!selectedMethodId.value && methods.value.length) {
      selectedMethodId.value = methods.value[0]!.id
    }
  },
)

function selectMethodRow(method: ProcessorMethod) {
  if (!isDataLayer.value) return
  selectedMethodId.value = method.id
}

function openDataMethodDialog(index: number) {
  if (!isDataLayer.value) return
  dataMethodEditIndex.value = index
  const method = methods.value[index]
  if (method) selectedMethodId.value = method.id
  dataMethodDialogVisible.value = true
}

function saveDataMethodEdit(payload: DataMethodEditPayload) {
  if (dataMethodEditIndex.value < 0) return
  updateMethod(dataMethodEditIndex.value, {
    name: payload.name,
    params: payload.params,
    output: payload.output,
    dataConfig: payload.dataConfig,
  })
  dataMethodEditIndex.value = -1
}

function updateDebugParams(params: Record<string, unknown>) {
  const id = selectedMethodId.value
  if (!id) return
  const index = methods.value.findIndex((m) => m.id === id)
  if (index < 0) return
  updateMethod(index, { debugParams: { ...params } })
}

defineExpose({ updateDebugParams })
</script>

<template>
  <div class="proc-workspace">
    <aside class="proc-pane">
      <div class="pane-head">
        <span class="pane-title">处理器</span>
        <el-button type="primary" link :icon="Plus" @click="openCreateDialog">
          创建
        </el-button>
      </div>
      <el-skeleton v-if="loading" :rows="4" animated style="padding: 12px" />
      <el-empty
        v-else-if="!processors.length"
        description="暂无处理器，点击创建"
        :image-size="56"
      />
      <ul v-else class="proc-list">
        <el-dropdown
          v-for="proc in processors"
          :key="proc.id"
          trigger="contextmenu"
          class="proc-dropdown"
          @command="(cmd) => handleProcMenu(cmd as ProcMenuCommand, proc)"
        >
          <li
            class="proc-item"
            :class="{ active: proc.id === activeProcessorId }"
            @click="activeProcessorId = proc.id"
            @dblclick="openEditDialog(proc)"
            @contextmenu.prevent
          >
            <span class="proc-name" :title="processorSub(proc) || proc.name">
              {{ proc.name }}
            </span>
            <span v-if="processorSub(proc)" class="proc-bind">
              {{ processorSub(proc) }}
            </span>
            <span class="proc-count">{{ proc.methods.length }}</span>
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

    <section class="method-pane">
      <div class="pane-head">
        <span class="pane-title">方法</span>
        <el-button
          type="primary"
          link
          :icon="Plus"
          :disabled="!activeProcessor"
          @click="addMethod"
        >
          创建
        </el-button>
      </div>
      <el-empty
        v-if="!activeProcessor"
        description="请选择或创建左侧处理器"
        :image-size="64"
      />
      <div v-else class="method-table" :class="{ 'data-layer': isDataLayer }">
        <el-table
          :data="methods"
          border
          stripe
          empty-text="暂无方法，点击创建"
          highlight-current-row
          :row-class-name="
            ({ row }) =>
              isDataLayer && row.id === selectedMethodId ? 'is-selected-row' : ''
          "
          @row-click="(row) => selectMethodRow(row as ProcessorMethod)"
        >
          <el-table-column label="名称" min-width="120">
            <template #default="{ row, $index }">
              <el-input
                v-if="!isDataLayer"
                :model-value="row.name"
                placeholder="方法名"
                size="small"
                @click.stop
                @update:model-value="
                  updateMethod($index, { name: String($event) })
                "
              />
              <span v-else class="cell-text">{{ row.name || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="isDataLayer"
            label="操作"
            width="96"
            align="center"
          >
            <template #default="{ row }">
              <span class="op-tag">{{ operationLabel(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="入参" min-width="160">
            <template #default="{ row, $index }">
              <button
                v-if="!isDataLayer"
                type="button"
                class="params-trigger"
                @click.stop="openParamsDialog($index)"
              >
                {{ paramsSummary(row.params) }}
              </button>
              <span v-else class="cell-text muted">
                {{ paramsSummary(row.params) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="出参" min-width="160">
            <template #default="{ row, $index }">
              <div v-if="!isDataLayer" class="output-cell" @click.stop>
                <DataFieldTypeTreeSelect
                  class="output-select"
                  :type="(row.output.type || 'string') as DataFieldType"
                  :type-ref="row.output.typeRef"
                  :item-type="(row.output.itemType || undefined) as DataFieldType | undefined"
                  :item-type-ref="row.output.itemTypeRef"
                  :item-item-type="
                    (row.output.itemItemType || undefined) as DataFieldType | undefined
                  "
                  :item-item-type-ref="row.output.itemItemTypeRef"
                  :library="typeLibrary"
                  :exclude-types="PROCESSOR_EXCLUDE_TYPES"
                  :allow-ref="false"
                  clearable
                  size="small"
                  placeholder="选择出参类型"
                  @change="handleOutputChange($index, $event)"
                />
                <el-tooltip
                  v-if="genericNamesOf(leafNamedRef(row.output)).length"
                  :content="formatTypeExpr(row.output)"
                  placement="top"
                >
                  <el-button
                    type="primary"
                    link
                    size="small"
                    class="generic-btn"
                    @click="openOutputGenerics($index)"
                  >
                    泛型
                  </el-button>
                </el-tooltip>
              </div>
              <span v-else class="cell-text">{{ formatTypeExpr(row.output) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="isDataLayer"
            label="编辑"
            width="64"
            align="center"
          >
            <template #default="{ $index }">
              <el-button
                type="primary"
                link
                :icon="EditPen"
                @click.stop="openDataMethodDialog($index)"
              />
            </template>
          </el-table-column>
          <el-table-column label="删除" width="64" align="center">
            <template #default="{ $index }">
              <el-button
                type="danger"
                link
                :icon="Delete"
                @click.stop="removeMethod($index)"
              />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog
      v-model="dialogVisible"
      :title="`${layerLabel} · 处理器`"
      width="440px"
      destroy-on-close
      append-to-body
    >
      <el-form label-width="100px" @submit.prevent="submitDialog">
        <el-form-item label="名称" required>
          <el-input
            v-model="dialogName"
            placeholder="如 GoodsProcessor"
            maxlength="64"
            autofocus
          />
        </el-form-item>
        <el-form-item
          v-if="isDataLayer"
          label="绑定实体"
          required
        >
          <el-select
            v-model="dialogEntityRef"
            filterable
            placeholder="选择实体类型"
            style="width: 100%"
          >
            <el-option
              v-for="opt in entityOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <p v-if="!entityOptions.length" class="field-hint">
            暂无实体，请先在「数据类型」中添加接口 / 实体
          </p>
        </el-form-item>
        <el-form-item v-if="isBusinessLayer" label="绑定数据层">
          <el-select
            v-model="dialogDataProcessorRef"
            clearable
            filterable
            placeholder="可选，绑定数据层处理器"
            style="width: 100%"
          >
            <el-option
              v-for="opt in dataProcessorOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <p v-if="!dataProcessorOptions.length" class="field-hint">
            暂无数据层处理器，可先创建数据层
          </p>
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

    <MethodParamsDialog
      v-model="paramsDialogVisible"
      :params="editingParams"
      :type-options="typeOptions"
      :type-library="typeLibrary"
      :method-name="methods[editingMethodIndex]?.name"
      @save="saveParams"
    />
    <TypeGenericArgsDialog
      v-model="genericDialogVisible"
      :type-name="genericDialogTypeName"
      :generic-names="genericDialogNames"
      :args="genericDialogArgs"
      :type-options="typeOptions"
      @save="saveGenericArgs"
    />
    <EditDataMethodDialog
      v-if="isDataLayer"
      v-model="dataMethodDialogVisible"
      :method="editingDataMethod"
      :type-library="typeLibrary"
      :type-options="typeOptions"
      :entity-ref="activeProcessor?.entityRef"
      @save="saveDataMethodEdit"
    />  </div>
</template>

<style scoped>
.proc-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  overflow: hidden;
}

.proc-pane,
.method-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.proc-pane {
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

.proc-list {
  margin: 0;
  padding: 8px;
  list-style: none;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.proc-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.proc-dropdown :deep(.el-tooltip__trigger),
.proc-dropdown :deep(.el-dropdown__trigger) {
  display: block !important;
  width: 100%;
}

.proc-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  list-style: none;
}

.proc-item:hover {
  background: #f0f2f5;
}

.proc-item.active {
  background: #ecf5ff;
}

.proc-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-bind {
  flex: 0 1 auto;
  max-width: 88px;
  margin-left: 4px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-count {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  font-size: 11px;
  color: #94a3b8;
  min-width: 1.25em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.method-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.method-table :deep(.el-table .cell) {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.method-table :deep(.el-input),
.method-table :deep(.el-select),
.method-table :deep(.el-cascader) {
  width: 100%;
}

.method-table :deep(.el-input__wrapper),
.method-table :deep(.el-select__wrapper),
.method-table :deep(.el-cascader .el-input__wrapper) {
  height: 24px;
  min-height: 24px;
}

.params-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  height: 24px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 12px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.params-trigger:hover {
  border-color: #c0c4cc;
  color: #409eff;
}

.output-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  height: 24px;
}

.output-select {
  flex: 1;
  min-width: 0;
}

.generic-btn {
  flex-shrink: 0;
  height: 24px;
  padding: 0 4px;
  margin: 0;
}

.cell-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #303133;
  line-height: 24px;
}

.op-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: #f0f5ff;
  color: #409eff;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.cell-text.muted {
  color: #606266;
}

.method-table :deep(.is-selected-row > td.el-table__cell) {
  background: #ecf5ff !important;
}

.method-table :deep(.el-table__body tr) {
  cursor: default;
}

.method-table.data-layer :deep(.el-table__body tr) {
  cursor: pointer;
}
</style>
