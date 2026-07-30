<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getMysqlTableColumns } from '../../api/projects'
import {
  createEmptyDataTypeGroup,
  isValidGroupName,
  isValidTypeName,
  type DataTypeDef,
  type DataTypeGroup,
  type DataTypeLibrary,
} from '../../types/data-types'
import type { MysqlConnectionPayload, MysqlTableInfo } from '../../types/mysql'
import {
  mysqlTableToDataType,
  previewMysqlColumnMapping,
  tableNameToTypeName,
} from '../../utils/mysql-to-type'

const props = defineProps<{
  modelValue: boolean
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
  typeLibrary: DataTypeLibrary
  projectPath?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [library: DataTypeLibrary]
}>()

const loading = ref(false)
const form = reactive({
  typeName: '',
  groupId: '',
  newGroupName: '',
})
const preview = ref<
  Array<{ column: string; field: string; kind: string; optional: boolean }>
>([])
const pendingDef = ref<DataTypeDef | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set(v: boolean) {
    emit('update:modelValue', v)
  },
})

const groups = computed(() => props.typeLibrary.groups)

const kindLabel: Record<string, string> = {
  string: '字符串',
  number: '数值',
  boolean: '布尔值',
  any: 'any',
}

watch(
  () => [props.modelValue, props.table] as const,
  async ([open, table]) => {
    if (!open || !table) return
    form.typeName = tableNameToTypeName(table.name)
    form.newGroupName = ''
    form.groupId = groups.value[0]?.id ?? ''
    preview.value = []
    pendingDef.value = null
    await loadColumns()
  },
)

async function loadColumns() {
  const conn = props.connection
  const table = props.table
  if (!conn || !table) return
  loading.value = true
  try {
    const result = await getMysqlTableColumns({
      ...conn,
      tableName: table.name,
      projectPath: props.projectPath || undefined,
    })
    if (result.conflict) {
      ElMessage.warning('表结构与本地不一致，请先在「设计表」中解决冲突')
    }
    const columns = result.columns ?? []
    if (!columns.length) {
      ElMessage.warning('该表没有可转换的列')
      return
    }
    const def = mysqlTableToDataType({
      tableName: table.name,
      tableRemark: table.remark,
      columns,
      typeName: form.typeName,
    })
    pendingDef.value = def
    preview.value = previewMysqlColumnMapping(columns)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取表结构失败')
  } finally {
    loading.value = false
  }
}

function findExisting(
  groupsList: DataTypeGroup[],
  groupId: string,
  typeName: string,
): { groupIndex: number; typeIndex: number } | null {
  const gi = groupsList.findIndex((g) => g.id === groupId)
  if (gi < 0) return null
  const ti = groupsList[gi]!.types.findIndex((t) => t.name === typeName)
  if (ti < 0) return null
  return { groupIndex: gi, typeIndex: ti }
}

async function handleConfirm() {
  const name = form.typeName.trim()
  if (!isValidTypeName(name)) {
    ElMessage.error('类型名需以字母或下划线开头，仅含字母、数字、下划线')
    return
  }
  if (!pendingDef.value) {
    ElMessage.warning('请先加载表结构')
    return
  }

  let nextGroups = props.typeLibrary.groups.map((g) => ({
    ...g,
    types: [...g.types],
  }))

  let groupId = form.groupId
  if (!groupId) {
    const gName = form.newGroupName.trim() || 'mysql'
    if (!isValidGroupName(gName)) {
      ElMessage.error('分组名需为纯英文（字母开头）')
      return
    }
    const existing = nextGroups.find((g) => g.name === gName)
    if (existing) {
      groupId = existing.id
    } else {
      const group = createEmptyDataTypeGroup(gName)
      nextGroups = [...nextGroups, group]
      groupId = group.id
    }
  }

  const def: DataTypeDef = {
    ...pendingDef.value,
    name,
    remark: pendingDef.value.remark,
    fields: pendingDef.value.fields.map((f) => ({ ...f })),
  }

  const hit = findExisting(nextGroups, groupId, name)
  if (hit) {
    try {
      await ElMessageBox.confirm(
        `分组内已存在类型「${name}」，是否覆盖？`,
        '覆盖确认',
        { type: 'warning', confirmButtonText: '覆盖', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    const group = nextGroups[hit.groupIndex]!
    group.types = group.types.map((t, i) =>
      i === hit.typeIndex ? { ...def, id: t.id } : t,
    )
  } else {
    nextGroups = nextGroups.map((g) =>
      g.id === groupId ? { ...g, types: [...g.types, def] } : g,
    )
  }

  emit('save', { groups: nextGroups })
  visible.value = false
  ElMessage.success(`已生成类型「${name}」`)
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`转成类型 · ${table?.name ?? ''}`"
    width="640px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div v-loading="loading" class="to-type">
      <el-form label-position="top">
        <el-form-item label="类型名" required>
          <el-input v-model="form.typeName" placeholder="例如：Goods" />
        </el-form-item>
        <el-form-item label="目标分组">
          <el-select
            v-if="groups.length"
            v-model="form.groupId"
            placeholder="选择分组"
            style="width: 100%"
          >
            <el-option
              v-for="g in groups"
              :key="g.id"
              :label="g.name"
              :value="g.id"
            />
          </el-select>
          <el-input
            v-else
            v-model="form.newGroupName"
            placeholder="将新建分组（默认 mysql）"
          />
        </el-form-item>
      </el-form>

      <div class="preview-title">字段映射预览</div>
      <el-table :data="preview" border size="small" empty-text="暂无列">
        <el-table-column prop="column" label="列名" min-width="120" />
        <el-table-column prop="field" label="字段名" min-width="120" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            {{ kindLabel[row.kind] || row.kind }}
          </template>
        </el-table-column>
        <el-table-column label="可选" width="72" align="center">
          <template #default="{ row }">
            {{ row.optional ? '是' : '否' }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button type="primary" :disabled="loading || !preview.length" @click="handleConfirm">
        生成类型
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.to-type {
  min-height: 200px;
}

.preview-title {
  margin: 8px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
</style>
