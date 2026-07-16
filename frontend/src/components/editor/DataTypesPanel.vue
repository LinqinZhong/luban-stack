<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, EditPen, Plus, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import TypeConfigDialog from './TypeConfigDialog.vue'
import TypeTsEditDialog from './TypeTsEditDialog.vue'
import {
  createEmptyDataType,
  createEmptyDataTypeGroup,
  DATA_TYPE_KIND_OPTIONS,
  isValidGroupName,
  isValidTypeName,
  kindNeedsConfig,
  type DataTypeDef,
  type DataTypeGroup,
  type DataTypeKind,
  type DataTypeLibrary,
} from '../../types/data-types'

const props = defineProps<{
  library: DataTypeLibrary
}>()

const emit = defineEmits<{
  'update:library': [library: DataTypeLibrary]
}>()

const groups = computed({
  get: () => props.library.groups,
  set(value: DataTypeGroup[]) {
    emit('update:library', { groups: value })
  },
})

const activeGroupId = ref('')
const configVisible = ref(false)
const tsEditVisible = ref(false)
const editingTypeIndex = ref(-1)
const tsEditingTypeIndex = ref(-1)

watch(
  groups,
  (list) => {
    if (!list.length) {
      activeGroupId.value = ''
      return
    }
    if (!list.some((g) => g.id === activeGroupId.value)) {
      activeGroupId.value = list[0]!.id
    }
  },
  { immediate: true, deep: true },
)

const activeGroup = computed(
  () => groups.value.find((g) => g.id === activeGroupId.value) ?? null,
)

const activeTypes = computed(() => activeGroup.value?.types ?? [])

const namedOptions = computed(() => {
  const options: Array<{ id: string; label: string }> = []
  for (const group of groups.value) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
      // 配置弹窗中排除正在编辑的自身，避免自引用误导（仍允许，但标注分组）
      options.push({
        id: t.id,
        label: `${t.name}（${group.name}）`,
      })
    }
  }
  return options
})

const editingType = computed(() => {
  if (!activeGroup.value || editingTypeIndex.value < 0) return null
  return activeGroup.value.types[editingTypeIndex.value] ?? null
})

const tsEditingType = computed(() => {
  if (!activeGroup.value || tsEditingTypeIndex.value < 0) return null
  return activeGroup.value.types[tsEditingTypeIndex.value] ?? null
})

function setGroups(next: DataTypeGroup[]) {
  groups.value = next
}

function updateActiveGroup(patch: Partial<DataTypeGroup>) {
  if (!activeGroup.value) return
  setGroups(
    groups.value.map((g) =>
      g.id === activeGroup.value!.id ? { ...g, ...patch } : g,
    ),
  )
}

function updateType(index: number, patch: Partial<DataTypeDef>) {
  if (!activeGroup.value) return
  const types = activeGroup.value.types.map((t, i) =>
    i === index ? { ...t, ...patch } : t,
  )
  updateActiveGroup({ types })
}

function addGroup() {
  void promptAddGroup()
}

async function promptAddGroup() {
  let name = ''
  try {
    const result = await ElMessageBox.prompt(
      '分组名仅允许纯英文（字母开头），将保存为 types/{名称}.json',
      '添加分组',
      {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        inputPlaceholder: '如 Goods',
        inputPattern: /^[A-Za-z][A-Za-z0-9_]*$/,
        inputErrorMessage: '仅允许纯英文：字母开头，字母/数字/下划线',
      },
    )
    name = String(result.value ?? '').trim()
  } catch {
    return
  }
  if (!isValidGroupName(name)) {
    ElMessage.error('分组名不合法')
    return
  }
  if (groups.value.some((g) => g.name === name)) {
    ElMessage.error(`分组「${name}」已存在`)
    return
  }
  const group = createEmptyDataTypeGroup(name)
  setGroups([...groups.value, group])
  activeGroupId.value = group.id
}

async function removeGroup(group: DataTypeGroup) {
  try {
    await ElMessageBox.confirm(
      `确定删除分组「${group.name}」及其下全部类型吗？对应文件 types/${group.name}.json 将一并删除。`,
      '删除分组',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setGroups(groups.value.filter((g) => g.id !== group.id))
}

function renameGroup(group: DataTypeGroup, name: string) {
  const next = name.trim()
  if (!isValidGroupName(next)) {
    ElMessage.warning('分组名仅允许纯英文（字母开头，字母/数字/下划线）')
    return
  }
  if (groups.value.some((g) => g.id !== group.id && g.name === next)) {
    ElMessage.warning(`分组「${next}」已存在`)
    return
  }
  setGroups(
    groups.value.map((g) => (g.id === group.id ? { ...g, name: next } : g)),
  )
}

function addType() {
  if (!activeGroup.value) {
    ElMessage.warning('请先创建分组')
    return
  }
  void promptAddType()
}

async function promptAddType() {
  if (!activeGroup.value) return
  let name = ''
  try {
    const result = await ElMessageBox.prompt('类型名创建后不可修改', '添加类型', {
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      inputPlaceholder: '如 GoodsItem',
      inputPattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      inputErrorMessage: '需以字母或下划线开头，仅含字母数字下划线',
    })
    name = String(result.value ?? '').trim()
  } catch {
    return
  }
  if (!name || !isValidTypeName(name)) {
    ElMessage.error('类型名不合法')
    return
  }
  const exists = groups.value.some((g) =>
    g.types.some((t) => t.name === name),
  )
  if (exists) {
    ElMessage.error(`类型名「${name}」已存在`)
    return
  }
  const next = createEmptyDataType('string')
  next.name = name
  updateActiveGroup({ types: [...activeGroup.value!.types, next] })
}

async function removeType(index: number) {
  if (!activeGroup.value) return
  const t = activeGroup.value.types[index]
  try {
    await ElMessageBox.confirm(
      `确定删除类型「${t?.name || '未命名'}」吗？`,
      '删除类型',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  updateActiveGroup({
    types: activeGroup.value.types.filter((_, i) => i !== index),
  })
}

function handleKindChange(index: number, kind: DataTypeKind) {
  updateType(index, { kind })
  if (kindNeedsConfig(kind)) {
    openConfig(index)
  }
}

function openConfig(index: number) {
  const t = activeTypes.value[index]
  if (!t || !kindNeedsConfig(t.kind)) return
  if (t.name.trim() && !isValidTypeName(t.name.trim())) {
    ElMessage.warning('请先填写合法的类型名（字母/下划线开头）')
    return
  }
  editingTypeIndex.value = index
  configVisible.value = true
}

function saveConfig(def: DataTypeDef) {
  if (editingTypeIndex.value < 0 || !activeGroup.value) return
  const prev = activeGroup.value.types[editingTypeIndex.value]
  updateType(editingTypeIndex.value, {
    ...def,
    name: prev?.name ?? def.name,
  })
  editingTypeIndex.value = -1
}

function openTsEdit(index: number) {
  const t = activeTypes.value[index]
  if (!t) return
  if (!t.name.trim()) {
    ElMessage.warning('请先填写类型名')
    return
  }
  if (!isValidTypeName(t.name.trim())) {
    ElMessage.warning('类型名需以字母或下划线开头')
    return
  }
  tsEditingTypeIndex.value = index
  tsEditVisible.value = true
}

function saveTsEdit(def: DataTypeDef) {
  if (tsEditingTypeIndex.value < 0 || !activeGroup.value) return
  const prev = activeGroup.value.types[tsEditingTypeIndex.value]
  // 类型名禁止修改
  updateType(tsEditingTypeIndex.value, {
    ...def,
    name: prev?.name ?? def.name,
  })
  tsEditingTypeIndex.value = -1
}

const namedOptionsForConfig = computed(() => {
  const editingId = editingType.value?.id
  return namedOptions.value.filter((o) => o.id !== editingId)
})
</script>

<template>
  <div class="data-types">
    <div class="data-types-body">
      <aside class="group-pane">
        <div class="pane-head">
          <span class="pane-title">分组</span>
          <el-button type="primary" link :icon="Plus" @click="addGroup">添加</el-button>
        </div>
        <el-empty
          v-if="!groups.length"
          description="先创建分组"
          :image-size="56"
        />
        <ul v-else class="group-list">
          <li
            v-for="group in groups"
            :key="group.id"
            class="group-item"
            :class="{ active: group.id === activeGroupId }"
            @click="activeGroupId = group.id"
          >
            <el-input
              :model-value="group.name"
              size="small"
              class="group-name-input"
              placeholder="English"
              @click.stop
              @update:model-value="renameGroup(group, $event)"
            />
            <span class="group-count">{{ group.types.length }}</span>
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click.stop="removeGroup(group)"
            />
          </li>
        </ul>
      </aside>

      <section class="type-pane">
        <div class="pane-head">
          <span class="pane-title">类型定义</span>
          <el-button
            type="primary"
            link
            :icon="Plus"
            :disabled="!activeGroup"
            @click="addType"
          >
            添加
          </el-button>
        </div>

        <el-empty
          v-if="!activeGroup"
          description="请选择或创建左侧分组"
          :image-size="64"
        />
        <div v-else class="type-table">
          <el-table
            :data="activeTypes"
            border
            stripe
            empty-text="该分组暂无类型，点击添加"
          >
            <el-table-column label="类型名" min-width="140">
              <template #default="{ row }">
                <span class="type-name-locked" :title="'类型名不可修改'">{{ row.name }}</span>
              </template>
            </el-table-column>

            <el-table-column label="数据类型" width="140">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="row.kind"
                  @update:model-value="handleKindChange($index, $event)"
                >
                  <el-option
                    v-for="opt in DATA_TYPE_KIND_OPTIONS"
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
                  @update:model-value="updateType($index, { remark: $event })"
                />
              </template>
            </el-table-column>

            <el-table-column label="配置" width="100" align="center">
              <template #default="{ row, $index }">
                <el-button
                  v-if="kindNeedsConfig(row.kind)"
                  type="primary"
                  link
                  :icon="Setting"
                  @click="openConfig($index)"
                >
                  配置
                </el-button>
                <span v-else class="cfg-na">—</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="120" align="center">
              <template #default="{ $index }">
                <el-button
                  type="primary"
                  link
                  :icon="EditPen"
                  @click="openTsEdit($index)"
                >
                  编辑
                </el-button>
                <el-button
                  type="danger"
                  link
                  :icon="Delete"
                  @click="removeType($index)"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <TypeConfigDialog
      v-model="configVisible"
      :type-def="editingType"
      :named-options="namedOptionsForConfig"
      @save="saveConfig"
    />
    <TypeTsEditDialog
      v-model="tsEditVisible"
      :type-def="tsEditingType"
      :library="library"
      @save="saveTsEdit"
    />
  </div>
</template>

<style scoped>
.data-types {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.data-types-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  overflow: hidden;
}

.group-pane,
.type-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.group-pane {
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

.type-name-locked {
  display: inline-block;
  font-size: 13px;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.group-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  flex: 1;
}

.group-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}

.group-item:hover {
  background: #f1f5f9;
}

.group-item.active {
  background: #ecf5ff;
  border-color: #b3d8ff;
}

.group-name-input {
  flex: 1;
  min-width: 0;
}

.group-name-input :deep(.el-input__wrapper) {
  box-shadow: none;
  background: transparent;
  padding-left: 4px;
}

.group-count {
  font-size: 11px;
  color: #94a3b8;
  min-width: 16px;
  text-align: center;
}

.type-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.cfg-na {
  color: #c0c4cc;
}

:deep(.el-table) {
  width: 100%;
}
</style>
