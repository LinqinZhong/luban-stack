<script setup lang="ts">
import { computed, ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import {
  createEmptyDataField,
  DATA_FIELD_TYPE_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type DataField,
  type ObjectSubField,
  type PageData,
} from '../../types/page-data'

const props = defineProps<{
  data: PageData
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
const editingIndex = ref(-1)

function updateField(index: number, patch: Partial<DataField>) {
  const next = fields.value.map((item, i) =>
    i === index ? { ...item, ...patch } : item,
  )
  fields.value = next
}

function handleTypeChange(index: number, type: DataField['type']) {
  updateField(index, {
    type,
    value: defaultValue(type),
  })
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
  })
}

function saveArrayFields(arrayFields: ArraySubField[]) {
  if (editingIndex.value < 0) return
  updateField(editingIndex.value, {
    value: buildArrayValue(arrayFields ?? []),
  })
}

const editingObjectFields = computed(() => {
  const field = fields.value[editingIndex.value]
  if (!field || field.type !== 'json') return []
  return resolveObjectFields(undefined, field.value)
})

const editingArrayFields = computed(() => {
  const field = fields.value[editingIndex.value]
  if (!field || field.type !== 'array') return []
  return resolveArrayFields(undefined, field.value)
})

function objectFieldCount(row: DataField) {
  if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
    return Object.keys(row.value).length
  }
  return 0
}

function arrayItemCount(row: DataField) {
  return Array.isArray(row.value) ? row.value.length : 0
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
            <el-input
              v-if="row.type === 'string'"
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
            <div v-else-if="row.type === 'json'" class="complex-value">
              <span class="value-preview">{{ objectFieldCount(row) }} 个字段</span>
              <el-button type="primary" link @click="openObjectEditor($index)">编辑</el-button>
            </div>
            <div v-else class="complex-value">
              <span class="value-preview">{{ arrayItemCount(row) }} 项</span>
              <el-button type="primary" link @click="openArrayEditor($index)">编辑</el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="绑定数据源" min-width="140">
          <template #default>
            <el-input disabled placeholder="暂未实现" />
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
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="arrayDialogVisible"
      :fields="editingArrayFields"
      @save="saveArrayFields"
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
