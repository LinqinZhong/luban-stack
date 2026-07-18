<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dropMysqlTable, listMysqlTables, truncateMysqlTable } from '../../api/projects'
import MysqlConnectionDialog from './MysqlConnectionDialog.vue'
import MysqlDesignDialog from './MysqlDesignDialog.vue'
import MysqlTableDialog from './MysqlTableDialog.vue'
import MysqlToTypeDialog from './MysqlToTypeDialog.vue'
import {
  createEmptyMysqlDatabase,
  type MysqlConnectionPayload,
  type MysqlDatabaseConfig,
  type MysqlLibrary,
  type MysqlTableInfo,
} from '../../types/mysql'
import type { DataTypeLibrary } from '../../types/data-types'

const props = defineProps<{
  library: MysqlLibrary
  typeLibrary: DataTypeLibrary
}>()

const emit = defineEmits<{
  'update:library': [library: MysqlLibrary]
  'update:type-library': [library: DataTypeLibrary]
}>()

const databases = computed({
  get: () => props.library.databases,
  set(value: MysqlDatabaseConfig[]) {
    emit('update:library', { databases: value })
  },
})

const activeId = ref('')
const connDialogVisible = ref(false)
const editingDb = ref<MysqlDatabaseConfig | null>(null)

const tableDialogVisible = ref(false)
const tableDialogMode = ref<'create' | 'edit'>('create')
const editingTable = ref<MysqlTableInfo | null>(null)
const designDialogVisible = ref(false)
const designingTable = ref<MysqlTableInfo | null>(null)
const toTypeDialogVisible = ref(false)
const toTypeTable = ref<MysqlTableInfo | null>(null)
const busy = ref(false)

watch(
  databases,
  (list) => {
    if (!list.length) {
      activeId.value = ''
      return
    }
    if (!list.some((d) => d.id === activeId.value)) {
      activeId.value = list[0]!.id
    }
  },
  { immediate: true, deep: true },
)

const activeDb = computed(
  () => databases.value.find((d) => d.id === activeId.value) ?? null,
)

const tables = computed(() => activeDb.value?.tables ?? [])

const connectionPayload = computed<MysqlConnectionPayload | null>(() => {
  const db = activeDb.value
  if (!db) return null
  return {
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssh: db.ssh,
  }
})

function patchActiveTables(nextTables: MysqlTableInfo[]) {
  const db = activeDb.value
  if (!db) return
  databases.value = databases.value.map((d) =>
    d.id === db.id
      ? { ...d, tables: nextTables, lastTestedAt: Date.now() }
      : d,
  )
}

function openCreateDb() {
  editingDb.value = createEmptyMysqlDatabase(`mysql${databases.value.length + 1}`)
  connDialogVisible.value = true
}

function openEditDb(db: MysqlDatabaseConfig) {
  editingDb.value = JSON.parse(JSON.stringify(db)) as MysqlDatabaseConfig
  connDialogVisible.value = true
}

type DbMenuCommand = 'config' | 'delete'

function handleDbMenuCommand(command: DbMenuCommand, db: MysqlDatabaseConfig) {
  if (command === 'config') openEditDb(db)
  else void removeDb(db)
}

async function removeDb(db: MysqlDatabaseConfig) {
  try {
    await ElMessageBox.confirm(
      `确定删除数据库「${db.name}」吗？`,
      '删除数据库',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  databases.value = databases.value.filter((d) => d.id !== db.id)
}

function handleSaveDb(db: MysqlDatabaseConfig) {
  const dup = databases.value.some((d) => d.name === db.name && d.id !== db.id)
  if (dup) {
    ElMessage.error(`数据库名称「${db.name}」已存在`)
    return
  }
  const idx = databases.value.findIndex((d) => d.id === db.id)
  if (idx >= 0) {
    databases.value = databases.value.map((d) => (d.id === db.id ? db : d))
  } else {
    databases.value = [...databases.value, db]
  }
  activeId.value = db.id
  ElMessage.success('已保存 MySQL 配置')
}

function ensureConnection(): MysqlConnectionPayload | null {
  const conn = connectionPayload.value
  if (!conn) {
    ElMessage.warning('请先选择数据库')
    return null
  }
  if (!conn.database.trim()) {
    ElMessage.warning('请先配置连接并填写默认数据库名')
    openEditDb(activeDb.value!)
    return null
  }
  return conn
}

function openCreateTable() {
  if (!ensureConnection()) return
  tableDialogMode.value = 'create'
  editingTable.value = null
  tableDialogVisible.value = true
}

function openEditTable(row: MysqlTableInfo) {
  if (!ensureConnection()) return
  tableDialogMode.value = 'edit'
  editingTable.value = row
  tableDialogVisible.value = true
}

function openDesignTable(row: MysqlTableInfo) {
  if (!ensureConnection()) return
  designingTable.value = row
  designDialogVisible.value = true
}

function openToType(row: MysqlTableInfo) {
  if (!ensureConnection()) return
  toTypeTable.value = row
  toTypeDialogVisible.value = true
}

function handleTypeLibrarySave(library: DataTypeLibrary) {
  emit('update:type-library', library)
}

function handleTableSaved(nextTables: MysqlTableInfo[]) {
  patchActiveTables(nextTables)
}

async function refreshTables() {
  const conn = ensureConnection()
  if (!conn) return
  busy.value = true
  try {
    const result = await listMysqlTables(conn)
    patchActiveTables(result.tables)
    ElMessage.success(`已刷新，共 ${result.tables.length} 张表`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '刷新失败')
  } finally {
    busy.value = false
  }
}

async function clearTable(row: MysqlTableInfo) {
  const conn = ensureConnection()
  if (!conn) return
  try {
    await ElMessageBox.confirm(
      `确定清空表「${row.name}」的所有数据吗？此操作不可恢复。`,
      '清空表',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await truncateMysqlTable({ ...conn, tableName: row.name })
    patchActiveTables(result.tables)
    ElMessage.success(`已清空表「${row.name}」`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '清空失败')
  } finally {
    busy.value = false
  }
}

async function removeTable(row: MysqlTableInfo) {
  const conn = ensureConnection()
  if (!conn) return
  try {
    await ElMessageBox.confirm(
      `确定删除表「${row.name}」吗？此操作不可恢复。`,
      '删除表',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await dropMysqlTable({ ...conn, tableName: row.name })
    patchActiveTables(result.tables)
    ElMessage.success(`已删除表「${row.name}」`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    busy.value = false
  }
}

function formatTime(ts: number | null): string {
  if (!ts) return '未同步'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}
</script>

<template>
  <div v-loading="busy" class="mysql-panel">
    <div class="mysql-body">
      <aside class="db-pane">
        <div class="pane-head">
          <span class="pane-title">数据库</span>
          <el-button type="primary" link :icon="Plus" @click="openCreateDb">
            添加
          </el-button>
        </div>
        <el-empty
          v-if="!databases.length"
          description="添加 MySQL 数据库连接"
          :image-size="56"
        />
        <ul v-else class="db-list">
          <el-dropdown
            v-for="db in databases"
            :key="db.id"
            trigger="contextmenu"
            class="db-dropdown"
            @command="(cmd) => handleDbMenuCommand(cmd as DbMenuCommand, db)"
          >
            <li
              class="db-item"
              :class="{ active: db.id === activeId }"
              @click="activeId = db.id"
              @dblclick="openEditDb(db)"
              @contextmenu.prevent
            >
              <div class="db-meta">
                <div class="db-name">{{ db.name }}</div>
                <div class="db-sub">
                  {{ db.host }}:{{ db.port }}
                  <span v-if="db.ssh.enabled"> · SSH</span>
                </div>
              </div>
              <span class="db-count">{{ db.tables.length }}</span>
            </li>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="config">配置</el-dropdown-item>
                <el-dropdown-item command="delete" divided>
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </ul>
      </aside>

      <section class="table-pane">
        <div class="pane-head">
          <span class="pane-title">数据表</span>
          <span v-if="activeDb" class="pane-sub">
            最近同步：{{ formatTime(activeDb.lastTestedAt) }}
          </span>
          <el-button
            v-if="activeDb"
            type="primary"
            link
            :icon="Refresh"
            @click="refreshTables"
          >
            刷新
          </el-button>
          <el-button
            v-if="activeDb"
            type="primary"
            link
            :icon="Plus"
            @click="openCreateTable"
          >
            添加
          </el-button>
        </div>

        <el-empty
          v-if="!activeDb"
          description="请选择或添加左侧数据库"
          :image-size="64"
        />
        <el-empty
          v-else-if="!tables.length"
          description="暂无数据表，点击添加创建"
          :image-size="64"
        />
        <div v-else class="table-wrap">
          <el-table :data="tables" border stripe empty-text="无数据表">
            <el-table-column prop="name" label="表名" min-width="160" />
            <el-table-column prop="engine" label="引擎" width="110" />
            <el-table-column label="行数" width="100" align="right">
              <template #default="{ row }">
                {{ row.rows == null ? '—' : row.rows }}
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" />
            <el-table-column label="操作" width="280" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="openEditTable(row)">
                  编辑
                </el-button>
                <el-button type="primary" link @click="openDesignTable(row)">
                  设计
                </el-button>
                <el-button type="primary" link @click="openToType(row)">
                  转成类型
                </el-button>
                <el-button type="warning" link @click="clearTable(row)">
                  清空
                </el-button>
                <el-button type="danger" link @click="removeTable(row)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <MysqlConnectionDialog
      v-model="connDialogVisible"
      :database="editingDb"
      @save="handleSaveDb"
    />
    <MysqlTableDialog
      v-model="tableDialogVisible"
      :mode="tableDialogMode"
      :connection="connectionPayload"
      :table="editingTable"
      @saved="handleTableSaved"
    />
    <MysqlDesignDialog
      v-model="designDialogVisible"
      :connection="connectionPayload"
      :table="designingTable"
      @saved="handleTableSaved"
    />
    <MysqlToTypeDialog
      v-model="toTypeDialogVisible"
      :connection="connectionPayload"
      :table="toTypeTable"
      :type-library="typeLibrary"
      @save="handleTypeLibrarySave"
    />
  </div>
</template>

<style scoped>
.mysql-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.mysql-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px 1fr;
  overflow: hidden;
}

.db-pane,
.table-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.db-pane {
  border-right: 1px solid #ebeef5;
  background: #fafafa;
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

.db-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  flex: 1;
}

.db-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.db-dropdown :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
}

.db-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  list-style: none;
}

.db-item:hover {
  background: #f1f5f9;
}

.db-item.active {
  background: #ecf5ff;
  border-color: #b3d8ff;
}

.db-meta {
  flex: 1;
  min-width: 0;
}

.db-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-count {
  font-size: 11px;
  color: #94a3b8;
  min-width: 16px;
  text-align: center;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

:deep(.el-table) {
  width: 100%;
}
</style>
