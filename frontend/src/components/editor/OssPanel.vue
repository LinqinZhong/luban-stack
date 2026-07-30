<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createOssBucket,
  deleteOssBucket,
  listOssBuckets,
  setOssBucketAccess,
} from '../../api/projects'
import OssConnectionDialog from './OssConnectionDialog.vue'
import OssObjectsPanel from './OssObjectsPanel.vue'
import {
  createEmptyOssConnection,
  type OssBucketInfo,
  type OssConnectionConfig,
  type OssConnectionPayload,
  type OssLibrary,
} from '../../types/oss'

const props = defineProps<{
  library: OssLibrary
}>()

const emit = defineEmits<{
  'update:library': [library: OssLibrary]
}>()

const connections = computed({
  get: () => props.library.connections,
  set(value: OssConnectionConfig[]) {
    emit('update:library', { connections: value })
  },
})

const activeId = ref('')
const connDialogVisible = ref(false)
const editingConn = ref<OssConnectionConfig | null>(null)
const viewingBucket = ref<OssBucketInfo | null>(null)
const createBucketVisible = ref(false)
const newBucketName = ref('')
const creatingBucket = ref(false)
const busy = ref(false)

watch(
  connections,
  (list) => {
    if (!list.length) {
      activeId.value = ''
      viewingBucket.value = null
      return
    }
    if (!list.some((c) => c.id === activeId.value)) {
      activeId.value = list[0]!.id
      viewingBucket.value = null
    }
  },
  { immediate: true, deep: true },
)

watch(activeId, () => {
  viewingBucket.value = null
})

const activeConn = computed(
  () => connections.value.find((c) => c.id === activeId.value) ?? null,
)

const buckets = computed(() => activeConn.value?.buckets ?? [])

const connectionPayload = computed<OssConnectionPayload | null>(() => {
  const conn = activeConn.value
  if (!conn) return null
  return {
    endpoint: conn.endpoint,
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    forcePathStyle: conn.forcePathStyle,
  }
})

function patchActiveBuckets(nextBuckets: OssBucketInfo[]) {
  const conn = activeConn.value
  if (!conn) return
  const prev = new Map(conn.buckets.map((b) => [b.name, b.access]))
  const merged = nextBuckets.map((b) => ({
    ...b,
    access: (prev.get(b.name) === 'public' || b.access === 'public'
      ? 'public'
      : 'private') as 'public' | 'private',
  }))
  connections.value = connections.value.map((c) =>
    c.id === conn.id
      ? { ...c, buckets: merged, lastTestedAt: Date.now() }
      : c,
  )
}

function patchBucketAccess(bucketName: string, access: 'public' | 'private') {
  const conn = activeConn.value
  if (!conn) return
  connections.value = connections.value.map((c) =>
    c.id === conn.id
      ? {
          ...c,
          buckets: c.buckets.map((b) =>
            b.name === bucketName ? { ...b, access } : b,
          ),
        }
      : c,
  )
  if (viewingBucket.value?.name === bucketName) {
    viewingBucket.value = { ...viewingBucket.value, access }
  }
}

function openCreateConn() {
  editingConn.value = createEmptyOssConnection(`对象存储${connections.value.length + 1}`)
  connDialogVisible.value = true
}

function openEditConn(conn: OssConnectionConfig) {
  editingConn.value = JSON.parse(JSON.stringify(conn)) as OssConnectionConfig
  connDialogVisible.value = true
}

type ConnMenuCommand = 'config' | 'delete'

function handleConnMenuCommand(command: ConnMenuCommand, conn: OssConnectionConfig) {
  if (command === 'config') openEditConn(conn)
  else void removeConn(conn)
}

async function removeConn(conn: OssConnectionConfig) {
  try {
    await ElMessageBox.confirm(
      `确定删除对象存储连接「${conn.name}」吗？`,
      '删除连接',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  connections.value = connections.value.filter((c) => c.id !== conn.id)
}

function handleSaveConn(conn: OssConnectionConfig) {
  const dup = connections.value.some((c) => c.name === conn.name && c.id !== conn.id)
  if (dup) {
    ElMessage.error(`连接名称「${conn.name}」已存在`)
    return
  }
  const idx = connections.value.findIndex((c) => c.id === conn.id)
  if (idx >= 0) {
    connections.value = connections.value.map((c) => (c.id === conn.id ? conn : c))
  } else {
    connections.value = [...connections.value, conn]
  }
  activeId.value = conn.id
  ElMessage.success('已保存对象存储配置')
}

function ensureConnection(): OssConnectionPayload | null {
  const conn = connectionPayload.value
  if (!conn) {
    ElMessage.warning('请先选择对象存储连接')
    return null
  }
  if (!conn.endpoint.trim()) {
    ElMessage.warning('请先配置连接并填写 Endpoint')
    openEditConn(activeConn.value!)
    return null
  }
  return conn
}

function openCreateBucket() {
  if (!ensureConnection()) return
  newBucketName.value = ''
  createBucketVisible.value = true
}

async function handleCreateBucket() {
  const conn = ensureConnection()
  if (!conn) return
  const name = newBucketName.value.trim()
  if (!name) {
    ElMessage.error('请填写桶名称')
    return
  }
  creatingBucket.value = true
  try {
    const result = await createOssBucket({ ...conn, bucketName: name })
    patchActiveBuckets(result.buckets)
    createBucketVisible.value = false
    ElMessage.success(`已创建桶「${name}」`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建桶失败')
  } finally {
    creatingBucket.value = false
  }
}

function openViewBucket(row: OssBucketInfo) {
  if (!ensureConnection()) return
  viewingBucket.value = row
}

function closeViewBucket() {
  viewingBucket.value = null
}

async function refreshBuckets() {
  const conn = ensureConnection()
  if (!conn) return
  busy.value = true
  try {
    const result = await listOssBuckets(conn)
    patchActiveBuckets(result.buckets)
    ElMessage.success(`已刷新，共 ${result.buckets.length} 个桶`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '刷新失败')
  } finally {
    busy.value = false
  }
}

async function removeBucket(row: OssBucketInfo) {
  const conn = ensureConnection()
  if (!conn) return
  try {
    await ElMessageBox.confirm(
      `确定删除桶「${row.name}」吗？桶必须为空才能删除。`,
      '删除桶',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await deleteOssBucket({ ...conn, bucketName: row.name })
    patchActiveBuckets(result.buckets)
    ElMessage.success(`已删除桶「${row.name}」`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    busy.value = false
  }
}

async function toggleBucketAccess(row: OssBucketInfo) {
  const conn = ensureConnection()
  if (!conn) return
  const nextAccess = row.access === 'public' ? 'private' : 'public'
  const label = nextAccess === 'public' ? '公有' : '私有'
  try {
    await ElMessageBox.confirm(
      nextAccess === 'public'
        ? `将桶「${row.name}」设为公有后，匿名即可通过外链读取对象。确定继续？`
        : `将桶「${row.name}」设为私有后，前端访问需运行时签名。确定继续？`,
      `设为${label}`,
      { type: 'warning', confirmButtonText: `设为${label}`, cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await setOssBucketAccess({
      ...conn,
      bucketName: row.name,
      access: nextAccess,
    })
    patchBucketAccess(row.name, nextAccess)
    ElMessage.success(`已将桶「${row.name}」设为${label}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : `设为${label}失败`)
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function shortEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return url.host || endpoint
  } catch {
    return endpoint
  }
}
</script>

<template>
  <div v-loading="busy" class="oss-panel">
    <div class="oss-body">
      <aside class="conn-pane">
        <div class="pane-head">
          <span class="pane-title">连接</span>
          <el-button type="primary" link :icon="Plus" @click="openCreateConn">
            添加
          </el-button>
        </div>
        <el-empty
          v-if="!connections.length"
          description="添加对象存储连接"
          :image-size="56"
        />
        <ul v-else class="conn-list">
          <el-dropdown
            v-for="conn in connections"
            :key="conn.id"
            trigger="contextmenu"
            class="conn-dropdown"
            @command="(cmd: string) => handleConnMenuCommand(cmd as ConnMenuCommand, conn)"
          >
            <li
              class="conn-item"
              :class="{ active: conn.id === activeId }"
              @click="activeId = conn.id"
              @dblclick="openEditConn(conn)"
              @contextmenu.prevent
            >
              <div class="conn-meta">
                <div class="conn-name">{{ conn.name }}</div>
                <div class="conn-sub-row">
                  <div class="conn-sub">{{ shortEndpoint(conn.endpoint) }}</div>
                  <span class="conn-count">{{ conn.buckets.length }}个桶</span>
                </div>
              </div>
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

      <section class="bucket-pane">
        <OssObjectsPanel
          v-if="viewingBucket && connectionPayload"
          :connection="connectionPayload"
          :bucket="viewingBucket"
          @back="closeViewBucket"
        />
        <template v-else>
          <div class="pane-head">
            <span class="pane-title">存储桶</span>
            <span v-if="activeConn" class="pane-sub">
              最近同步：{{ formatTime(activeConn.lastTestedAt) }}
            </span>
            <el-button
              v-if="activeConn"
              type="primary"
              link
              :icon="Refresh"
              @click="refreshBuckets"
            >
              刷新
            </el-button>
            <el-button
              v-if="activeConn"
              type="primary"
              link
              :icon="Plus"
              @click="openCreateBucket"
            >
              添加
            </el-button>
          </div>

          <el-empty
            v-if="!activeConn"
            description="请选择或添加左侧连接"
            :image-size="64"
          />
          <el-empty
            v-else-if="!buckets.length"
            description="暂无存储桶，点击添加创建"
            :image-size="64"
          />
          <div v-else class="table-wrap">
            <el-table :data="buckets" border stripe empty-text="无存储桶">
              <el-table-column prop="name" label="桶名" min-width="160" />
              <el-table-column label="访问" width="100">
                <template #default="{ row }">
                  <el-tag
                    size="small"
                    :type="row.access === 'public' ? 'success' : 'info'"
                  >
                    {{ row.access === 'public' ? '公有' : '私有' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="创建时间" min-width="150">
                <template #default="{ row }">
                  {{ formatDate(row.creationDate) }}
                </template>
              </el-table-column>
              <el-table-column prop="region" label="Region" width="120" />
              <el-table-column label="操作" width="220" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link @click="openViewBucket(row)">
                    查看
                  </el-button>
                  <el-button type="primary" link @click="toggleBucketAccess(row)">
                    {{ row.access === 'public' ? '设为私有' : '设为公有' }}
                  </el-button>
                  <el-button type="danger" link @click="removeBucket(row)">
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </section>
    </div>

    <OssConnectionDialog
      v-model="connDialogVisible"
      :connection="editingConn"
      @save="handleSaveConn"
    />

    <el-dialog
      v-model="createBucketVisible"
      title="创建存储桶"
      width="480px"
      destroy-on-close
      append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <div class="bucket-form">
        <div class="form-item">
          <div class="label">桶名称</div>
          <div class="content">
            <el-input
              v-model="newBucketName"
              placeholder="小写字母、数字、点、连字符"
              @keyup.enter="handleCreateBucket"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button
          type="primary"
          :loading="creatingBucket"
          @click="handleCreateBucket"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.oss-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.oss-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px 1fr;
  overflow: hidden;
}

.conn-pane,
.bucket-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conn-pane {
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
  margin-right: auto;
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

.conn-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  flex: 1;
}

.conn-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.conn-dropdown :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
}

.conn-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  list-style: none;
}

.conn-item:hover {
  background: #f1f5f9;
}

.conn-item.active {
  background: #ecf5ff;
  border-color: #b3d8ff;
}

.conn-meta {
  flex: 1;
  min-width: 0;
}

.conn-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn-sub-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.conn-sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn-count {
  flex-shrink: 0;
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
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

.bucket-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.label {
  width: 72px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  color: #606266;
  text-align: right;
}

.content {
  flex: 1;
  min-width: 0;
}
</style>
