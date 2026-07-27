<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Document, DocumentCopy, Monitor, Plus, Rank } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import DataFieldTypeTreeSelect from './DataFieldTypeTreeSelect.vue'
import JsonCodeEditor from './JsonCodeEditor.vue'
import OssResourcePickerDialog from './OssResourcePickerDialog.vue'
import {
  buildArrayValue,
  buildObjectValue,
  defaultValue,
  resolveObjectFields,
  typeLabel,
  valueToArrayFields,
  type ArraySubField,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
  type OssBindingConfig,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  findDataTypeDef,
  isArrayItemTypeLocked,
  objectFieldsFromTypeRef,
  resolveNamedTypeAsField,
} from '../../utils/named-type-fields'
import {
  buildArrayJsonSchema,
  validateJsonAgainstSchema,
} from '../../utils/json-type-schema'

type EditorMode = 'visual' | 'code'

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
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  arrayFields: ArraySubField[]
  objectFields: ObjectSubField[]
}

const props = defineProps<{
  modelValue: boolean
  fields: ArraySubField[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  /** 新建项默认类型（来自父级数组的元素类型） */
  defaultItemType?: DataFieldType
  defaultItemTypeRef?: string
  /** 当 defaultItemType 为 array 时，内层数组元素类型 */
  defaultNestedItemType?: DataFieldType
  defaultNestedItemTypeRef?: string
  /** 项目路径：对象存储资源选择 */
  projectPath?: string | null
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
const ossPickerVisible = ref(false)
const ossEditingKey = ref('')
const mode = ref<EditorMode>('visual')
const codeText = ref('[]')

const codeSchema = computed(() =>
  buildArrayJsonSchema({
    itemType: props.defaultItemType,
    itemTypeRef: props.defaultItemTypeRef,
    itemItemType: props.defaultNestedItemType,
    itemItemTypeRef: props.defaultNestedItemTypeRef,
    library: props.typeLibrary,
  }),
)

/** 非 any[]：项类型由父级数组锁定 */
const itemTypeLocked = computed(() => isArrayItemTypeLocked(props.defaultItemType))

const lockedTypeLabel = computed(() => {
  if (!itemTypeLocked.value) return ''
  if (props.defaultItemTypeRef) {
    const def = findDataTypeDef(props.typeLibrary, props.defaultItemTypeRef)
    if (def?.name?.trim()) return def.name.trim()
  }
  return typeLabel(props.defaultItemType || 'string')
})

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      window.removeEventListener('keydown', handleGlobalKeydown, true)
      return
    }
    mode.value = 'visual'
    draft.value = props.fields.map((item) => toDraftItem(item))
    if (!draft.value.length) {
      draft.value.push(createDraftItem())
    }
    dragIndex.value = -1
    selectedIndex.value = draft.value.length ? 0 : -1
    objectEditingKey.value = ''
    nestedEditingKey.value = ''
    syncCodeFromVisual()
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

function resolveDefaultItemShape(): {
  type: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  objectFields: ObjectSubField[]
  arrayFields: ArraySubField[]
  value: DataFieldValue
} {
  const rawType = props.defaultItemType || 'string'
  const typeRef = props.defaultItemTypeRef

  if (typeRef) {
    const resolved = resolveNamedTypeAsField(typeRef, props.typeLibrary)
    if (resolved.type === 'json' && resolved.typeRef) {
      return {
        type: 'json',
        typeRef: resolved.typeRef,
        objectFields: objectFieldsFromTypeRef(resolved.typeRef, props.typeLibrary),
        arrayFields: [],
        value: {},
      }
    }
    return {
      type: resolved.type,
      objectFields: [],
      arrayFields: [],
      value: defaultValue(resolved.type),
    }
  }

  if (rawType === 'json') {
    return {
      type: 'json',
      objectFields: [],
      arrayFields: [],
      value: {},
    }
  }

  if (rawType === 'array') {
    return {
      type: 'array',
      itemType: props.defaultNestedItemType || 'string',
      itemTypeRef: props.defaultNestedItemTypeRef,
      objectFields: [],
      arrayFields: [],
      value: [],
    }
  }

  if (rawType === 'any') {
    return {
      type: 'string',
      objectFields: [],
      arrayFields: [],
      value: '',
    }
  }

  return {
    type: rawType,
    objectFields: [],
    arrayFields: [],
    value: defaultValue(rawType),
  }
}

function hydrateNamedObjectFields(item: {
  type: DataFieldType
  typeRef?: string
  objectFields?: ObjectSubField[]
  value?: DataFieldValue
}): ObjectSubField[] {
  if (item.type !== 'json' || !item.typeRef) {
    return resolveObjectFields(item.objectFields, item.value)
  }
  return objectFieldsFromTypeRef(
    item.typeRef,
    props.typeLibrary,
    resolveObjectFields(item.objectFields, item.value),
  )
}

function toDraftItem(item: ArraySubField): DraftItem {
  const source = itemTypeLocked.value
    ? applyLockedTypeToItem(item)
    : item

  if (source.type === 'array') {
    return {
      key: createKey(),
      type: 'array',
      value: [],
      typeRef: source.typeRef,
      itemType: source.itemType,
      itemTypeRef: source.itemTypeRef,
      arrayFields: source.arrayFields ?? [],
      objectFields: [],
    }
  }
  if (source.type === 'json') {
    return {
      key: createKey(),
      type: 'json',
      value: {},
      typeRef: source.typeRef,
      arrayFields: [],
      objectFields: hydrateNamedObjectFields(source),
    }
  }
  return {
    key: createKey(),
    type: source.type,
    typeRef: source.typeRef,
    value: source.value ?? defaultValue(source.type),
    arrayFields: [],
    objectFields: [],
  }
}

/** 锁定元素类型时，把项强制对齐到父级数组声明 */
function applyLockedTypeToItem(item: ArraySubField): ArraySubField {
  const shape = resolveDefaultItemShape()
  if (shape.type === 'json' && shape.typeRef) {
    return {
      type: 'json',
      typeRef: shape.typeRef,
      objectFields: objectFieldsFromTypeRef(
        shape.typeRef,
        props.typeLibrary,
        item.type === 'json' ? item.objectFields : undefined,
      ),
    }
  }
  if (shape.type === 'array') {
    return {
      type: 'array',
      itemType: item.type === 'array' ? item.itemType : shape.itemType,
      itemTypeRef: item.type === 'array' ? item.itemTypeRef : shape.itemTypeRef,
      arrayFields: item.type === 'array' ? item.arrayFields ?? [] : [],
    }
  }
  if (item.type === shape.type) {
    return {
      type: shape.type,
      value: item.value ?? defaultValue(shape.type),
    }
  }
  return {
    type: shape.type,
    value: defaultValue(shape.type),
  }
}

function createDraftItem(): DraftItem {
  if (itemTypeLocked.value || props.defaultItemTypeRef || props.defaultItemType) {
    const shape = resolveDefaultItemShape()
    return {
      key: createKey(),
      type: shape.type,
      typeRef: shape.typeRef,
      value: shape.value,
      itemType: shape.itemType,
      itemTypeRef: shape.itemTypeRef,
      arrayFields: shape.arrayFields,
      objectFields: shape.objectFields,
    }
  }
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
    return {
      type: 'array',
      typeRef: item.typeRef,
      itemType: item.itemType,
      itemTypeRef: item.itemTypeRef,
      arrayFields: deepClone(item.arrayFields),
    }
  }
  if (item.type === 'json') {
    return {
      type: 'json',
      typeRef: item.typeRef,
      objectFields: deepClone(item.objectFields),
    }
  }
  return {
    type: item.type,
    typeRef: item.typeRef,
    value: deepClone(item.value),
  }
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

function handleTypeChange(
  item: DraftItem,
  payload: {
    type: DataFieldType
    typeRef?: string
    itemType?: DataFieldType
    itemTypeRef?: string
  },
) {
  if (itemTypeLocked.value) return
  item.type = payload.type
  item.typeRef = payload.typeRef
  item.value = defaultValue(payload.type)
  item.arrayFields = []
  item.objectFields = []
  item.itemType = payload.type === 'array' ? payload.itemType || 'string' : undefined
  item.itemTypeRef = payload.type === 'array' ? payload.itemTypeRef : undefined

  if (payload.type === 'json' && payload.typeRef) {
    item.objectFields = objectFieldsFromTypeRef(payload.typeRef, props.typeLibrary)
  }
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
  const item = findDraftItem(key)
  if (item?.type === 'json' && item.typeRef) {
    item.objectFields = objectFieldsFromTypeRef(
      item.typeRef,
      props.typeLibrary,
      item.objectFields,
    )
  }
  objectEditingKey.value = key
  objectDialogVisible.value = true
}

function openNestedArrayEditor(key: string) {
  nestedEditingKey.value = key
  nestedDialogVisible.value = true
}

function openOssPicker(key: string) {
  if (!props.projectPath?.trim()) {
    ElMessage.warning('未打开项目，无法选择对象存储资源')
    return
  }
  ossEditingKey.value = key
  ossPickerVisible.value = true
}

function onOssPicked(config: OssBindingConfig) {
  const item = findDraftItem(ossEditingKey.value)
  if (!item || item.type !== 'resource') return
  item.value = (config.url || '').trim()
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

const editingObjectTypeRef = computed(() => {
  const item = findDraftItem(objectEditingKey.value)
  return item?.typeRef || props.defaultItemTypeRef || ''
})

const editingObjectSchemaLocked = computed(() => Boolean(editingObjectTypeRef.value))

const editingNestedFields = computed(() => {
  const item = findDraftItem(nestedEditingKey.value)
  if (!item || item.type !== 'array') return []
  return item.arrayFields ?? []
})

const canPaste = computed(() => {
  sharedClipboardTick.value
  return Boolean(sharedClipboard)
})

function objectContentPreview(item: DraftItem): string {
  const obj = buildObjectValue(item.objectFields ?? [])
  try {
    return JSON.stringify(obj)
  } catch {
    return '{}'
  }
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
  if (mode.value === 'code') return
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

function syncCodeFromVisual() {
  const arr = buildArrayValue(draft.value.map((item) => toArraySubField(item)))
  try {
    codeText.value = JSON.stringify(arr, null, 2)
  } catch {
    codeText.value = '[]'
  }
}

function parseCodeJson(): unknown[] | null {
  const raw = codeText.value.trim()
  if (!raw) {
    ElMessage.error('JSON 不能为空')
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '语法错误'
    ElMessage.error(`JSON 语法错误：${msg}`)
    return null
  }
  if (!Array.isArray(parsed)) {
    ElMessage.error('代码模式需要 JSON 数组（例如 [{ "id": "" }]）')
    return null
  }
  const typeErrors = validateJsonAgainstSchema(parsed, codeSchema.value)
  if (typeErrors.length) {
    ElMessage.error(typeErrors.slice(0, 3).join('；'))
    return null
  }
  return parsed
}

function applyCodeToVisual(): boolean {
  const parsed = parseCodeJson()
  if (!parsed) return false
  draft.value = valueToArrayFields(parsed).map((item) => toDraftItem(item))
  dragIndex.value = -1
  selectedIndex.value = draft.value.length ? 0 : -1
  return true
}

function switchMode(next: EditorMode) {
  if (next === mode.value) return
  if (mode.value === 'code' && next === 'visual') {
    if (!applyCodeToVisual()) return
  } else if (mode.value === 'visual' && next === 'code') {
    syncCodeFromVisual()
  }
  mode.value = next
}

function handleSave() {
  if (mode.value === 'code') {
    if (!applyCodeToVisual()) return
  }
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
    <div class="dialog-toolbar">
      <p class="hint">
        <template v-if="itemTypeLocked">
          元素类型已固定为「{{ lockedTypeLabel }}」，可编辑各项数据值并拖动排序；选中项后可用 Ctrl+C /
          Ctrl+V 复制粘贴
        </template>
        <template v-else>
          按顺序定义数组每一项的类型与数据值，可拖动排序；选中项后可用 Ctrl+C / Ctrl+V 复制粘贴
        </template>
      </p>
      <div class="mode-tabs" role="tablist">
        <el-tooltip content="可视化模式" placement="top">
          <button
            type="button"
            class="mode-tab"
            :class="{ active: mode === 'visual' }"
            role="tab"
            :aria-selected="mode === 'visual'"
            @click="switchMode('visual')"
          >
            <el-icon :size="16"><Monitor /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="代码模式" placement="top">
          <button
            type="button"
            class="mode-tab"
            :class="{ active: mode === 'code' }"
            role="tab"
            :aria-selected="mode === 'code'"
            @click="switchMode('code')"
          >
            <el-icon :size="16"><Document /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>

    <template v-if="mode === 'visual'">
      <div class="field-list">
        <div
          v-for="(item, index) in draft"
          :key="item.key"
          class="field-row"
          :class="{
            dragging: dragIndex === index,
            selected: selectedIndex === index,
            'no-type': itemTypeLocked,
          }"
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
          <DataFieldTypeTreeSelect
            v-if="!itemTypeLocked"
            :type="item.type"
            :type-ref="item.typeRef"
            :item-type="item.itemType"
            :item-type-ref="item.itemTypeRef"
            :library="typeLibrary"
            composable
            @change="handleTypeChange(item, $event)"
          />
          <div class="value-cell">
            <el-input
              v-if="item.type === 'string' || item.type === 'any'"
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
            <ColorPicker
              v-else-if="item.type === 'color'"
              :model-value="String(item.value ?? '')"
              placeholder="#409eff / rgba(...)"
              @update:model-value="item.value = $event"
            />
            <div v-else-if="item.type === 'resource'" class="resource-value">
              <el-input
                :model-value="String(item.value ?? '')"
                clearable
                placeholder="资源外链 URI"
                @update:model-value="item.value = $event"
              />
              <el-button type="primary" link @click.stop="openOssPicker(item.key)">
                对象存储
              </el-button>
            </div>
            <div v-else-if="item.type === 'json'" class="complex-value object-value">
              <div class="object-preview" :title="objectContentPreview(item)">
                <code class="object-preview-json">{{ objectContentPreview(item) }}</code>
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
    </template>

    <div v-else class="code-panel">
      <JsonCodeEditor v-model="codeText" :schema="codeSchema" :min-height="320" />
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="editingObjectFields"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :type-ref="editingObjectTypeRef"
      :schema-locked="editingObjectSchemaLocked"
      :project-path="projectPath"
      @save="saveObjectFields"
    />
    <ArrayFieldsDialog
      v-model="nestedDialogVisible"
      :fields="editingNestedFields"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :default-item-type="findDraftItem(nestedEditingKey)?.itemType"
      :default-item-type-ref="findDraftItem(nestedEditingKey)?.itemTypeRef"
      :project-path="projectPath"
      @save="saveNestedArrayFields"
    />
    <OssResourcePickerDialog
      v-model="ossPickerVisible"
      :project-path="projectPath"
      @confirm="onOssPicked"
    />
  </el-dialog>
</template>

<style scoped>
.dialog-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.hint {
  margin: 0;
  flex: 1;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.mode-tabs {
  display: inline-flex;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #f5f7fa;
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #909399;
  cursor: pointer;
}

.mode-tab:hover {
  color: #409eff;
}

.mode-tab.active {
  background: #fff;
  color: #409eff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.field-row {
  display: grid;
  grid-template-columns: 24px minmax(180px, 240px) 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  cursor: default;
}

.field-row.no-type {
  grid-template-columns: 24px 1fr auto;
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

.resource-value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
}

.resource-value .el-input {
  flex: 1;
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

.object-preview-json {
  display: block;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #334155;
  line-height: 1.4;
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

.code-panel {
  min-height: 320px;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>
