<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  ARRAY_ITEM_TYPE_OPTIONS,
  createEditorNode,
  defaultValue,
  editorNodeTreeLabel,
  editorNodesToObjectFields,
  objectFieldsToEditorNodes,
  type DataFieldType,
  type ObjectEditorNode,
  type ObjectSubField,
} from '../../types/page-data'
import IconValueSelect from './IconValueSelect.vue'

/** 对象内字段类型（含图标；不含嵌套对象） */
const OBJECT_FIELD_TYPE_OPTIONS: Array<{ label: string; value: DataFieldType }> = [
  { label: '字符串', value: 'string' },
  { label: '数值', value: 'number' },
  { label: '布尔值', value: 'boolean' },
  { label: '图标', value: 'icon' },
  { label: '数组', value: 'array' },
]

interface TreeItem {
  key: string
  label: string
  children?: TreeItem[]
}

const props = defineProps<{
  modelValue: boolean
  fields: ObjectSubField[]
  iconOptions?: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [fields: ObjectSubField[]]
}>()

const roots = ref<ObjectEditorNode[]>([])
const selectedKey = ref('')

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    roots.value = objectFieldsToEditorNodes(props.fields)
    if (!roots.value.length) {
      roots.value.push(createEditorNode(false))
    }
    selectedKey.value = roots.value[0]?.key ?? ''
  },
  { immediate: true },
)

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

/** 对象内字段 / 数组项各自的类型列表（显式含「图标」） */
const typeOptions = computed(() => {
  if (selectedNode.value?.isArrayItem) return ARRAY_ITEM_TYPE_OPTIONS
  return OBJECT_FIELD_TYPE_OPTIONS
})

const canAddChild = computed(() => {
  const node = selectedNode.value
  if (!node) return false
  if (node.type === 'array') return true
  return node.isArrayItem && node.type === 'json'
})

function close() {
  emit('update:modelValue', false)
}

function addRootField() {
  const node = createEditorNode(false)
  roots.value.push(node)
  selectedKey.value = node.key
}

function addChild() {
  const parent = selectedNode.value
  if (!parent) return
  if (parent.type === 'array') {
    const child = createEditorNode(true)
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

function handleTypeChange(type: ObjectEditorNode['type']) {
  const node = selectedNode.value
  if (!node) return
  node.type = type
  node.value = defaultValue(type)
  node.children = type === 'array' || type === 'json' ? [] : []
}

function handleSave() {
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
  >
    <div class="editor-layout">
      <div class="tree-panel">
        <div class="tree-toolbar">
          <el-button type="primary" link :icon="Plus" @click="addRootField">添加字段</el-button>
          <el-button type="primary" link :icon="Plus" :disabled="!canAddChild" @click="addChild">
            添加子项
          </el-button>
          <el-button type="danger" link :icon="Delete" :disabled="!selectedKey" @click="removeSelected">
            删除
          </el-button>
        </div>
        <el-tree
          :data="treeData"
          node-key="key"
          highlight-current
          :current-node-key="selectedKey"
          default-expand-all
          @node-click="(data: TreeItem) => (selectedKey = data.key)"
        />
      </div>

      <div v-if="selectedNode" class="props-panel">
        <div class="props-title">字段属性</div>

        <template v-if="!selectedNode.isArrayItem">
          <div class="field-row">
            <label>字段名</label>
            <el-input v-model="selectedNode.name" placeholder="字段名" />
          </div>
        </template>

        <div class="field-row">
          <label>数据类型</label>
          <el-select
            :model-value="selectedNode.type"
            placeholder="选择类型"
            @update:model-value="handleTypeChange"
          >
            <el-option
              v-for="opt in typeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>

        <el-alert
          v-if="selectedNode.type === 'json' && !selectedNode.isArrayItem"
          type="warning"
          :closable="false"
          title="嵌套对象类型已不支持，请改选其他数据类型"
          show-icon
          class="legacy-alert"
        />

        <div v-if="selectedNode.type === 'string'" class="field-row">
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
        <div v-else-if="selectedNode.type === 'icon'" class="field-row">
          <label>数据值</label>
          <IconValueSelect
            :model-value="String(selectedNode.value ?? '')"
            :options="iconOptions"
            @update:model-value="selectedNode.value = $event"
          />
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

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
