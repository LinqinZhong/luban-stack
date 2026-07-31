<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Document, Monitor, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  buildObjectValue,
  createEditorNode,
  defaultValue,
  editorNodeTreeLabel,
  editorNodesToObjectFields,
  objectFieldsToEditorNodes,
  typeLabel,
  valueToObjectFields,
  type ObjectEditorNode,
  type ObjectSubField,
  type OssBindingConfig,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import { objectFieldsFromTypeRef } from '../../utils/named-type-fields'
import {
  buildObjectJsonSchema,
  validateJsonAgainstSchema,
} from '../../utils/json-type-schema'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import DateTimeValueInput from './DateTimeValueInput.vue'
import DataFieldTypeTreeSelect, { type TypeSelectPayload } from './DataFieldTypeTreeSelect.vue'
import JsonCodeEditor from './JsonCodeEditor.vue'
import OssResourcePickerDialog from './OssResourcePickerDialog.vue'

type EditorMode = 'visual' | 'code'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    fields: ObjectSubField[]
    iconOptions?: Array<{ id: string; label: string }>
    typeLibrary?: DataTypeLibrary | null
    /** 具名类型 id：有值时按类型字段锁定结构 */
    typeRef?: string | null
    /** 按具名类型给定字段：只改值，不可增删/改类型 */
    schemaLocked?: boolean
    /** 项目路径：对象存储资源选择 */
    projectPath?: string | null
  }>(),
  { schemaLocked: false, typeRef: '' },
)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [fields: ObjectSubField[]]
}>()

interface TreeItem {
  key: string
  label: string
  children?: TreeItem[]
}

const roots = ref<ObjectEditorNode[]>([])
const selectedKey = ref('')
const mode = ref<EditorMode>('visual')
const codeText = ref('{}')

const isSchemaLocked = computed(
  () => Boolean(props.schemaLocked) || Boolean(props.typeRef?.trim()),
)

const codeSchema = computed(() =>
  buildObjectJsonSchema({
    typeRef: props.typeRef,
    fields: props.fields,
    library: props.typeLibrary,
    schemaLocked: isSchemaLocked.value,
  }),
)

function loadFromFields(fields: ObjectSubField[]) {
  const typeRef = props.typeRef?.trim()
  const incoming = typeRef
    ? objectFieldsFromTypeRef(typeRef, props.typeLibrary, fields)
    : fields
  roots.value = objectFieldsToEditorNodes(incoming)
  if (!roots.value.length && !isSchemaLocked.value) {
    roots.value.push(createEditorNode(false))
  }
  selectedKey.value = roots.value[0]?.key ?? ''
  syncCodeFromVisual()
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    mode.value = 'visual'
    loadFromFields(props.fields)
  },
  { immediate: true },
)

function syncCodeFromVisual() {
  const obj = buildObjectValue(editorNodesToObjectFields(roots.value))
  try {
    codeText.value = JSON.stringify(obj, null, 2)
  } catch {
    codeText.value = '{}'
  }
}

/** 校验并解析代码模式 JSON；失败返回 null */
function parseCodeJson(): Record<string, unknown> | null {
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    ElMessage.error('代码模式需要 JSON 对象（例如 { "id": "" }）')
    return null
  }
  const typeErrors = validateJsonAgainstSchema(parsed, codeSchema.value)
  if (typeErrors.length) {
    ElMessage.error(typeErrors.slice(0, 3).join('；'))
    return null
  }
  return parsed as Record<string, unknown>
}

function applyCodeToVisual(): boolean {
  const parsed = parseCodeJson()
  if (!parsed) return false
  const fromValue = valueToObjectFields(parsed)
  const typeRef = props.typeRef?.trim()
  const merged = typeRef
    ? objectFieldsFromTypeRef(typeRef, props.typeLibrary, fromValue)
    : fromValue
  roots.value = objectFieldsToEditorNodes(merged)
  if (!roots.value.length && !isSchemaLocked.value) {
    roots.value.push(createEditorNode(false))
  }
  selectedKey.value = roots.value[0]?.key ?? ''
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

function buildTreeItems(nodes: ObjectEditorNode[]): TreeItem[] {
  return nodes.map((node, index) => ({
    key: node.key,
    label: editorNodeTreeLabel(node, index),
    children: node.children.length ? buildTreeItems(node.children) : undefined,
  }))
}

const treeData = computed(() => buildTreeItems(roots.value))

function findNode(key: string, nodes: ObjectEditorNode[] = roots.value): ObjectEditorNode | null {
  for (const node of nodes) {
    if (node.key === key) return node
    const child = findNode(key, node.children)
    if (child) return child
  }
  return null
}

function findParentInfo(
  key: string,
  nodes: ObjectEditorNode[] = roots.value,
  parent: ObjectEditorNode | null = null,
): { parent: ObjectEditorNode | null; list: ObjectEditorNode[]; index: number } | null {
  const index = nodes.findIndex((node) => node.key === key)
  if (index >= 0) return { parent, list: nodes, index }
  for (const node of nodes) {
    const found = findParentInfo(key, node.children, node)
    if (found) return found
  }
  return null
}

const selectedNode = computed(() => (selectedKey.value ? findNode(selectedKey.value) : null))

const canAddChild = computed(() => {
  if (isSchemaLocked.value) return false
  const node = selectedNode.value
  if (!node) return false
  if (node.type === 'array') return true
  return node.isArrayItem && node.type === 'json'
})

function close() {
  emit('update:modelValue', false)
}

function addRootField() {
  if (isSchemaLocked.value) return
  const node = createEditorNode(false)
  roots.value.push(node)
  selectedKey.value = node.key
}

function addChild() {
  if (isSchemaLocked.value) return
  const parent = selectedNode.value
  if (!parent) return
  if (parent.type === 'array') {
    const child = createEditorNode(true)
    if (parent.itemType) {
      child.type = parent.itemType
      child.typeRef = parent.itemTypeRef
      child.value = defaultValue(parent.itemType)
    }
    parent.children.push(child)
    selectedKey.value = child.key
    return
  }
  if (parent.isArrayItem && parent.type === 'json') {
    const child = createEditorNode(false)
    parent.children.push(child)
    selectedKey.value = child.key
  }
}

function removeSelected() {
  if (isSchemaLocked.value) return
  if (!selectedKey.value) return
  const info = findParentInfo(selectedKey.value)
  if (!info) return
  info.list.splice(info.index, 1)
  if (!roots.value.length) {
    const node = createEditorNode(false)
    roots.value.push(node)
    selectedKey.value = node.key
    return
  }
  selectedKey.value = roots.value[0]?.key ?? ''
}

function handleTypeChange(payload: TypeSelectPayload) {
  if (isSchemaLocked.value || payload.cleared || payload.type === 'void' || payload.type === 'generic') {
    return
  }
  const node = selectedNode.value
  if (!node) return
  node.type = payload.type
  node.typeRef = payload.typeRef
  node.value = defaultValue(payload.type)
  node.children = []
  node.itemType =
    payload.type === 'array'
      ? payload.itemType === 'generic'
        ? 'any'
        : payload.itemType || 'string'
      : undefined
  node.itemTypeRef = payload.type === 'array' ? payload.itemTypeRef : undefined
}

const ossPickerVisible = ref(false)

function openOssPicker() {
  if (!props.projectPath?.trim()) {
    ElMessage.warning('未打开项目，无法选择对象存储资源')
    return
  }
  ossPickerVisible.value = true
}

function onOssPicked(config: OssBindingConfig) {
  const node = selectedNode.value
  if (!node || node.type !== 'resource') return
  node.value = (config.url || '').trim()
}

function handleSave() {
  if (mode.value === 'code') {
    if (!applyCodeToVisual()) return
  }
  emit('save', editorNodesToObjectFields(roots.value))
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑对象"
    width="920px"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="dialog-toolbar">
      <p v-if="isSchemaLocked" class="hint">字段来自类型定义，请直接编辑各字段的数据值。</p>
      <p v-else class="hint">可在可视化与代码模式间切换编辑对象。</p>
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

    <div v-show="mode === 'visual'" class="editor-layout">
      <div class="tree-panel">
        <div v-if="!isSchemaLocked" class="tree-toolbar">
          <el-button type="primary" link :icon="Plus" @click="addRootField">添加字段</el-button>
          <el-button type="primary" link :icon="Plus" :disabled="!canAddChild" @click="addChild">
            添加子项
          </el-button>
          <el-button type="danger" link :icon="Delete" :disabled="!selectedKey" @click="removeSelected">
            删除
          </el-button>
        </div>
        <el-empty v-if="!treeData.length" description="类型暂无字段" :image-size="64" />
        <el-tree
          v-else
          :data="treeData"
          node-key="key"
          highlight-current
          :current-node-key="selectedKey"
          default-expand-all
          @node-click="(data: TreeItem) => (selectedKey = data.key)"
        />
      </div>

      <div v-if="selectedNode" class="props-panel">
        <div class="props-title">{{ isSchemaLocked ? '字段值' : '字段属性' }}</div>

        <template v-if="!selectedNode.isArrayItem">
          <div class="field-row">
            <label>字段名</label>
            <el-input
              v-if="!isSchemaLocked"
              v-model="selectedNode.name"
              placeholder="字段名"
            />
            <span v-else class="readonly-text">{{ selectedNode.name || '—' }}</span>
          </div>
        </template>

        <div v-if="!isSchemaLocked" class="field-row">
          <label>数据类型</label>
          <DataFieldTypeTreeSelect
            :type="selectedNode.type"
            :type-ref="selectedNode.typeRef"
            :item-type="selectedNode.itemType"
            :item-type-ref="selectedNode.itemTypeRef"
            :library="typeLibrary"
            :composable="selectedNode.isArrayItem"
            :nested="!selectedNode.isArrayItem"
            @change="handleTypeChange"
          />
        </div>
        <div v-else class="field-row">
          <label>数据类型</label>
          <span class="readonly-text">{{ typeLabel(selectedNode.type) }}</span>
        </div>

        <el-alert
          v-if="!isSchemaLocked && selectedNode.type === 'json' && !selectedNode.isArrayItem"
          type="warning"
          :closable="false"
          title="嵌套对象类型已不支持，请改选其他数据类型"
          show-icon
          class="legacy-alert"
        />

        <div
          v-if="selectedNode.type === 'string' || selectedNode.type === 'any'"
          class="field-row"
        >
          <label>数据值</label>
          <el-input
            :model-value="String(selectedNode.value ?? '')"
            placeholder="数据值"
            @update:model-value="selectedNode.value = $event"
          />
        </div>
        <div v-else-if="selectedNode.type === 'number'" class="field-row">
          <label>数据值</label>
          <el-input-number
            :model-value="Number(selectedNode.value ?? 0)"
            controls-position="right"
            @update:model-value="selectedNode.value = Number($event ?? 0)"
          />
        </div>
        <div v-else-if="selectedNode.type === 'boolean'" class="field-row">
          <label>数据值</label>
          <el-switch
            :model-value="Boolean(selectedNode.value)"
            @update:model-value="selectedNode.value = $event"
          />
        </div>
        <div
          v-else-if="
            selectedNode.type === 'time' ||
            selectedNode.type === 'date' ||
            selectedNode.type === 'datetime'
          "
          class="field-row"
        >
          <label>数据值</label>
          <DateTimeValueInput
            :kind="selectedNode.type"
            :model-value="String(selectedNode.value ?? '')"
            @update:model-value="selectedNode.value = $event"
          />
        </div>
        <div v-else-if="selectedNode.type === 'icon'" class="field-row">
          <label>数据值</label>
          <IconValueSelect
            :model-value="String(selectedNode.value ?? '')"
            :options="iconOptions"
            @update:model-value="selectedNode.value = $event"
          />
        </div>
        <div v-else-if="selectedNode.type === 'color'" class="field-row">
          <label>数据值</label>
          <ColorPicker
            :model-value="String(selectedNode.value ?? '')"
            placeholder="#409eff / rgba(...)"
            @update:model-value="selectedNode.value = $event"
          />
        </div>
        <div v-else-if="selectedNode.type === 'resource'" class="field-row">
          <label>数据值</label>
          <div class="resource-value">
            <el-input
              :model-value="String(selectedNode.value ?? '')"
              clearable
              placeholder="资源外链 URI"
              @update:model-value="selectedNode.value = $event"
            />
            <el-button type="primary" link @click="openOssPicker">对象存储</el-button>
          </div>
        </div>
        <el-alert
          v-else-if="selectedNode.type === 'json'"
          type="info"
          :closable="false"
          title="对象类型的子字段请在左侧树中管理"
          show-icon
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          title="数组类型的子项请在左侧树中管理"
          show-icon
        />
      </div>
    </div>

    <div v-if="mode === 'code'" class="code-panel">
      <JsonCodeEditor v-model="codeText" :schema="codeSchema" :min-height="360" />
    </div>

    <template #footer>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>

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

.readonly-text {
  font-size: 13px;
  color: #334155;
}

.editor-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  min-height: 360px;
}

.tree-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.tree-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.props-panel {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
}

.props-title {
  margin-bottom: 16px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.field-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}

.field-row label {
  font-size: 13px;
  color: #606266;
}

.resource-value {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.resource-value .el-input {
  flex: 1;
  min-width: 0;
}

.code-panel {
  min-height: 360px;
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-tree) {
  background: transparent;
}

.legacy-alert {
  margin-bottom: 14px;
}
</style>
