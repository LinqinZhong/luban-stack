<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  designMysqlTable,
  getMysqlTableColumns,
  resolveMysqlTableSchema,
} from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlTableInfo,
} from '../../types/mysql'
import { MYSQL_COMMON_TYPE_OPTIONS } from '../../utils/mysql-common-types'
import MysqlSchemaConflictDialog from './MysqlSchemaConflictDialog.vue'

const props = defineProps<{
  modelValue: boolean
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
  projectPath?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  saved: [tables: MysqlTableInfo[]]
}>()

const saving = ref(false)
const loading = ref(false)
const showErrors = ref(false)
const conflictVisible = ref(false)
const resolving = ref(false)
const conflictLocal = ref<MysqlColumnDef[]>([])
const conflictRemote = ref<MysqlColumnDef[]>([])

const form = reactive({
  columns: [] as MysqlColumnDef[],
})

function emptyColumn(partial?: Partial<MysqlColumnDef>): MysqlColumnDef {
  return {
    name: '',
    type: 'varchar(255)',
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: '',
    comment: '',
    resource: false,
    ...partial,
  }
}

function onAutoIncrementChange(col: MysqlColumnDef) {
  if (col.autoIncrement) {
    col.primaryKey = true
    col.nullable = false
  }
}

function onPrimaryKeyChange(col: MysqlColumnDef) {
  if (!col.primaryKey) {
    col.autoIncrement = false
  } else {
    col.nullable = false
  }
}

function onResourceChange(col: MysqlColumnDef) {
  if (col.resource && !col.type.trim()) {
    col.type = 'varchar(255)'
  }
}

async function loadColumns() {
  if (!props.connection || !props.table?.name) return
  loading.value = true
  conflictVisible.value = false
  try {
    const result = await getMysqlTableColumns({
      ...props.connection,
      tableName: props.table.name,
      projectPath: props.projectPath || undefined,
    })
    if (result.conflict && result.local) {
      conflictLocal.value = result.local
      conflictRemote.value = result.remote
      conflictVisible.value = true
      form.columns = []
      return
    }
    form.columns = result.columns.length
      ? result.columns.map((c) => ({
          ...c,
          resource: Boolean(c.resource),
          originalName: c.originalName || c.name,
        }))
      : [emptyColumn()]
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载表结构失败')
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
    const result = await resolveMysqlTableSchema({
      ...props.connection,
      tableName: props.table.name,
      projectPath: props.projectPath,
      adopt: side,
    })
    conflictVisible.value = false
    form.columns = result.columns.map((c) => ({
      ...c,
      resource: Boolean(c.resource),
      originalName: c.originalName || c.name,
    }))
    if (side === 'local') {
      ElMessage.success('已采用本地结构并推送到数据库')
    } else {
      ElMessage.success('已采用数据库结构并写入本地')
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '解决冲突失败')
  } finally {
    resolving.value = false
  }
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) {
      conflictVisible.value = false
      return
    }
    showErrors.value = false
    form.columns = []
    await loadColumns()
  },
)

function columnNameError(col: MysqlColumnDef): boolean {
  if (!showErrors.value) return false
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col.name.trim())
}

function addColumn() {
  form.columns.push(emptyColumn())
}

function removeColumn(index: number) {
  if (form.columns.length <= 1) {
    ElMessage.warning('至少保留一列')
    return
  }
  form.columns.splice(index, 1)
}

function validate(): boolean {
  showErrors.value = true
  const names = new Set<string>()
  for (const col of form.columns) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col.name.trim())) {
      ElMessage.error('存在不合法的列名')
      return false
    }
    if (!col.type.trim()) {
      ElMessage.error('请填写列类型')
      return false
    }
    if (names.has(col.name.trim())) {
      ElMessage.error(`列名重复：${col.name}`)
      return false
    }
    names.add(col.name.trim())
  }
  return true
}

function close() {
  emit('update:modelValue', false)
}

async function handleSave() {
  if (!props.connection || !props.table?.name) {
    ElMessage.error('缺少表信息')
    return
  }
  if (!validate()) return

  saving.value = true
  try {
    const result = await designMysqlTable({
      ...props.connection,
      tableName: props.table.name,
      projectPath: props.projectPath || undefined,
      remark: props.table.remark || '',
      columns: form.columns.map((c) => ({
        name: c.name.trim(),
        type: c.type.trim(),
        nullable: c.nullable,
        primaryKey: c.primaryKey,
        autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue,
        comment: c.comment,
        resource: Boolean(c.resource),
        originalName: c.originalName,
      })),
    })
    ElMessage.success('已保存表结构')
    emit('saved', result.tables)
    close()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`设计表 · ${table?.name ?? ''}`"
    width="960px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="design-form">
      <div class="cols-head">
        <span class="cols-title">字段</span>
        <el-button type="primary" link :icon="Plus" @click="addColumn">添加列</el-button>
      </div>

      <div class="cols-table">
        <div class="cols-row cols-header">
          <span>列名</span>
          <span>类型</span>
          <span>资源</span>
          <span>可空</span>
          <span>主键</span>
          <span>自增</span>
          <span>默认值</span>
          <span>备注</span>
          <span />
        </div>
        <div v-for="(col, index) in form.columns" :key="index" class="cols-row">
          <el-input
            v-model="col.name"
            size="small"
            placeholder="name"
            :status="columnNameError(col) ? 'error' : undefined"
          />
          <el-select
            v-model="col.type"
            size="small"
            filterable
            allow-create
            default-first-option
            placeholder="类型"
          >
            <el-option
              v-for="t in MYSQL_COMMON_TYPE_OPTIONS"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
          <el-checkbox
            v-model="col.resource"
            @change="onResourceChange(col)"
          />
          <el-checkbox v-model="col.nullable" />
          <el-checkbox v-model="col.primaryKey" @change="onPrimaryKeyChange(col)" />
          <el-checkbox
            v-model="col.autoIncrement"
            @change="onAutoIncrementChange(col)"
          />
          <el-input v-model="col.defaultValue" size="small" placeholder="—" />
          <el-input v-model="col.comment" size="small" placeholder="—" />
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click="removeColumn(index)"
          />
        </div>
      </div>
      <p class="resource-hint">
        「资源」标记保存在本地 <code>mysql/{{ table?.name || '表名' }}.json</code>，不改变数据库列类型；编辑行时可从对象存储选择外链。
      </p>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <MysqlSchemaConflictDialog
    v-model="conflictVisible"
    :table-name="table?.name || ''"
    :local="conflictLocal"
    :remote="conflictRemote"
    :resolving="resolving"
    @adopt="handleConflictAdopt"
  />
</template>

<style scoped>
.design-form {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cols-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cols-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.cols-table {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.cols-row {
  display: grid;
  grid-template-columns: 1fr 1.1fr 48px 48px 48px 48px 0.85fr 0.85fr 36px;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-top: 1px solid #f0f2f5;
}

.cols-row:first-child {
  border-top: none;
}

.cols-header {
  background: #fafafa;
  font-size: 12px;
  color: #909399;
  font-weight: 500;
}

.cols-row :deep(.el-checkbox) {
  justify-content: center;
  width: 100%;
}

.resource-hint {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.resource-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: #f5f7fa;
}
</style>
