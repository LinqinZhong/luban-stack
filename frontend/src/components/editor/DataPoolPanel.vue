<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import ComputedBindingDialog from './ComputedBindingDialog.vue'
import ControllerBindingDialog from './ControllerBindingDialog.vue'
import DataFieldTypeTreeSelect from './DataFieldTypeTreeSelect.vue'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'
import {
  createEmptyControllerBinding,
  createEmptyDataField,
  DATA_SOURCE_BINDING_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  defaultComputeBody,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type ControllerBindingConfig,
  type DataField,
  type DataFieldType,
  type DataSourceBinding,
  type ObjectSubField,
  type PageData,
} from '../../types/page-data'
import { resolveComputedPageData } from '../../utils/compute-runtime'
import type { DeviceInfo } from '../../utils/device-info'
import { isReservedDataFieldName } from '../../utils/component-props'
import type { ComponentPropDef, ComponentEventDef } from '../../types/component'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageMethod } from '../../types/page-method'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import {
  findDataTypeDef,
  objectFieldsFromTypeRef,
} from '../../utils/named-type-fields'
import { buildWidgetTreeSelectData } from '../../utils/widget-tree'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  data: PageData
  /** 当前页面/组件 XML，供「引用」类型选择控件节点 */
  xml?: string
  iconOptions?: Array<{ id: string; label: string }>
  /** 计算字段求值时的 getDeviceInfo（与画布场景对齐） */
  getDeviceInfo?: () => DeviceInfo
  /** 编辑组件时的参数定义（$props 提示与求值） */
  componentProps?: ComponentPropDef[] | null
  /** 计算字段求值时的 $props */
  dollarProps?: Record<string, unknown>
  /** 项目数据类型库（树形类型选择） */
  typeLibrary?: DataTypeLibrary | null
  /** 项目路径：控制器绑定拉服务列表 */
  projectPath?: string
  /** 页面/组件方法：控制器加载事件绑定 */
  methods?: PageMethod[]
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  emitEvents?: ComponentEventDef[]
}>()

const emit = defineEmits<{
  'update:data': [data: PageData]
}>()

const fields = computed({
  get: () => props.data.fields,
  set(value: DataField[]) {
    emit('update:data', { fields: value })
  },
})

const objectDialogVisible = ref(false)
const arrayDialogVisible = ref(false)
const computeDialogVisible = ref(false)
const controllerDialogVisible = ref(false)
const editingIndex = ref(-1)

const genericDialogVisible = ref(false)
const genericFieldIndex = ref(-1)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgsDraft = ref<Record<string, string>>({})

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

function leafNamedTypeRef(field: {
  type?: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}): string {
  if (field.type === 'array') {
    if (field.itemType === 'array') return field.itemItemTypeRef || ''
    return field.itemTypeRef || ''
  }
  return field.typeRef || ''
}

function genericNamesOf(typeRef: string): string[] {
  return (findDataTypeDef(props.typeLibrary, typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

function formatFieldTypeWithGenerics(row: DataField): string {
  const named = leafNamedTypeRef(row)
  const def = findDataTypeDef(props.typeLibrary, named)
  if (!def?.name) return ''
  const names = genericNamesOf(named)
  const args = row.genericArgs ?? {}
  const leafLabel = names.length
    ? `${def.name}<${names
        .map((n) => {
          const ref = (args[n] ?? '').trim()
          if (!ref) return 'any'
          return findDataTypeDef(props.typeLibrary, ref)?.name || ref
        })
        .join(', ')}>`
    : def.name
  if (row.type === 'array') {
    if (row.itemType === 'array') return `${leafLabel}[][]`
    return `${leafLabel}[]`
  }
  return leafLabel
}

function typeSelectLabel(row: DataField): string {
  return formatFieldTypeWithGenerics(row)
}

function openFieldGenerics(index: number) {
  const row = fields.value[index]
  if (!row) return
  const named = leafNamedTypeRef(row)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericFieldIndex.value = index
  genericNames.value = names
  genericTypeName.value = findDataTypeDef(props.typeLibrary, named)?.name ?? ''
  const prev = row.genericArgs ?? {}
  const next: Record<string, string> = {}
  for (const n of names) next[n] = prev[n] ?? ''
  genericArgsDraft.value = next
  genericDialogVisible.value = true
}

function saveFieldGenerics(args: Record<string, string>) {
  if (genericFieldIndex.value < 0) return
  updateField(genericFieldIndex.value, { genericArgs: { ...args } })
}

function updateField(index: number, patch: Partial<DataField>) {
  if (typeof patch.name === 'string' && isReservedDataFieldName(patch.name)) {
    ElMessage.warning('字段名「$props」为组件入参保留字，请换用其他名称')
    return
  }
  const next = fields.value.map((item, i) =>
    i === index ? { ...item, ...patch } : item,
  )
  fields.value = next
}

function handleTypeChange(
  index: number,
  payload: {
    type: DataFieldType
    typeRef?: string
    itemType?: DataFieldType
    itemTypeRef?: string
    itemItemType?: DataFieldType
    itemItemTypeRef?: string
  },
) {
  const { type, typeRef, itemType, itemTypeRef, itemItemType, itemItemTypeRef } = payload
  const named = leafNamedTypeRef({
    type,
    typeRef,
    itemType,
    itemTypeRef,
    itemItemType,
    itemItemTypeRef,
  })
  const names = genericNamesOf(named)
  const prev = fields.value[index]
  const sameLeaf = leafNamedTypeRef(prev ?? {}) === named
  const genericArgs: Record<string, string> | undefined = names.length
    ? Object.fromEntries(
        names.map((n) => [
          n,
          sameLeaf ? (prev?.genericArgs?.[n] ?? '') : '',
        ]),
      )
    : undefined
  updateField(index, {
    type,
    typeRef,
    genericArgs,
    itemType: type === 'array' ? itemType || 'string' : undefined,
    itemTypeRef: type === 'array' ? itemTypeRef : undefined,
    itemItemType:
      type === 'array' && itemType === 'array' ? itemItemType || 'string' : undefined,
    itemItemTypeRef:
      type === 'array' && itemType === 'array' ? itemItemTypeRef : undefined,
    value: defaultValue(type),
    arrayFields: undefined,
    objectFields: undefined,
    ...(type === 'ref'
      ? {
          binding: '' as const,
          computeBody: '',
          controllerBinding: undefined,
        }
      : {}),
  })
  if (names.length) {
    openFieldGenerics(index)
  }
}

const widgetRefOptions = computed(() =>
  buildWidgetTreeSelectData(props.xml ?? ''),
)

/** 颜色/字符串类展示用：避免对象被 String() 成 [object Object] */
function colorSafeString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function addField() {
  fields.value = [...fields.value, createEmptyDataField()]
}

function removeField(index: number) {
  fields.value = fields.value.filter((_, i) => i !== index)
}

function openObjectEditor(index: number) {
  editingIndex.value = index
  objectDialogVisible.value = true
}

function openArrayEditor(index: number) {
  editingIndex.value = index
  arrayDialogVisible.value = true
}

function saveObjectFields(objectFields: ObjectSubField[]) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    value: buildObjectValue(objectFields),
    objectFields,
    arrayFields: undefined,
  })
}

function saveArrayFields(arrayFields: ArraySubField[]) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    value: buildArrayValue(arrayFields ?? []),
    arrayFields: arrayFields ?? [],
    objectFields: undefined,
  })
}

const editingObjectFields = computed(() => {
  const field = fields.value[editingIndex.value]
  if (!field || field.type !== 'json') return []
  const existing = resolveObjectFields(field.objectFields, field.value)
  if (field.typeRef) {
    return objectFieldsFromTypeRef(field.typeRef, props.typeLibrary, existing)
  }
  return existing
})

const editingObjectTypeRef = computed(
  () => fields.value[editingIndex.value]?.typeRef || '',
)

const editingArrayFields = computed(() => {
  const field = fields.value[editingIndex.value]
  if (!field || field.type !== 'array') return []
  return resolveArrayFields(field.arrayFields, field.value)
})

function objectFieldCount(row: DataField) {
  if (row.objectFields?.length) return row.objectFields.length
  if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
    return Object.keys(row.value).length
  }
  return 0
}

function arrayItemCount(row: DataField) {
  if (row.arrayFields?.length) return row.arrayFields.length
  return Array.isArray(row.value) ? row.value.length : 0
}

const resolvedData = computed(() =>
  resolveComputedPageData(props.data, {
    getDeviceInfo: props.getDeviceInfo,
    dollarProps: props.dollarProps,
  }),
)

function resolvedField(row: DataField): DataField | undefined {
  const name = row.name.trim()
  if (!name) return undefined
  return resolvedData.value.fields.find((item) => item.name.trim() === name)
}

function computedValueSummary(row: DataField): string {
  const field = resolvedField(row)
  if (!field) return '计算结果为空'
  if (field.type === 'array' || Array.isArray(field.value)) {
    return `${Array.isArray(field.value) ? field.value.length : 0} 项`
  }
  if (field.type === 'json' && field.value && typeof field.value === 'object') {
    return `${Object.keys(field.value as object).length} 个字段`
  }
  if (field.type === 'boolean') return String(Boolean(field.value))
  if (field.value == null || field.value === '') return '（空）'
  return String(field.value)
}

const editingField = computed(() =>
  editingIndex.value >= 0 ? fields.value[editingIndex.value] ?? null : null,
)

const siblingFieldsForCompute = computed(() => {
  if (editingIndex.value < 0) return []
  return fields.value.filter(
    (item, i) => i !== editingIndex.value && item.name.trim(),
  )
})

function openComputeEditor(index: number) {
  editingIndex.value = index
  computeDialogVisible.value = true
}

function openControllerEditor(index: number) {
  editingIndex.value = index
  controllerDialogVisible.value = true
}

function controllerBindingSummary(row: DataField): string {
  const cfg = row.controllerBinding
  if (!cfg?.serviceId || !cfg.controllerId || !cfg.apiId) return '未配置 API'
  return '已绑定'
}

function handleBindingChange(index: number, binding: DataSourceBinding) {
  const field = fields.value[index]
  if (!field || field.type === 'ref') return
  if (binding === 'computed') {
    updateField(index, {
      binding: 'computed',
      computeBody: field.computeBody?.trim()
        ? field.computeBody
        : defaultComputeBody(field.type),
      controllerBinding: undefined,
    })
    openComputeEditor(index)
    return
  }
  if (binding === 'controller') {
    updateField(index, {
      binding: 'controller',
      computeBody: '',
      controllerBinding:
        field.controllerBinding ?? createEmptyControllerBinding(field.type),
    })
    openControllerEditor(index)
    return
  }
  updateField(index, {
    binding: '',
    controllerBinding: undefined,
  })
}

function saveComputeBody(body: string) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    binding: 'computed',
    computeBody: body,
    controllerBinding: undefined,
  })
}

function saveControllerBinding(config: ControllerBindingConfig) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    binding: 'controller',
    computeBody: '',
    controllerBinding: config,
  })
}
</script>

<template>
  <div class="data-pool">
    <div class="data-pool-toolbar">
      <div class="data-pool-title">数据池</div>
      <div class="data-pool-sub">data.json</div>
      <el-button type="primary" :icon="Plus" size="small" @click="addField">
        添加字段
      </el-button>
    </div>

    <div class="data-pool-table">
      <el-table :data="fields" border stripe empty-text="暂无数据字段，点击添加字段">
        <el-table-column label="字段名" min-width="140">
          <template #default="{ row, $index }">
            <el-input
              :model-value="row.name"
              placeholder="例如：username"
              @update:model-value="updateField($index, { name: $event })"
            />
          </template>
        </el-table-column>

        <el-table-column label="数据类型" min-width="200">
          <template #default="{ row, $index }">
            <div class="type-cell">
              <DataFieldTypeTreeSelect
                class="type-cell-select"
                :type="row.type"
                :type-ref="row.typeRef"
                :item-type="row.itemType"
                :item-type-ref="row.itemTypeRef"
                :item-item-type="row.itemItemType"
                :item-item-type-ref="row.itemItemTypeRef"
                :library="typeLibrary"
                :label-override="typeSelectLabel(row) || null"
                allow-ref
                :exclude-types="['api']"
                @change="handleTypeChange($index, $event)"
              />
              <el-button
                v-if="genericNamesOf(leafNamedTypeRef(row)).length"
                type="primary"
                link
                size="small"
                class="type-generic-btn"
                @click="openFieldGenerics($index)"
              >
                泛型
              </el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="140">
          <template #default="{ row, $index }">
            <el-input
              :model-value="row.remark"
              placeholder="备注"
              @update:model-value="updateField($index, { remark: $event })"
            />
          </template>
        </el-table-column>

        <el-table-column label="绑定数据源" min-width="140">
          <template #default="{ row, $index }">
            <div v-if="row.type === 'ref'" class="binding-disabled">不可绑定</div>
            <el-select
              v-else
              :model-value="row.binding || ''"
              placeholder="无"
              style="width: 100%"
              @update:model-value="handleBindingChange($index, $event)"
            >
              <el-option
                v-for="opt in DATA_SOURCE_BINDING_OPTIONS"
                :key="opt.value || 'none'"
                :label="opt.label"
                :value="opt.value"
                :disabled="opt.disabled"
              />
            </el-select>
          </template>
        </el-table-column>

        <el-table-column label="值" min-width="180">
          <template #default="{ row, $index }">
            <div v-if="row.binding === 'computed'" class="complex-value">
              <span class="value-preview">计算 · {{ computedValueSummary(row) }}</span>
              <el-button type="primary" link @click="openComputeEditor($index)">
                编辑逻辑
              </el-button>
            </div>
            <div v-else-if="row.binding === 'controller'" class="complex-value">
              <span class="value-preview">
                控制器 · {{ controllerBindingSummary(row) }}
              </span>
              <el-button
                type="primary"
                link
                @click="openControllerEditor($index)"
              >
                配置
              </el-button>
            </div>
            <el-input
              v-else-if="row.type === 'string'"
              :model-value="String(row.value ?? '')"
              placeholder="值"
              @update:model-value="updateField($index, { value: $event })"
            />
            <el-input-number
              v-else-if="row.type === 'number'"
              :model-value="Number(row.value ?? 0)"
              controls-position="right"
              @update:model-value="updateField($index, { value: Number($event ?? 0) })"
            />
            <el-switch
              v-else-if="row.type === 'boolean'"
              :model-value="Boolean(row.value)"
              @update:model-value="updateField($index, { value: $event })"
            />
            <IconValueSelect
              v-else-if="row.type === 'icon'"
              :model-value="colorSafeString(row.value)"
              :options="iconOptions"
              @update:model-value="updateField($index, { value: $event })"
            />
            <ColorPicker
              v-else-if="row.type === 'color'"
              :model-value="colorSafeString(row.value)"
              placeholder="#409eff / rgba(...)"
              @update:model-value="updateField($index, { value: $event })"
            />
            <el-tree-select
              v-else-if="row.type === 'ref'"
              :model-value="colorSafeString(row.value) || undefined"
              :data="widgetRefOptions"
              filterable
              clearable
              check-strictly
              default-expand-all
              :render-after-expand="false"
              placeholder="选择控件节点"
              style="width: 100%"
              @update:model-value="
                updateField($index, { value: $event == null ? '' : String($event) })
              "
            />
            <div v-else-if="row.type === 'json'" class="complex-value">
              <span class="value-preview">{{ objectFieldCount(row) }} 个字段</span>
              <el-button type="primary" link @click="openObjectEditor($index)">编辑</el-button>
            </div>
            <div v-else-if="row.type === 'array'" class="complex-value">
              <span class="value-preview">{{ arrayItemCount(row) }} 项</span>
              <el-button type="primary" link @click="openArrayEditor($index)">编辑</el-button>
            </div>
            <el-input
              v-else
              :model-value="colorSafeString(row.value)"
              placeholder="值"
              @update:model-value="updateField($index, { value: $event })"
            />
          </template>
        </el-table-column>

        <el-table-column label="操作" width="72" fixed="right" align="center">
          <template #default="{ $index }">
            <el-button
              type="danger"
              link
              size="small"
              @click="removeField($index)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="editingObjectFields"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :type-ref="editingObjectTypeRef"
      :schema-locked="Boolean(editingObjectTypeRef)"
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="arrayDialogVisible"
      :fields="editingArrayFields"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :default-item-type="fields[editingIndex]?.itemType"
      :default-item-type-ref="fields[editingIndex]?.itemTypeRef"
      :default-nested-item-type="fields[editingIndex]?.itemItemType"
      :default-nested-item-type-ref="fields[editingIndex]?.itemItemTypeRef"
      @save="saveArrayFields"
    />
    <ComputedBindingDialog
      v-model="computeDialogVisible"
      :field="editingField"
      :sibling-fields="siblingFieldsForCompute"
      :component-props="componentProps"
      :type-library="typeLibrary"
      @save="saveComputeBody"
    />
    <ControllerBindingDialog
      v-model="controllerDialogVisible"
      :field="editingField"
      :project-path="projectPath || ''"
      :methods="methods"
      :data-fields="fields"
      :xml="xml"
      :component-map="componentMap"
      :component-methods-map="componentMethodsMap"
      :icon-options="iconOptions"
      :component-props="componentProps"
      :emit-events="emitEvents"
      :type-library="typeLibrary"
      @save="saveControllerBinding"
    />
    <TypeGenericArgsDialog
      v-model="genericDialogVisible"
      :type-name="genericTypeName"
      :generic-names="genericNames"
      :args="genericArgsDraft"
      :type-options="typeOptions"
      @save="saveFieldGenerics"
    />
  </div>
</template>

<style scoped>
.data-pool {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.data-pool-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
}

.data-pool-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.data-pool-sub {
  flex: 1;
  font-size: 12px;
  color: #94a3b8;
}

.data-pool-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.type-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}

.type-cell-select {
  flex: 1;
  min-width: 0;
}

.type-generic-btn {
  flex-shrink: 0;
  padding: 0 2px;
}

.complex-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.binding-disabled {
  font-size: 13px;
  color: #94a3b8;
}

.value-preview {
  font-size: 13px;
  color: #64748b;
}

:deep(.el-table) {
  width: 100%;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>
