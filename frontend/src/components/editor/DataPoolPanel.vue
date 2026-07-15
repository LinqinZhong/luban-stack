<script setup lang="ts">
import { computed, ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import ComputedBindingDialog from './ComputedBindingDialog.vue'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import {
  createEmptyDataField,
  DATA_FIELD_TYPE_OPTIONS,
  DATA_SOURCE_BINDING_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  defaultComputeBody,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type DataField,
  type DataSourceBinding,
  type ObjectSubField,
  type PageData,
} from '../../types/page-data'
import { resolveComputedPageData } from '../../utils/compute-runtime'
import { isReservedDataFieldName } from '../../utils/component-props'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  data: PageData
  iconOptions?: Array<{ id: string; label: string }>
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
const editingIndex = ref(-1)

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

function handleTypeChange(index: number, type: DataField['type']) {
  updateField(index, {
    type,
    value: defaultValue(type),
    arrayFields: undefined,
    objectFields: undefined,
  })
}

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
  return resolveObjectFields(field.objectFields, field.value)
})

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

const resolvedData = computed(() => resolveComputedPageData(props.data))

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

function handleBindingChange(index: number, binding: DataSourceBinding) {
  if (binding === 'api') return
  const field = fields.value[index]
  if (!field) return
  if (binding === 'computed') {
    updateField(index, {
      binding: 'computed',
      computeBody: field.computeBody?.trim()
        ? field.computeBody
        : defaultComputeBody(field.type),
    })
    openComputeEditor(index)
    return
  }
  updateField(index, { binding: '' })
}

function saveComputeBody(body: string) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    binding: 'computed',
    computeBody: body,
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

        <el-table-column label="数据类型" width="140">
          <template #default="{ row, $index }">
            <el-select
              :model-value="row.type"
              @update:model-value="handleTypeChange($index, $event)"
            >
              <el-option
                v-for="opt in DATA_FIELD_TYPE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
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

        <el-table-column label="值" min-width="180">
          <template #default="{ row, $index }">
            <div v-if="row.binding === 'computed'" class="complex-value">
              <span class="value-preview">计算 · {{ computedValueSummary(row) }}</span>
              <el-button type="primary" link @click="openComputeEditor($index)">
                编辑逻辑
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

        <el-table-column label="绑定数据源" min-width="180">
          <template #default="{ row, $index }">
            <div class="binding-cell">
              <el-select
                :model-value="row.binding || ''"
                placeholder="无"
                style="flex: 1; min-width: 0"
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
              <el-button
                v-if="row.binding === 'computed'"
                type="primary"
                link
                @click="openComputeEditor($index)"
              >
                编辑
              </el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="72" fixed="right">
          <template #default="{ $index }">
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click="removeField($index)"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="editingObjectFields"
      :icon-options="iconOptions"
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="arrayDialogVisible"
      :fields="editingArrayFields"
      :icon-options="iconOptions"
      @save="saveArrayFields"
    />
    <ComputedBindingDialog
      v-model="computeDialogVisible"
      :field="editingField"
      :sibling-fields="siblingFieldsForCompute"
      @save="saveComputeBody"
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

.complex-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.binding-cell {
  display: flex;
  align-items: center;
  gap: 6px;
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
