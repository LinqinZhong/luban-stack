<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DocumentCopy, Plus, Rank } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import IconValueSelect from './IconValueSelect.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import {
  ARRAY_ITEM_TYPE_OPTIONS,
  buildObjectValue,
  defaultValue,
  resolveObjectFields,
  type ArraySubField,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
} from '../../types/page-data'

const CLIPBOARD_MARKER = '__voiderArrayItem'

/** 跨弹窗实例共享，避免 destroy-on-close / 嵌套对话框丢剪贴板 */
let sharedClipboard: ArraySubField | null = null
const sharedClipboardTick = ref(0)

function bumpClipboard(item: ArraySubField | null) {
  sharedClipboard = item
  sharedClipboardTick.value += 1
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

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
  iconOptions?: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [fields: ArraySubField[]]
}>()

const draft = ref<DraftItem[]>([])
const dragIndex = ref(-1)
const selectedIndex = ref(-1)
const objectDialogVisible = ref(false)
const objectEditingKey = ref('')
const nestedDialogVisible = ref(false)
const nestedEditingKey = ref('')

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      window.removeEventListener('keydown', handleGlobalKeydown, true)
      return
    }
    draft.value = props.fields.map((item) => toDraftItem(item))
    if (!draft.value.length) {
      draft.value.push(createDraftItem())
    }
    dragIndex.value = -1
    selectedIndex.value = draft.value.length ? 0 : -1
    objectEditingKey.value = ''
    nestedEditingKey.value = ''
    window.addEventListener('keydown', handleGlobalKeydown, true)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown, true)
})

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
    return { type: 'array', arrayFields: deepClone(item.arrayFields) }
  }
  if (item.type === 'json') {
    return { type: 'json', objectFields: deepClone(item.objectFields) }
  }
  return { type: item.type, value: deepClone(item.value) }
}

function cloneArraySubField(item: ArraySubField): ArraySubField {
  return deepClone(item)
}

function findDraftItem(key: string) {
  return draft.value.find((item) => item.key === key)
}

function close() {
  emit('update:modelValue', false)
}

function addField() {
  draft.value.push(createDraftItem())
  selectedIndex.value = draft.value.length - 1
}

function removeField(index: number) {
  draft.value.splice(index, 1)
  if (!draft.value.length) {
    draft.value.push(createDraftItem())
  }
  if (selectedIndex.value >= draft.value.length) {
    selectedIndex.value = draft.value.length - 1
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
  selectedIndex.value = index
}

function onDrop(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return
  const items = [...draft.value]
  const [moved] = items.splice(dragIndex.value, 1)
  if (!moved) return
  items.splice(index, 0, moved)
  draft.value = items
  selectedIndex.value = index
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

const canPaste = computed(() => {
  sharedClipboardTick.value
  return Boolean(sharedClipboard)
})

function formatPreviewScalar(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'string') {
    const text = value.length > 24 ? `${value.slice(0, 24)}…` : value
    return text || '""'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return `{${Object.keys(value).length}}`
  return String(value)
}

function objectContentPreview(item: DraftItem): string {
  const obj = buildObjectValue(item.objectFields ?? [])
  const entries = Object.entries(obj)
  if (!entries.length) return '空对象'
  const parts = entries.slice(0, 5).map(([key, value]) => `${key}: ${formatPreviewScalar(value)}`)
  if (entries.length > 5) parts.push(`…+${entries.length - 5}`)
  return parts.join(' · ')
}

async function copyField(index: number) {
  const item = draft.value[index]
  if (!item) return
  selectedIndex.value = index
  try {
    const payload = toArraySubField(item)
    bumpClipboard(payload)
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ [CLIPBOARD_MARKER]: true, item: payload }),
      )
    } catch {
      // 系统剪贴板不可用时仍可用模块内剪贴板
    }
    ElMessage.success('已复制该项')
  } catch (err) {
    console.error(err)
    ElMessage.error('复制失败')
  }
}

async function readClipboardItem(): Promise<ArraySubField | null> {
  if (sharedClipboard) {
    return cloneArraySubField(sharedClipboard)
  }
  try {
    const text = await navigator.clipboard.readText()
    if (text?.trim()) {
      const parsed = JSON.parse(text) as {
        [CLIPBOARD_MARKER]?: boolean
        item?: ArraySubField
      }
      if (parsed?.[CLIPBOARD_MARKER] && parsed.item && typeof parsed.item.type === 'string') {
        return cloneArraySubField(parsed.item)
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function pasteField(afterIndex?: number) {
  const item = await readClipboardItem()
  if (!item) {
    ElMessage.warning('剪贴板中没有可粘贴的数组项')
    return
  }
  bumpClipboard(cloneArraySubField(item))
  const insertAt =
    typeof afterIndex === 'number' && afterIndex >= 0
      ? afterIndex + 1
      : selectedIndex.value >= 0
        ? selectedIndex.value + 1
        : draft.value.length
  draft.value.splice(insertAt, 0, toDraftItem(item))
  selectedIndex.value = insertAt
  ElMessage.success('已粘贴项')
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (!props.modelValue) return
  if (objectDialogVisible.value || nestedDialogVisible.value) return
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  const key = event.key.toLowerCase()
  if (key !== 'c' && key !== 'v') return
  // 输入框内留给原生文本复制粘贴
  if (isTypingTarget(event.target)) return

  if (key === 'c') {
    if (selectedIndex.value < 0) return
    event.preventDefault()
    event.stopPropagation()
    void copyField(selectedIndex.value)
    return
  }

  event.preventDefault()
  event.stopPropagation()
  void pasteField()
}

function handleSave() {
  emit(
    'save',
    draft.value.map((item) => toArraySubField(item)),
  )
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑数组字段"
    width="760px"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="hint">
      按顺序定义数组每一项的类型与数据值，可拖动排序；选中项后可用 Ctrl+C / Ctrl+V 复制粘贴
    </p>
    <div class="field-list">
      <div
        v-for="(item, index) in draft"
        :key="item.key"
        class="field-row"
        :class="{ dragging: dragIndex === index, selected: selectedIndex === index }"
        @click="selectedIndex = index"
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
          <IconValueSelect
            v-else-if="item.type === 'icon'"
            :model-value="String(item.value ?? '')"
            :options="iconOptions"
            @update:model-value="item.value = $event"
          />
          <div v-else-if="item.type === 'json'" class="complex-value object-value">
            <div class="object-preview" :title="objectContentPreview(item)">
              <span class="object-preview-text">{{ objectContentPreview(item) }}</span>
              <span class="value-meta">{{ item.objectFields.length }} 个字段</span>
            </div>
            <el-button type="primary" link @click.stop="openObjectEditor(item.key)">
              编辑
            </el-button>
          </div>
          <div v-else class="complex-value">
            <span class="value-preview">{{ item.arrayFields.length }} 项</span>
            <el-button type="primary" link @click.stop="openNestedArrayEditor(item.key)">
              编辑
            </el-button>
          </div>
        </div>
        <div class="row-actions">
          <el-button type="primary" link @click.stop="copyField(index)">复制</el-button>
          <el-button type="danger" link @click.stop="removeField(index)">删除</el-button>
        </div>
      </div>
    </div>
    <div class="list-actions">
      <el-button type="primary" link :icon="Plus" @click="addField">添加项</el-button>
      <el-button type="primary" link :icon="DocumentCopy" @click="pasteField()">
        粘贴项
      </el-button>
      <span v-if="!canPaste" class="paste-hint">先复制一项后再粘贴</span>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="editingObjectFields"
      :icon-options="iconOptions"
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="nestedDialogVisible"
      :fields="editingNestedFields"
      :icon-options="iconOptions"
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
  grid-template-columns: 24px 130px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  cursor: default;
}

.field-row.selected {
  border-color: #93c5fd;
  background: #f0f7ff;
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
  min-width: 0;
}

.object-value {
  width: 100%;
}

.object-preview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.object-preview-text {
  font-size: 13px;
  color: #334155;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-meta,
.value-preview {
  font-size: 12px;
  color: #94a3b8;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.list-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paste-hint {
  font-size: 12px;
  color: #94a3b8;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>
