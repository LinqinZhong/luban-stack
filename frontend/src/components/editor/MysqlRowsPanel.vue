<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteMysqlTableRow,
  insertMysqlTableRow,
  listMysqlTableRows,
  resolveMysqlTableSchema,
  updateMysqlTableRow,
} from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlTableInfo,
} from '../../types/mysql'
import { isMysqlResourceColumn } from '../../utils/mysql-common-types'
import type { OssBindingConfig } from '../../types/page-data'
import BackLink from './BackLink.vue'
import OssResourcePickerDialog from './OssResourcePickerDialog.vue'
import MysqlSchemaConflictDialog from './MysqlSchemaConflictDialog.vue'

const props = defineProps<{
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo
  projectPath?: string | null
}>()

const emit = defineEmits<{
  back: []
}>()

const loading = ref(false)
const saving = ref(false)
const columns = ref<MysqlColumnDef[]>([])
const keyColumns = ref<string[]>([])
const keyName = ref<string | null>(null)
const rows = ref<Record<string, unknown>[]>([])
const total = ref(0)
const current = ref(1)
const pageSize = ref(20)

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('edit')
const formTitle = ref('编辑行')
const editingKey = ref<Record<string, unknown> | null>(null)
const editForm = reactive<Record<string, string>>({})

const ossPickerVisible = ref(false)
const ossPickerColumn = ref('')
const conflictVisible = ref(false)
const resolving = ref(false)
const conflictLocal = ref<MysqlColumnDef[]>([])
const conflictRemote = ref<MysqlColumnDef[]>([])

const canMutate = computed(() => keyColumns.value.length > 0)
const keyColumnSet = computed(() => new Set(keyColumns.value))
const autoIncrementSet = computed(
  () => new Set(columns.value.filter((c) => c.autoIncrement).map((c) => c.name)),
)

function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function cellInputType(col: MysqlColumnDef): string {
  const t = col.type.toLowerCase()
  if (t.includes('text') || t.includes('json') || t.includes('blob')) return 'textarea'
  return 'text'
}

function pickKey(row: Record<string, unknown>): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const col of keyColumns.value) {
    key[col] = row[col] ?? null
  }
  return key
}

function toEditString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function parseEditValue(col: MysqlColumnDef, raw: string): unknown {
  const text = raw
  if (text === '' && (col.nullable || col.autoIncrement)) return null
  const t = col.type.toLowerCase()
  if (t.startsWith('tinyint(1)') || t === 'boolean' || t === 'bool') {
    if (text === 'true' || text === '1') return 1
    if (text === 'false' || text === '0') return 0
  }
  if (
    t.includes('int') ||
    t.includes('decimal') ||
    t.includes('float') ||
    t.includes('double') ||
    t.includes('numeric')
  ) {
    if (text.trim() === '') return col.nullable || col.autoIncrement ? null : 0
    const n = Number(text)
    if (!Number.isFinite(n)) throw new Error(`列「${col.name}」不是合法数字`)
    return n
  }
  if (t.includes('json')) {
    if (text.trim() === '') return null
    return JSON.parse(text)
  }
  return text
}

function resetForm() {
  for (const key of Object.keys(editForm)) delete editForm[key]
  for (const col of columns.value) {
    editForm[col.name] = col.autoIncrement ? '' : toEditString(col.defaultValue)
  }
}

async function loadRows() {
  if (!props.connection || !props.table?.name) return
  loading.value = true
  try {
    const result = await listMysqlTableRows({
      ...props.connection,
      tableName: props.table.name,
      current: current.value,
      pageSize: pageSize.value,
      projectPath: props.projectPath || undefined,
    })
    columns.value = result.columns
    keyColumns.value = result.keyColumns
    keyName.value = result.keyName
    rows.value = result.rows
    total.value = result.total
    current.value = result.current
    pageSize.value = result.pageSize
    if (result.conflict && result.local) {
      conflictLocal.value = result.local
      conflictRemote.value = result.remote
      conflictVisible.value = true
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    loading.value = false
  }
}

async function handleConflictAdopt(side: 'local' | 'remote') {
  if (!props.connection || !props.table?.name || !props.projectPath) {
    ElMessage.error('缺少项目路径，无法解决冲突')
    return
  }
  resolving.value = true
  try {
    await resolveMysqlTableSchema({
      ...props.connection,
      tableName: props.table.name,
      projectPath: props.projectPath,
      adopt: side,
    })
    conflictVisible.value = false
    ElMessage.success(
      side === 'local' ? '已采用本地结构并推送到数据库' : '已采用数据库结构并写入本地',
    )
    await loadRows()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '解决冲突失败')
  } finally {
    resolving.value = false
  }
}

function openCreate() {
  formMode.value = 'create'
  formTitle.value = '添加行'
  editingKey.value = null
  resetForm()
  formVisible.value = true
}

function openEdit(row: Record<string, unknown>) {
  formMode.value = 'edit'
  formTitle.value = '编辑行'
  editingKey.value = pickKey(row)
  for (const col of columns.value) {
    editForm[col.name] = toEditString(row[col.name])
  }
  formVisible.value = true
}

/** 复制为新行：带出字段值；自增/主键列留空，避免冲突 */
function openCopy(row: Record<string, unknown>) {
  formMode.value = 'create'
  formTitle.value = '复制行'
  editingKey.value = null
  for (const col of columns.value) {
    if (col.autoIncrement || keyColumnSet.value.has(col.name)) {
      editForm[col.name] = ''
      continue
    }
    editForm[col.name] = toEditString(row[col.name])
  }
  formVisible.value = true
}

function isFieldDisabled(col: MysqlColumnDef): boolean {
  if (formMode.value === 'edit') return keyColumnSet.value.has(col.name)
  return col.autoIncrement
}

function openOssPickerForColumn(col: MysqlColumnDef) {
  if (isFieldDisabled(col)) return
  ossPickerColumn.value = col.name
  ossPickerVisible.value = true
}

function onOssPicked(config: OssBindingConfig) {
  const col = ossPickerColumn.value
  if (!col) return
  editForm[col] = config.url
}

async function saveForm() {
  if (!props.connection || !props.table?.name) return
  const values: Record<string, unknown> = {}
  try {
    for (const col of columns.value) {
      if (formMode.value === 'edit' && keyColumnSet.value.has(col.name)) continue
      if (formMode.value === 'create' && autoIncrementSet.value.has(col.name)) {
        const raw = (editForm[col.name] ?? '').trim()
        if (!raw) continue
      }
      values[col.name] = parseEditValue(col, editForm[col.name] ?? '')
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '字段格式错误')
    return
  }

  saving.value = true
  try {
    if (formMode.value === 'create') {
      await insertMysqlTableRow({
        ...props.connection,
        tableName: props.table.name,
        values,
      })
      ElMessage.success('已添加')
      current.value = 1
    } else {
      if (!editingKey.value) return
      await updateMysqlTableRow({
        ...props.connection,
        tableName: props.table.name,
        key: editingKey.value,
        values,
      })
      ElMessage.success('已保存')
    }
    formVisible.value = false
    await loadRows()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function removeRow(row: Record<string, unknown>) {
  if (!props.connection || !props.table?.name) return
  const key = pickKey(row)
  const label = keyColumns.value.map((c) => `${c}=${formatCell(key[c])}`).join(', ')
  try {
    await ElMessageBox.confirm(
      `确定删除该行吗？\n${label}`,
      '删除行',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  loading.value = true
  try {
    await deleteMysqlTableRow({
      ...props.connection,
      tableName: props.table.name,
      key,
    })
    ElMessage.success('已删除')
    if (rows.value.length <= 1 && current.value > 1) {
      current.value -= 1
    }
    await loadRows()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    loading.value = false
  }
}

function onPageChange(page: number) {
  current.value = page
  void loadRows()
}

function onSizeChange(size: number) {
  pageSize.value = size
  current.value = 1
  void loadRows()
}

watch(
  () => [props.table?.name, props.connection?.database] as const,
  () => {
    columns.value = []
    keyColumns.value = []
    keyName.value = null
    rows.value = []
    total.value = 0
    current.value = 1
    pageSize.value = 20
    formVisible.value = false
    void loadRows()
  },
  { immediate: true },
)
</script>

<template>
  <div v-loading="loading" class="rows-panel">
    <div class="pane-head">
      <BackLink @click="emit('back')" />
      <span class="pane-title">数据表 / {{ table.name }}</span>
      <span class="pane-sub">
        <template v-if="canMutate">
          唯一键：{{ keyName === 'PRIMARY' ? '主键' : keyName }}（{{
            keyColumns.join(', ')
          }}）
        </template>
        <template v-else>未设计唯一键，仅可浏览与添加</template>
      </span>
      <el-button type="primary" link :icon="Refresh" @click="loadRows">
        刷新
      </el-button>
      <el-button type="primary" link :icon="Plus" @click="openCreate">
        添加
      </el-button>
    </div>

    <div class="rows-body">
      <el-table
        :data="rows"
        border
        stripe
        height="100%"
        empty-text="暂无数据"
        class="rows-table"
      >
        <el-table-column
          v-for="col in columns"
          :key="col.name"
          :prop="col.name"
          :label="col.name"
          min-width="120"
          show-overflow-tooltip
        >
          <template #header>
            <span>{{ col.name }}</span>
            <span v-if="keyColumnSet.has(col.name)" class="key-tag">键</span>
            <span
              v-if="isMysqlResourceColumn(col)"
              class="resource-tag"
            >
              资源
            </span>
          </template>
          <template #default="{ row }">
            {{ formatCell(row[col.name]) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          :width="canMutate ? 160 : 80"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button type="primary" link @click="openCopy(row)">复制</el-button>
            <template v-if="canMutate">
              <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
              <el-button type="danger" link @click="removeRow(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <div class="rows-pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="total"
          :current-page="current"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="formVisible"
      :title="formTitle"
      width="560px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="110px" class="edit-form">
        <el-form-item
          v-for="col in columns"
          :key="col.name"
          :label="col.name"
        >
          <div
            v-if="isMysqlResourceColumn(col)"
            class="resource-field"
          >
            <el-input
              v-model="editForm[col.name]"
              :disabled="isFieldDisabled(col)"
              placeholder="资源外链 URI"
            />
            <el-button
              type="primary"
              link
              :disabled="isFieldDisabled(col)"
              @click="openOssPickerForColumn(col)"
            >
              对象存储
            </el-button>
          </div>
          <el-input
            v-else
            v-model="editForm[col.name]"
            :type="cellInputType(col)"
            :rows="cellInputType(col) === 'textarea' ? 3 : undefined"
            :disabled="isFieldDisabled(col)"
            :placeholder="
              col.autoIncrement && formMode === 'create'
                ? `${col.type} · 自增可留空`
                : col.type
            "
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">
          {{ formMode === 'create' ? '添加' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <OssResourcePickerDialog
      v-model="ossPickerVisible"
      :project-path="projectPath"
      @confirm="onOssPicked"
    />
    <MysqlSchemaConflictDialog
      v-model="conflictVisible"
      :table-name="table.name"
      :local="conflictLocal"
      :remote="conflictRemote"
      :resolving="resolving"
      @adopt="handleConflictAdopt"
    />
  </div>
</template>

<style scoped>
.rows-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
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

.pane-sub {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
  overflow: hidden;
}

.rows-table {
  flex: 1;
  min-height: 0;
}

.key-tag,
.resource-tag {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 11px;
}

.key-tag {
  background: #ecfdf5;
  color: #059669;
}

.resource-tag {
  background: #eff6ff;
  color: #2563eb;
}

.resource-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.resource-field .el-input {
  flex: 1;
  min-width: 0;
}

.rows-pager {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}

.edit-form {
  max-height: 60vh;
  overflow: auto;
}
</style>
