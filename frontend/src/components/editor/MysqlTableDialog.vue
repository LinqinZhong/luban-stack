<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { createMysqlTable, updateMysqlTableMeta } from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlIndexDef,
  MysqlTableDef,
  MysqlTableInfo,
} from '../../types/mysql'
import { MYSQL_COMMON_TYPE_OPTIONS } from '../../utils/mysql-common-types'
import {
  canSetLogicDelete,
  indexableColumnNames,
  secondaryIndexName,
} from '../../utils/mysql-schema'
import { emitMysqlSchemaChanged } from '../../utils/mysql-schema-events'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
  projectPath?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  saved: [tables: MysqlTableInfo[]]
}>()

const saving = ref(false)
const showErrors = ref(false)
const activeTab = ref('columns')

const form = reactive({
  name: '',
  remark: '',
  columns: [] as MysqlColumnDef[],
  indexes: [] as MysqlIndexDef[],
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
    logicDelete: false,
    ...partial,
  }
}

function emptyIndex(partial?: Partial<MysqlIndexDef>): MysqlIndexDef {
  return {
    name: '',
    columns: [],
    remark: '',
    ...partial,
  }
}

const columnSelectOptions = computed(() =>
  indexableColumnNames(form.columns).map((name) => ({
    label: name,
    value: name,
  })),
)

function pruneIndexesForColumn(colName: string) {
  const name = colName.trim()
  if (!name) return
  for (const idx of form.indexes) {
    idx.columns = idx.columns.filter((c) => c !== name)
  }
  form.indexes = form.indexes.filter((i) => i.columns.length > 0)
}

function onAutoIncrementChange(col: MysqlColumnDef) {
  if (col.autoIncrement) {
    col.primaryKey = true
    col.nullable = false
    col.logicDelete = false
    pruneIndexesForColumn(col.name)
  }
}

function onPrimaryKeyChange(col: MysqlColumnDef) {
  if (!col.primaryKey) {
    col.autoIncrement = false
  } else {
    col.nullable = false
    col.logicDelete = false
    pruneIndexesForColumn(col.name)
  }
}

function onLogicDeleteChange(col: MysqlColumnDef) {
  if (col.logicDelete) {
    for (const other of form.columns) {
      if (other !== col) other.logicDelete = false
    }
    pruneIndexesForColumn(col.name)
  }
}

function onTypeChange(col: MysqlColumnDef) {
  if (col.logicDelete && !canSetLogicDelete(col, form.indexes)) {
    col.logicDelete = false
  }
}

function onIndexColumnsChange(idx: MysqlIndexDef) {
  if (!idx.name.trim() && idx.columns.length) {
    idx.name = secondaryIndexName(idx.columns)
  }
}

function defaultColumns(): MysqlColumnDef[] {
  return [
    emptyColumn({
      name: 'id',
      type: 'bigint',
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
    }),
  ]
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    showErrors.value = false
    activeTab.value = 'columns'
    if (props.mode === 'create') {
      form.name = ''
      form.remark = ''
      form.columns = defaultColumns()
      form.indexes = []
      return
    }
    form.name = props.table?.name ?? ''
    form.remark = props.table?.remark ?? ''
    form.columns = []
    form.indexes = []
  },
)

const nameError = computed(() => {
  if (!showErrors.value) return false
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.name.trim())
})

function columnNameError(col: MysqlColumnDef): boolean {
  if (!showErrors.value) return false
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col.name.trim())
}

function indexNameError(idx: MysqlIndexDef): boolean {
  if (!showErrors.value) return false
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(idx.name.trim())
}

function addColumn() {
  form.columns.push(emptyColumn())
}

function removeColumn(index: number) {
  if (form.columns.length <= 1) {
    ElMessage.warning('至少保留一列')
    return
  }
  const removed = form.columns[index]
  form.columns.splice(index, 1)
  if (removed?.name) pruneIndexesForColumn(removed.name)
}

function addIndex() {
  form.indexes.push(emptyIndex())
  activeTab.value = 'indexes'
}

function removeIndex(index: number) {
  form.indexes.splice(index, 1)
}

function validate(): boolean {
  showErrors.value = true
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.name.trim())) {
    ElMessage.error('表名不合法')
    return false
  }
  if (props.mode !== 'create') return true

  const names = new Set<string>()
  let logicDeleteCount = 0
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
    if (col.logicDelete) {
      logicDeleteCount += 1
      if (!canSetLogicDelete(col, form.indexes)) {
        ElMessage.error(`列「${col.name}」不能设为逻辑删除`)
        return false
      }
    }
  }
  if (logicDeleteCount > 1) {
    ElMessage.error('一张表只能有一列逻辑删除')
    return false
  }

  const indexNames = new Set<string>()
  for (const idx of form.indexes) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(idx.name.trim())) {
      ElMessage.error('存在不合法的索引名')
      activeTab.value = 'indexes'
      return false
    }
    if (idx.name.trim().toUpperCase() === 'PRIMARY') {
      ElMessage.error('索引名不能为 PRIMARY')
      activeTab.value = 'indexes'
      return false
    }
    if (indexNames.has(idx.name.trim())) {
      ElMessage.error(`索引名重复：${idx.name}`)
      activeTab.value = 'indexes'
      return false
    }
    indexNames.add(idx.name.trim())
    if (!idx.columns.length) {
      ElMessage.error(`索引「${idx.name}」请至少选择一列`)
      activeTab.value = 'indexes'
      return false
    }
    for (const colName of idx.columns) {
      const col = form.columns.find((c) => c.name.trim() === colName)
      if (!col) {
        ElMessage.error(`索引「${idx.name}」引用了不存在的列「${colName}」`)
        activeTab.value = 'indexes'
        return false
      }
      if (col.primaryKey) {
        ElMessage.error(`索引「${idx.name}」不能包含主键列「${colName}」`)
        activeTab.value = 'indexes'
        return false
      }
      if (col.logicDelete) {
        ElMessage.error(`索引「${idx.name}」不能包含逻辑删除列「${colName}」`)
        activeTab.value = 'indexes'
        return false
      }
    }
  }
  return true
}

function buildCreateTable(): MysqlTableDef {
  return {
    name: form.name.trim(),
    remark: form.remark.trim(),
    columns: form.columns.map((c) => ({
      name: c.name.trim(),
      type: c.type.trim(),
      nullable: c.nullable,
      primaryKey: c.primaryKey,
      autoIncrement: c.autoIncrement,
      defaultValue: c.defaultValue,
      comment: c.comment,
      resource: Boolean(c.resource),
      logicDelete: Boolean(c.logicDelete),
    })),
    indexes: form.indexes.map((i) => ({
      name: i.name.trim(),
      columns: [...i.columns],
      remark: i.remark.trim(),
    })),
  }
}

function close() {
  emit('update:modelValue', false)
}

async function handleSave() {
  if (!props.connection) {
    ElMessage.error('缺少数据库连接')
    return
  }
  if (!props.connection.database.trim()) {
    ElMessage.error('请先在连接配置中填写默认数据库名')
    return
  }
  if (!validate()) return

  saving.value = true
  try {
    const result =
      props.mode === 'create'
        ? await createMysqlTable({
            ...props.connection,
            projectPath: props.projectPath || undefined,
            table: buildCreateTable(),
          })
        : await updateMysqlTableMeta({
            ...props.connection,
            projectPath: props.projectPath || undefined,
            tableName: props.table?.name ?? form.name.trim(),
            name: form.name.trim(),
            remark: form.remark.trim(),
          })
    ElMessage.success(props.mode === 'create' ? '已创建数据表' : '已更新数据表')
    if (props.mode === 'create') {
      emitMysqlSchemaChanged(form.name.trim())
    }
    emit('saved', result.tables)
    close()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

const dialogTitle = computed(() =>
  props.mode === 'create' ? '添加数据表' : `编辑表 · ${props.table?.name ?? ''}`,
)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    :width="mode === 'create' ? '1080px' : '520px'"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="table-form">
      <div class="form-item">
        <div class="label">表名</div>
        <div class="content">
          <el-input
            v-model="form.name"
            placeholder="如 goods_item"
            :status="nameError ? 'error' : undefined"
          />
        </div>
      </div>
      <div class="form-item">
        <div class="label">备注</div>
        <div class="content">
          <el-input v-model="form.remark" placeholder="表注释，可选" />
        </div>
      </div>

      <template v-if="mode === 'create'">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="字段" name="columns">
            <div class="cols-head">
              <span class="cols-title">初始字段</span>
              <el-button type="primary" link :icon="Plus" @click="addColumn">
                添加列
              </el-button>
            </div>
            <div class="cols-table">
              <div class="cols-row cols-header">
                <span>列名</span>
                <span>类型</span>
                <span>资源</span>
                <span>逻辑删</span>
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
                  @change="onTypeChange(col)"
                >
                  <el-option
                    v-for="t in MYSQL_COMMON_TYPE_OPTIONS"
                    :key="t.value"
                    :label="t.label"
                    :value="t.value"
                  />
                </el-select>
                <el-checkbox v-model="col.resource" />
                <el-checkbox
                  v-model="col.logicDelete"
                  :disabled="!canSetLogicDelete(col, form.indexes) && !col.logicDelete"
                  @change="onLogicDeleteChange(col)"
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
          </el-tab-pane>

          <el-tab-pane label="索引" name="indexes">
            <div class="cols-head">
              <span class="cols-title">索引</span>
              <el-button type="primary" link :icon="Plus" @click="addIndex">
                添加索引
              </el-button>
            </div>
            <div v-if="!form.indexes.length" class="indexes-empty">
              暂无索引。可选择多个字段组成联合索引，并自定义名称与备注。
            </div>
            <div v-else class="indexes-table">
              <div class="indexes-row indexes-header">
                <span>索引名</span>
                <span>字段</span>
                <span>备注</span>
                <span />
              </div>
              <div
                v-for="(idx, index) in form.indexes"
                :key="index"
                class="indexes-row"
              >
                <el-input
                  v-model="idx.name"
                  size="small"
                  placeholder="idx_name"
                  :status="indexNameError(idx) ? 'error' : undefined"
                />
                <el-select
                  v-model="idx.columns"
                  size="small"
                  multiple
                  filterable
                  collapse-tags
                  collapse-tags-tooltip
                  placeholder="选择字段"
                  @change="onIndexColumnsChange(idx)"
                >
                  <el-option
                    v-for="opt in columnSelectOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-input v-model="idx.remark" size="small" placeholder="可选" />
                <el-button
                  type="danger"
                  link
                  :icon="Delete"
                  @click="removeIndex(index)"
                />
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <template #footer>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.table-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 80px;
}

.form-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.label {
  width: 64px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: #606266;
  text-align: right;
}

.content {
  flex: 1;
  min-width: 0;
}

.cols-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
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
  grid-template-columns: 1fr 1.1fr 44px 52px 44px 44px 44px 0.8fr 0.8fr 36px;
  gap: 6px;
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

.indexes-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
  border: 1px dashed #e4e7ed;
  border-radius: 6px;
}

.indexes-table {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.indexes-row {
  display: grid;
  grid-template-columns: 1fr 1.6fr 1fr 36px;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-top: 1px solid #f0f2f5;
}

.indexes-row:first-child {
  border-top: none;
}

.indexes-header {
  background: #fafafa;
  font-size: 12px;
  color: #909399;
  font-weight: 500;
}
</style>
