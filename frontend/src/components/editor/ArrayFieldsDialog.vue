<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Rank } from '@element-plus/icons-vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import {
  ARRAY_ITEM_TYPE_OPTIONS,
  defaultValue,
  resolveObjectFields,
  type ArraySubField,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
} from '../../types/page-data'

interface DraftItem {
  key: string
  type: DataFieldType
  value: DataFieldValue
  arrayFields: ArraySubField[]
  objectFields: ObjectSubField[]
}

const props = defineProps<{
  modelValue: boolean
  fields: ArraySubField[]
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [fields: ArraySubField[]]
}>()

const draft = ref<DraftItem[]>([])
const dragIndex = ref(-1)
const objectDialogVisible = ref(false)
const objectEditingKey = ref('')
const nestedDialogVisible = ref(false)
const nestedEditingKey = ref('')

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    draft.value = props.fields.map((item) => toDraftItem(item))
    if (!draft.value.length) {
      draft.value.push(createDraftItem())
    }
    dragIndex.value = -1
    objectEditingKey.value = ''
    nestedEditingKey.value = ''
  },
  { immediate: true },
)

function createKey() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function toDraftItem(item: ArraySubField): DraftItem {
  if (item.type === 'array') {
    return {
      key: createKey(),
      type: 'array',
      value: [],
      arrayFields: item.arrayFields ?? [],
      objectFields: [],
    }
  }
  if (item.type === 'json') {
    return {
      key: createKey(),
      type: 'json',
      value: {},
      arrayFields: [],
      objectFields: resolveObjectFields(item.objectFields, item.value),
    }
  }
  return {
    key: createKey(),
    type: item.type,
    value: item.value ?? defaultValue(item.type),
    arrayFields: [],
    objectFields: [],
  }
}

function createDraftItem(): DraftItem {
  return {
    key: createKey(),
    type: 'string',
    value: '',
    arrayFields: [],
    objectFields: [],
  }
}

function toArraySubField(item: DraftItem): ArraySubField {
  if (item.type === 'array') {
    return { type: 'array', arrayFields: item.arrayFields }
  }
  if (item.type === 'json') {
    return { type: 'json', objectFields: item.objectFields }
  }
  return { type: item.type, value: item.value }
}

function findDraftItem(key: string) {
  return draft.value.find((item) => item.key === key)
}

function close() {
  emit('update:modelValue', false)
}

function addField() {
  draft.value.push(createDraftItem())
}

function removeField(index: number) {
  draft.value.splice(index, 1)
  if (!draft.value.length) {
    draft.value.push(createDraftItem())
  }
}

function handleTypeChange(item: DraftItem, type: DataFieldType) {
  item.type = type
  item.value = defaultValue(type)
  item.arrayFields = type === 'array' ? [] : []
  item.objectFields = type === 'json' ? [] : []
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDrop(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return
  const items = [...draft.value]
  const [moved] = items.splice(dragIndex.value, 1)
  if (!moved) return
  items.splice(index, 0, moved)
  draft.value = items
  dragIndex.value = -1
}

function openObjectEditor(key: string) {
  objectEditingKey.value = key
  objectDialogVisible.value = true
}

function openNestedArrayEditor(key: string) {
  nestedEditingKey.value = key
  nestedDialogVisible.value = true
}

function saveObjectFields(fields: ObjectSubField[]) {
  const item = findDraftItem(objectEditingKey.value)
  if (!item) return
  item.objectFields = fields
}

function saveNestedArrayFields(fields: ArraySubField[]) {
  const item = findDraftItem(nestedEditingKey.value)
  if (!item) return
  item.arrayFields = fields
}

const editingObjectFields = computed(() => {
  const item = findDraftItem(objectEditingKey.value)
  if (!item || item.type !== 'json') return []
  return item.objectFields ?? []
})

const editingNestedFields = computed(() => {
  const item = findDraftItem(nestedEditingKey.value)
  if (!item || item.type !== 'array') return []
  return item.arrayFields ?? []
})

function handleSave() {
  emit('save', draft.value.map((item) => toArraySubField(item)))
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑数组字段"
    width="680px"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="hint">按顺序定义数组每一项的类型与数据值，可拖动排序</p>
    <div class="field-list">
      <div
        v-for="(item, index) in draft"
        :key="item.key"
        class="field-row"
        :class="{ dragging: dragIndex === index }"
        @dragover.prevent
        @drop="onDrop(index)"
      >
        <el-icon
          class="drag-handle"
          :size="16"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragend="dragIndex = -1"
        >
          <Rank />
        </el-icon>
        <el-select
          :model-value="item.type"
          placeholder="类型"
          @update:model-value="handleTypeChange(item, $event)"
        >
          <el-option
            v-for="opt in ARRAY_ITEM_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <div class="value-cell">
          <el-input
            v-if="item.type === 'string'"
            :model-value="String(item.value ?? '')"
            placeholder="数据值"
            @update:model-value="item.value = $event"
          />
          <el-input-number
            v-else-if="item.type === 'number'"
            :model-value="Number(item.value ?? 0)"
            controls-position="right"
            @update:model-value="item.value = Number($event ?? 0)"
          />
          <el-switch
            v-else-if="item.type === 'boolean'"
            :model-value="Boolean(item.value)"
            @update:model-value="item.value = $event"
          />
          <div v-else-if="item.type === 'json'" class="complex-value">
            <span class="value-preview">{{ item.objectFields.length }} 个字段</span>
            <el-button type="primary" link @click="openObjectEditor(item.key)">编辑</el-button>
          </div>
          <div v-else class="complex-value">
            <span class="value-preview">{{ item.arrayFields.length }} 项</span>
            <el-button type="primary" link @click="openNestedArrayEditor(item.key)">
              编辑
            </el-button>
          </div>
        </div>
        <el-button type="danger" link @click="removeField(index)">删除</el-button>
      </div>
    </div>
    <el-button type="primary" link :icon="Plus" @click="addField">添加项</el-button>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="editingObjectFields"
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="nestedDialogVisible"
      :fields="editingNestedFields"
      @save="saveNestedArrayFields"
    />
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.field-row {
  display: grid;
  grid-template-columns: 24px 140px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
}

.field-row.dragging {
  opacity: 0.5;
}

.drag-handle {
  color: #94a3b8;
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.value-cell {
  min-width: 0;
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

:deep(.el-input-number) {
  width: 100%;
}
</style>
