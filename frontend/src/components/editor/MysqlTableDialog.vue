<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { createMysqlTable, updateMysqlTableMeta } from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlTableDef,
  MysqlTableInfo,
} from '../../types/mysql'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  saved: [tables: MysqlTableInfo[]]
}>()

const saving = ref(false)
const showErrors = ref(false)

const form = reactive({
  name: '',
  remark: '',
  columns: [] as MysqlColumnDef[],
})

const COMMON_TYPES = [
  'bigint',
  'int',
  'varchar(255)',
  'varchar(64)',
  'text',
  'datetime',
  'timestamp',
  'decimal(10,2)',
  'tinyint(1)',
  'json',
]

function emptyColumn(partial?: Partial<MysqlColumnDef>): MysqlColumnDef {
  return {
    name: '',
    type: 'varchar(255)',
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: '',
    comment: '',
    ...partial,
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
    if (props.mode === 'create') {
      form.name = ''
      form.remark = ''
      form.columns = defaultColumns()
      return
    }
    form.name = props.table?.name ?? ''
    form.remark = props.table?.remark ?? ''
    form.columns = []
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.name.trim())) {
    ElMessage.error('表名不合法')
    return false
  }
  if (props.mode !== 'create') return true

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
            table: buildCreateTable(),
          })
        : await updateMysqlTableMeta({
            ...props.connection,
            tableName: props.table?.name ?? form.name.trim(),
            name: form.name.trim(),
            remark: form.remark.trim(),
          })
    ElMessage.success(props.mode === 'create' ? '已创建数据表' : '已更新数据表')
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
    :width="mode === 'create' ? '860px' : '520px'"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
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
        <div class="cols-head">
          <span class="cols-title">初始字段</span>
          <el-button type="primary" link :icon="Plus" @click="addColumn">添加列</el-button>
        </div>
        <div class="cols-table">
          <div class="cols-row cols-header">
            <span>列名</span>
            <span>类型</span>
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
              <el-option v-for="t in COMMON_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
            <el-checkbox v-model="col.nullable" />
            <el-checkbox v-model="col.primaryKey" />
            <el-checkbox v-model="col.autoIncrement" />
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
      </template>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
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
  grid-template-columns: 1.1fr 1.2fr 52px 52px 52px 0.9fr 0.9fr 36px;
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
</style>
