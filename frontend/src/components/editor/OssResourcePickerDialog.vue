<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Document, Folder, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getOssLibrary,
  getOssObjectMeta,
  listOssBuckets,
  listOssObjects,
  signOssObject,
} from '../../api/projects'
import type { OssBindingConfig } from '../../types/page-data'
import type {
  OssBucketInfo,
  OssConnectionConfig,
  OssConnectionPayload,
  OssObjectInfo,
} from '../../types/oss'

const props = defineProps<{
  modelValue: boolean
  projectPath?: string | null
  initial?: OssBindingConfig | null
  /** 允许手动填写对象 key（绑定上传场景） */
  allowCustomKey?: boolean
  /** 自定义 key 的默认值（如 icons/home.svg） */
  suggestedKey?: string
  title?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  confirm: [config: OssBindingConfig]
}>()

const loading = ref(false)
const listing = ref(false)
const connections = ref<OssConnectionConfig[]>([])
const connectionId = ref('')
const bucketName = ref('')
const prefix = ref('')
const keyQuery = ref('')
const entries = ref<OssObjectInfo[]>([])
const selectedKey = ref('')
const selectedUrl = ref('')
const metaLoading = ref(false)
/** 私有桶图片缩略图签名 URL */
const signedThumbMap = ref<Record<string, string>>({})
/** 缩略图加载失败的 key */
const failedThumbs = ref<Set<string>>(new Set())
/** 打开弹窗初始化时跳过 connection/bucket watch 的清空逻辑 */
const hydrating = ref(false)

const dialogTitle = computed(() => props.title || '选择对象存储资源')

const activeConnection = computed(
  () => connections.value.find((c) => c.id === connectionId.value) ?? null,
)

const connectionPayload = computed<OssConnectionPayload | null>(() => {
  const c = activeConnection.value
  if (!c) return null
  return {
    endpoint: c.endpoint,
    region: c.region,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    forcePathStyle: c.forcePathStyle,
  }
})

const buckets = computed<OssBucketInfo[]>(() => activeConnection.value?.buckets ?? [])

const activeBucket = computed(
  () => buckets.value.find((b) => b.name === bucketName.value) ?? null,
)

const isPrivateBucket = computed(
  () => activeBucket.value?.access !== 'public',
)
const breadcrumb = computed(() => {
  const parts = prefix.value.split('/').filter(Boolean)
  const items: { label: string; prefix: string }[] = [
    { label: bucketName.value || '桶', prefix: '' },
  ]
  let acc = ''
  for (const part of parts) {
    acc += `${part}/`
    items.push({ label: part, prefix: acc })
  }
  return items
})

const canConfirm = computed(
  () =>
    Boolean(
      connectionId.value &&
        bucketName.value &&
        selectedKey.value.trim() &&
        (selectedUrl.value || props.allowCustomKey),
    ),
)

function displayName(row: OssObjectInfo): string {
  const key = row.key
  if (row.isPrefix) {
    const trimmed = key.endsWith('/') ? key.slice(0, -1) : key
    const parts = trimmed.split('/')
    return parts[parts.length - 1] || key
  }
  if (prefix.value && key.startsWith(prefix.value)) {
    return key.slice(prefix.value.length)
  }
  const parts = key.split('/')
  return parts[parts.length - 1] || key
}

function isImageKey(key: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(key)
}

function thumbSrc(key: string): string | undefined {
  if (failedThumbs.value.has(key)) return undefined
  if (isPrivateBucket.value) return signedThumbMap.value[key]
  return buildPublicUrl(key) || undefined
}

function showImageThumb(row: OssObjectInfo): boolean {
  return !row.isPrefix && isImageKey(row.key) && Boolean(thumbSrc(row.key))
}

async function refreshSignedThumbs(rows: OssObjectInfo[]) {
  const payload = connectionPayload.value
  if (!payload || !bucketName.value || !isPrivateBucket.value) {
    signedThumbMap.value = {}
    return
  }
  const images = rows.filter((r) => !r.isPrefix && isImageKey(r.key))
  const next: Record<string, string> = { ...signedThumbMap.value }
  await Promise.all(
    images.map(async (row) => {
      if (next[row.key]) return
      try {
        const result = await signOssObject({
          ...payload,
          bucketName: bucketName.value,
          key: row.key,
        })
        next[row.key] = result.signedUrl
      } catch {
        // ignore thumb failures
      }
    }),
  )
  signedThumbMap.value = next
}

function onThumbError(key: string) {
  const next = new Set(failedThumbs.value)
  next.add(key)
  failedThumbs.value = next
}

function buildPublicUrl(key: string): string | null {
  const conn = connectionPayload.value
  if (!conn?.endpoint || !bucketName.value) return null
  const endpoint = conn.endpoint.trim().replace(/\/+$/, '')
  const encodedKey = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  try {
    if (conn.forcePathStyle !== false) {
      return `${endpoint}/${bucketName.value}/${encodedKey}`
    }
    const url = new URL(endpoint)
    return `${url.protocol}//${bucketName.value}.${url.host}/${encodedKey}`
  } catch {
    return `${endpoint}/${bucketName.value}/${encodedKey}`
  }
}

async function loadLibrary() {
  const path = props.projectPath?.trim()
  if (!path) {
    connections.value = []
    return
  }
  loading.value = true
  try {
    const lib = await getOssLibrary(path)
    connections.value = lib.connections ?? []
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载对象存储失败')
    connections.value = []
  } finally {
    loading.value = false
  }
}

async function refreshBuckets() {
  const payload = connectionPayload.value
  if (!payload) return
  try {
    const result = await listOssBuckets(payload)
    const conn = activeConnection.value
    if (conn) conn.buckets = result.buckets
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '列出桶失败')
  }
}

async function loadObjects() {
  const payload = connectionPayload.value
  if (!payload || !bucketName.value) {
    entries.value = []
    signedThumbMap.value = {}
    return
  }
  listing.value = true
  try {
    const result = await listOssObjects({
      ...payload,
      bucketName: bucketName.value,
      prefix: prefix.value || undefined,
    })
    entries.value = [...(result.prefixes ?? []), ...(result.objects ?? [])]
    signedThumbMap.value = {}
    failedThumbs.value = new Set()
    void refreshSignedThumbs(entries.value)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '列出对象失败')
    entries.value = []
    signedThumbMap.value = {}
    failedThumbs.value = new Set()
  } finally {
    listing.value = false
  }
}

function runSearch() {
  const q = keyQuery.value.trim()
  if (!q) {
    prefix.value = ''
  } else if (q.endsWith('/')) {
    prefix.value = q
  } else if (q.includes('/')) {
    // 当作完整或半路径前缀；精确文件则高亮选中
    const slash = q.lastIndexOf('/')
    prefix.value = q.slice(0, slash + 1)
  } else {
    prefix.value = q
  }
  if (!props.allowCustomKey) {
    selectedKey.value = ''
    selectedUrl.value = ''
  } else if (q && !q.endsWith('/')) {
    selectedKey.value = q
    selectedUrl.value = buildPublicUrl(q) || ''
  }
  void loadObjects().then(() => {
    if (!q || q.endsWith('/')) return
    const hit = entries.value.find((e) => !e.isPrefix && e.key === q)
    if (hit) void selectObject(hit)
  })
}

async function selectObject(row: OssObjectInfo) {
  if (row.isPrefix) {
    prefix.value = row.key.endsWith('/') ? row.key : `${row.key}/`
    keyQuery.value = prefix.value
    selectedKey.value = ''
    selectedUrl.value = ''
    await loadObjects()
    return
  }
  selectedKey.value = row.key
  keyQuery.value = row.key
  selectedUrl.value = buildPublicUrl(row.key) || ''
  const payload = connectionPayload.value
  if (!payload) return
  metaLoading.value = true
  try {
    const meta = await getOssObjectMeta({
      ...payload,
      bucketName: bucketName.value,
      key: row.key,
    })
    if (meta.publicUrl) selectedUrl.value = meta.publicUrl
  } catch {
    // 保留本地拼出的外链
  } finally {
    metaLoading.value = false
  }
}

function goPrefix(next: string) {
  prefix.value = next
  keyQuery.value = next
  selectedKey.value = ''
  selectedUrl.value = ''
  void loadObjects()
}

function close() {
  emit('update:modelValue', false)
}

function handleConfirm() {
  const key = selectedKey.value.trim()
  if (!connectionId.value || !bucketName.value || !key) {
    ElMessage.warning(
      props.allowCustomKey
        ? '请选择连接、桶并填写对象 key'
        : '请选择对象存储中的资源',
    )
    return
  }
  const url = (selectedUrl.value || buildPublicUrl(key) || '').trim()
  if (!url) {
    ElMessage.warning('无法生成外链，请检查连接 Endpoint')
    return
  }
  emit('confirm', {
    connectionId: connectionId.value,
    bucketName: bucketName.value,
    objectKey: key,
    url,
  })
  close()
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return
    hydrating.value = true
    try {
      await loadLibrary()
      const init = props.initial
      connectionId.value = init?.connectionId || connections.value[0]?.id || ''
      bucketName.value = init?.bucketName || ''
      prefix.value = ''
      keyQuery.value = init?.objectKey || ''
      selectedKey.value =
        init?.objectKey ||
        (props.allowCustomKey ? props.suggestedKey || '' : '') ||
        ''
      selectedUrl.value =
        init?.url ||
        (selectedKey.value ? buildPublicUrl(selectedKey.value) || '' : '')
      entries.value = []
      if (connectionId.value && !buckets.value.length) {
        await refreshBuckets()
      }
      if (!bucketName.value && buckets.value[0]) {
        bucketName.value = buckets.value[0].name
      }
      if (bucketName.value) await loadObjects()
      if (
        props.allowCustomKey &&
        !init?.objectKey &&
        props.suggestedKey &&
        !selectedKey.value
      ) {
        selectedKey.value = props.suggestedKey
        keyQuery.value = props.suggestedKey
        selectedUrl.value = buildPublicUrl(props.suggestedKey) || ''
      }
    } finally {
      hydrating.value = false
    }
  },
)

watch(connectionId, async () => {
  if (!props.modelValue || hydrating.value) return
  bucketName.value = ''
  prefix.value = ''
  keyQuery.value = ''
  selectedKey.value = props.allowCustomKey ? props.suggestedKey || '' : ''
  selectedUrl.value = selectedKey.value
    ? buildPublicUrl(selectedKey.value) || ''
    : ''
  entries.value = []
  await refreshBuckets()
  if (buckets.value[0]) {
    bucketName.value = buckets.value[0].name
    await loadObjects()
  }
})

watch(bucketName, async (name) => {
  if (!props.modelValue || hydrating.value || !name) return
  prefix.value = ''
  keyQuery.value = props.allowCustomKey ? selectedKey.value : ''
  if (!props.allowCustomKey) {
    selectedKey.value = ''
    selectedUrl.value = ''
  } else if (!selectedKey.value.trim() && props.suggestedKey) {
    selectedKey.value = props.suggestedKey
    keyQuery.value = props.suggestedKey
    selectedUrl.value = buildPublicUrl(props.suggestedKey) || ''
  } else if (selectedKey.value.trim()) {
    selectedUrl.value = buildPublicUrl(selectedKey.value.trim()) || ''
  }
  await loadObjects()
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="760px"
    destroy-on-close
    append-to-body
    class="oss-picker-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div v-loading="loading" class="oss-picker">
      <el-empty
        v-if="!projectPath"
        description="未打开项目，无法读取对象存储"
        :image-size="56"
      />
      <el-empty
        v-else-if="!connections.length"
        description="暂无对象存储连接，请先在「对象存储」中配置"
        :image-size="56"
      />
      <template v-else>
        <div class="toolbar">
          <el-select
            v-model="connectionId"
            filterable
            placeholder="连接"
            class="toolbar-conn"
          >
            <el-option
              v-for="c in connections"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
          <el-select
            v-model="bucketName"
            filterable
            placeholder="桶"
            class="toolbar-bucket"
            :disabled="!connectionId"
          >
            <el-option
              v-for="b in buckets"
              :key="b.name"
              :label="b.name"
              :value="b.name"
            />
          </el-select>
          <el-input
            v-model="keyQuery"
            clearable
            placeholder="输入 key"
            class="toolbar-key"
            :disabled="!bucketName"
            @keyup.enter="runSearch"
          />
          <el-button
            type="primary"
            :icon="Search"
            :disabled="!bucketName"
            :loading="listing"
            class="toolbar-search"
            @click="runSearch"
          />
        </div>

        <div v-if="bucketName" class="list-pane" v-loading="listing">
          <div v-if="breadcrumb.length > 1" class="crumb">
            <button
              v-for="(item, i) in breadcrumb"
              :key="item.prefix + i"
              type="button"
              class="crumb-btn"
              @click="goPrefix(item.prefix)"
            >
              {{ item.label }}
            </button>
          </div>
          <div class="list-head">
            <span class="col-name">资源名称</span>
            <span class="col-action">选择</span>
          </div>
          <div class="list-body">
            <el-empty
              v-if="!entries.length"
              description="空目录"
              :image-size="48"
            />
            <button
              v-for="row in entries"
              :key="row.key"
              type="button"
              class="list-row"
              :class="{
                selected: !row.isPrefix && selectedKey === row.key,
                prefix: row.isPrefix,
              }"
              @click="selectObject(row)"
            >
              <span class="col-name">
                <span class="thumb-slot">
                  <el-icon v-if="row.isPrefix" class="file-icon folder"
                    ><Folder
                  /></el-icon>
                  <img
                    v-else-if="showImageThumb(row)"
                    class="thumb-img"
                    :src="thumbSrc(row.key)"
                    alt=""
                    @error="onThumbError(row.key)"
                  />
                  <el-icon v-else class="file-icon"><Document /></el-icon>
                </span>
                <span class="name-text">{{ displayName(row) }}</span>
                <span v-if="!row.isPrefix" class="size-hint">{{
                  row.size
                }}</span>
              </span>
              <span class="col-action">
                <span v-if="row.isPrefix" class="enter-hint">进入</span>
                <span
                  v-else-if="selectedKey === row.key"
                  class="picked-hint"
                  >已选</span
                >
                <span v-else class="pick-hint">选择</span>
              </span>
            </button>
          </div>
        </div>

        <div v-else class="list-pane list-pane--empty">
          <el-empty description="请先选择连接与桶" :image-size="48" />
        </div>

        <div v-if="selectedKey" class="selected-bar">
          <span class="selected-label">已选</span>
          <span class="selected-key" :title="selectedKey">{{
            selectedKey
          }}</span>
          <span v-if="metaLoading" class="selected-url">解析外链中…</span>
          <span v-else-if="selectedUrl" class="selected-url" :title="selectedUrl">{{
            selectedUrl
          }}</span>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button type="primary" :disabled="!canConfirm" @click="handleConfirm">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.oss-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-conn {
  width: 140px;
  flex-shrink: 0;
}

.toolbar-bucket {
  width: 140px;
  flex-shrink: 0;
}

.toolbar-key {
  flex: 1;
  min-width: 0;
}

.toolbar-search {
  width: 40px;
  padding: 8px 0;
  flex-shrink: 0;
}

.list-pane {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.list-pane--empty {
  align-items: center;
  justify-content: center;
}

.crumb {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
}

.crumb-btn {
  border: none;
  background: transparent;
  color: #409eff;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1.6;
}

.crumb-btn:not(:last-child)::after {
  content: '/';
  margin-left: 4px;
  color: #c0c4cc;
}

.list-head {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.list-body {
  flex: 1;
  overflow: auto;
  max-height: 320px;
}

.list-row {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid #f0f2f5;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #303133;
  transition: background 0.12s ease;
}

.list-row:hover {
  background: #f5f7fa;
}

.list-row.selected {
  background: #ecf5ff;
}

.list-row.prefix .name-text {
  color: #409eff;
}

.col-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.thumb-slot {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #f5f7fa;
  overflow: hidden;
}

.thumb-img {
  width: 32px;
  height: 32px;
  object-fit: cover;
  display: block;
}

.file-icon {
  font-size: 18px;
  color: #909399;
}

.file-icon.folder {
  color: #e6a23c;
}

.col-action {
  width: 56px;
  flex-shrink: 0;
  text-align: right;
  font-size: 13px;
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size-hint {
  color: #c0c4cc;
  font-size: 12px;
  flex-shrink: 0;
}

.pick-hint {
  color: #409eff;
}

.picked-hint {
  color: #67c23a;
  font-weight: 500;
}

.enter-hint {
  color: #909399;
}

.selected-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fafafa;
  font-size: 12px;
  min-width: 0;
}

.selected-label {
  flex-shrink: 0;
  color: #909399;
}

.selected-key {
  flex-shrink: 0;
  max-width: 36%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #303133;
  font-weight: 500;
}

.selected-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #909399;
}
</style>
