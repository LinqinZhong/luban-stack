<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, EditPen, Plus, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import TypeConfigDialog from './TypeConfigDialog.vue'
import TypeTsEditDialog from './TypeTsEditDialog.vue'
import {
  COMMON_GROUP_NAME,
  createEmptyDataType,
  createEmptyDataTypeGroup,
  DATA_TYPE_CATEGORY_OPTIONS,
  DATA_TYPE_KIND_OPTIONS,
  isSystemCommonType,
  isReservedCommonTypeName,
  isValidGroupName,
  isValidTypeName,
  kindNeedsConfig,
  type DataTypeCategory,
  type DataTypeDef,
  type DataTypeGroup,
  type DataTypeKind,
  type DataTypeLibrary,
} from '../../types/data-types'

const KIND_CATEGORY_CASCADER_OPTIONS = DATA_TYPE_KIND_OPTIONS.map((opt) => {
  if (opt.value !== 'interface') {
    return { value: opt.value, label: opt.label }
  }
  return {
    value: opt.value,
    label: opt.label,
    children: DATA_TYPE_CATEGORY_OPTIONS.map((c) => ({
      value: c.value,
      label: c.label,
    })),
  }
})

function kindCategoryPath(row: DataTypeDef): string[] {
  if (row.kind === 'interface') {
    return ['interface', row.category ?? 'other']
  }
  return [row.kind]
}

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

/** common 分组本身可编辑；仅 4 个系统预设类型只读 */
const isCommonActive = computed(() => isSystemCommonGroup(activeGroup.value))

function isSystemCommonGroup(group: DataTypeGroup | null | undefined): boolean {
  if (!group) return false
  return group.name === COMMON_GROUP_NAME || group.id === 'group_common'
}

function isPresetTypeRow(row: DataTypeDef): boolean {
  return isSystemCommonType(row)
}

const activeTypes = computed(() => activeGroup.value?.types ?? [])

const namedOptions = computed(() => {
  const options: Array<{ id: string; label: string }> = []
  for (const group of groups.value) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
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

const editingTypeReadonly = computed(() =>
  isSystemCommonType(editingType.value),
)

const tsEditingTypeReadonly = computed(() =>
  isSystemCommonType(tsEditingType.value),
)

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
  const current = activeGroup.value.types[index]
  if (!current || isSystemCommonType(current)) return
  if (patch.name != null && isReservedCommonTypeName(String(patch.name))) {
    ElMessage.warning('不能使用系统预设类型名')
    return
  }
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
  if (name === COMMON_GROUP_NAME) {
    ElMessage.error('common 为系统保留分组名')
    return
  }
  const group = createEmptyDataTypeGroup(name)
  setGroups([...groups.value, group])
  activeGroupId.value = group.id
}

async function removeGroup(group: DataTypeGroup) {
  if (group.name === COMMON_GROUP_NAME) {
    ElMessage.warning('系统分组 common 不可删除')
    return
  }
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

async function promptRenameGroup(group: DataTypeGroup) {
  if (group.name === COMMON_GROUP_NAME) {
    ElMessage.warning('系统分组 common 不可重命名')
    return
  }
  let name = group.name
  try {
    const result = await ElMessageBox.prompt('请输入分组名（纯英文）', '重命名分组', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: group.name,
      inputPlaceholder: '如 Goods',
      inputPattern: /^[A-Za-z][A-Za-z0-9_]*$/,
      inputErrorMessage: '仅允许纯英文：字母开头，字母/数字/下划线',
    })
    name = String(result.value ?? '').trim()
  } catch {
    return
  }
  if (!isValidGroupName(name)) {
    ElMessage.error('分组名不合法')
    return
  }
  if (groups.value.some((g) => g.id !== group.id && g.name === name)) {
    ElMessage.error(`分组「${name}」已存在`)
    return
  }
  setGroups(
    groups.value.map((g) => (g.id === group.id ? { ...g, name } : g)),
  )
}

type GroupMenuCommand = 'rename' | 'delete'

function handleGroupMenuCommand(command: GroupMenuCommand, group: DataTypeGroup) {
  if (isSystemCommonGroup(group)) {
    ElMessage.warning('系统分组 common 不可修改')
    return
  }
  if (command === 'rename') void promptRenameGroup(group)
  else if (command === 'delete') void removeGroup(group)
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
    const result = await ElMessageBox.prompt('请输入类型名', '添加类型', {
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
  if (isReservedCommonTypeName(name)) {
    ElMessage.error(`「${name}」为系统预设类型名，不可占用`)
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
  if (!t) return
  if (isSystemCommonType(t)) {
    ElMessage.warning('系统预设类型不可删除')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除类型「${t.name || '未命名'}」吗？`,
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

function handleKindChange(index: number, path: string[] | null | undefined) {
  if (!path?.length) return
  const kind = path[0] as DataTypeKind
  const category: DataTypeCategory =
    kind === 'interface'
      ? ((path[1] as DataTypeCategory | undefined) ?? 'other')
      : 'other'
  updateType(index, {
    kind,
    category,
    ...(category !== 'entity' ? { tableName: '' } : {}),
  })
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
  if (editingTypeIndex.value < 0) return
  updateType(editingTypeIndex.value, def)
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
  if (tsEditingTypeIndex.value < 0) return
  updateType(tsEditingTypeIndex.value, def)
  tsEditingTypeIndex.value = -1
}

function handleNameChange(index: number, name: string) {
  const next = name.trim()
  if (next && !isValidTypeName(next)) {
    ElMessage.warning('类型名需以字母或下划线开头，仅含字母数字下划线')
    return
  }
  if (
    next &&
    groups.value.some((g) =>
      g.types.some((t, i) => {
        if (t.name !== next) return false
        // 排除自身
        return !(g.id === activeGroup.value?.id && i === index)
      }),
    )
  ) {
    ElMessage.warning(`类型名「${next}」已存在`)
    return
  }
  updateType(index, { name: next })
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
          <el-dropdown
            v-for="group in groups"
            :key="group.id"
            trigger="contextmenu"
            class="group-dropdown"
            @command="
              (cmd) => handleGroupMenuCommand(cmd as GroupMenuCommand, group)
            "
          >
            <li
              class="group-item"
              :class="{ active: group.id === activeGroupId }"
              @click="activeGroupId = group.id"
              @contextmenu.prevent
            >
              <span class="group-name" :title="group.name">{{ group.name }}</span>
              <span class="group-count">{{ group.types.length }}</span>
            </li>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="rename"
                  :disabled="isSystemCommonGroup(group)"
                >
                  重命名
                </el-dropdown-item>
                <el-dropdown-item
                  command="delete"
                  divided
                  :disabled="isSystemCommonGroup(group)"
                >
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
          <el-alert
            v-if="isCommonActive"
            type="info"
            :closable="false"
            show-icon
            title="common 中 ResultCode / Result / QueryPageDto / QueryPageVo 为系统预设，不可修改；其余类型可正常编辑"
            class="common-readonly-tip"
          />
          <el-table
            :data="activeTypes"
            border
            stripe
            empty-text="该分组暂无类型，点击添加"
          >
            <el-table-column label="类型名" min-width="200">
              <template #default="{ row, $index }">
                <div class="type-name-cell">
                  <el-input
                    :model-value="row.name"
                    placeholder="如 GoodsItem"
                    :disabled="isPresetTypeRow(row)"
                    @update:model-value="handleNameChange($index, $event)"
                  />
                  <el-button
                    type="primary"
                    link
                    :icon="EditPen"
                    @click="openTsEdit($index)"
                  >
                    {{ isPresetTypeRow(row) ? '查看' : '编辑' }}
                  </el-button>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="数据类型" min-width="200">
              <template #default="{ row, $index }">
                <el-cascader
                  :model-value="kindCategoryPath(row)"
                  :options="KIND_CATEGORY_CASCADER_OPTIONS"
                  :props="{ expandTrigger: 'hover' }"
                  :disabled="isPresetTypeRow(row)"
                  style="width: 100%"
                  @update:model-value="handleKindChange($index, $event)"
                />
              </template>
            </el-table-column>

            <el-table-column label="表名" min-width="120">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.tableName ?? ''"
                  placeholder="可选"
                  clearable
                  :disabled="
                    isPresetTypeRow(row) ||
                    row.kind !== 'interface' ||
                    row.category !== 'entity'
                  "
                  @update:model-value="updateType($index, { tableName: $event })"
                />
              </template>
            </el-table-column>

            <el-table-column label="备注" min-width="140">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.remark"
                  placeholder="备注"
                  :disabled="isPresetTypeRow(row)"
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
                  {{ isPresetTypeRow(row) ? '查看' : '配置' }}
                </el-button>
                <span v-else class="cfg-na">—</span>
              </template>
            </el-table-column>

            <el-table-column label="操作" width="72" align="center">
              <template #default="{ row, $index }">
                <el-button
                  type="danger"
                  link
                  :icon="Delete"
                  :disabled="isPresetTypeRow(row)"
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
      :readonly="editingTypeReadonly"
      @save="saveConfig"
    />
    <TypeTsEditDialog
      v-model="tsEditVisible"
      :type-def="tsEditingType"
      :library="library"
      :readonly="tsEditingTypeReadonly"
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

.type-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.type-name-cell :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.group-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  flex: 1;
}

.group-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.group-dropdown :deep(.el-tooltip__trigger),
.group-dropdown :deep(.el-dropdown__trigger) {
  display: block !important;
  width: 100%;
}

.group-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  list-style: none;
}

.group-item:hover {
  background: #f1f5f9;
}

.group-item.active {
  background: #ecf5ff;
  border-color: #b3d8ff;
}

.group-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  font-size: 11px;
  color: #94a3b8;
  min-width: 1.25em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.type-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.common-readonly-tip {
  flex-shrink: 0;
}

.cfg-na {
  color: #c0c4cc;
}

:deep(.el-table) {
  width: 100%;
}
</style>
