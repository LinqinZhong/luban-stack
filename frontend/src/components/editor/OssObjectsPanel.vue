<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, Plus, Refresh, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteOssObject,
  getOssObjectMeta,
  listOssObjects,
  signOssObject,
  uploadOssObject,
} from '../../api/projects'
import type {
  OssBucketInfo,
  OssConnectionPayload,
  OssObjectInfo,
} from '../../types/oss'
import BackLink from './BackLink.vue'

const props = defineProps<{
  connection: OssConnectionPayload | null
  bucket: OssBucketInfo
}>()

const emit = defineEmits<{
  back: []
}>()

const loading = ref(false)
const uploading = ref(false)
const prefix = ref('')
const entries = ref<OssObjectInfo[]>([])
const isTruncated = ref(false)
const nextToken = ref<string | null>(null)
const uploadVisible = ref(false)
const uploadKey = ref('')
const uploadFile = ref<File | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const metaVisible = ref(false)
const metaLoading = ref(false)
const objectMeta = ref<{
  key: string
  size: number
  contentType: string
  lastModified: string | null
  etag: string
  publicUrl: string
  signedUrl: string
  isImage: boolean
} | null>(null)
const previewBroken = ref(false)
/** 私有桶缩略图：key → signedUrl */
const signedThumbMap = ref<Record<string, string>>({})

const isPrivateBucket = computed(() => props.bucket.access !== 'public')

const breadcrumb = computed(() => {
  const parts = prefix.value.split('/').filter(Boolean)
  const items: { label: string; prefix: string }[] = [{ label: props.bucket.name, prefix: '' }]
  let acc = ''
  for (const part of parts) {
    acc += `${part}/`
    items.push({ label: part, prefix: acc })
  }
  return items
})

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

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

function buildPublicUrl(key: string): string | null {
  const conn = props.connection
  if (!conn?.endpoint) return null
  const endpoint = conn.endpoint.trim().replace(/\/+$/, '')
  const encodedKey = key
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  try {
    if (conn.forcePathStyle !== false) {
      return `${endpoint}/${props.bucket.name}/${encodedKey}`
    }
    const url = new URL(endpoint)
    return `${url.protocol}//${props.bucket.name}.${url.host}/${encodedKey}`
  } catch {
    return null
  }
}

async function copyText(text: string, successMsg = '已复制外链') {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(successMsg)
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

async function copyObjectLink(row: OssObjectInfo) {
  if (row.isPrefix || !props.connection) return
  if (isPrivateBucket.value) {
    try {
      const result = await signOssObject({
        ...props.connection,
        bucketName: props.bucket.name,
        key: row.key,
      })
      await copyText(result.signedUrl, '已复制临时签名链接（约 1 小时有效）')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '签名失败')
    }
    return
  }
  const url = buildPublicUrl(row.key)
  if (!url) {
    ElMessage.warning('无法生成外链，请检查 Endpoint 配置')
    return
  }
  await copyText(url)
}

function thumbSrc(key: string): string | undefined {
  if (isPrivateBucket.value) return signedThumbMap.value[key]
  return buildPublicUrl(key) || undefined
}

async function refreshSignedThumbs(rows: OssObjectInfo[]) {
  if (!props.connection || !isPrivateBucket.value) {
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
          ...props.connection!,
          bucketName: props.bucket.name,
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

async function loadObjects(append = false) {
  if (!props.connection) return
  loading.value = true
  try {
    const result = await listOssObjects({
      ...props.connection,
      bucketName: props.bucket.name,
      prefix: prefix.value,
      continuationToken: append ? nextToken.value || undefined : undefined,
    })
    const next = [...result.prefixes, ...result.objects]
    entries.value = append ? [...entries.value, ...next] : next
    isTruncated.value = result.isTruncated
    nextToken.value = result.nextContinuationToken
    if (!append) signedThumbMap.value = {}
    void refreshSignedThumbs(entries.value)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载对象失败')
  } finally {
    loading.value = false
  }
}

function goPrefix(nextPrefix: string) {
  prefix.value = nextPrefix
  void loadObjects()
}

function openEntry(row: OssObjectInfo) {
  if (row.isPrefix) {
    goPrefix(row.key)
    return
  }
  void viewMeta(row)
}

async function viewMeta(row: OssObjectInfo) {
  if (!props.connection || row.isPrefix) return
  metaVisible.value = true
  metaLoading.value = true
  objectMeta.value = null
  previewBroken.value = false
  try {
    objectMeta.value = await getOssObjectMeta({
      ...props.connection,
      bucketName: props.bucket.name,
      key: row.key,
    })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '获取对象信息失败')
    metaVisible.value = false
  } finally {
    metaLoading.value = false
  }
}

function openUpload() {
  uploadKey.value = prefix.value
  uploadFile.value = null
  uploadVisible.value = true
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  uploadFile.value = file
  if (file && (!uploadKey.value || uploadKey.value.endsWith('/'))) {
    uploadKey.value = `${prefix.value}${file.name}`
  }
  input.value = ''
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function handleUpload() {
  if (!props.connection) return
  const key = uploadKey.value.trim().replace(/^\/+/, '')
  if (!key || key.endsWith('/')) {
    ElMessage.error('请填写完整的对象 Key（含文件名）')
    return
  }
  if (!uploadFile.value) {
    ElMessage.error('请选择要上传的文件')
    return
  }
  if (uploadFile.value.size > 32 * 1024 * 1024) {
    ElMessage.error('单次上传不超过 32MB')
    return
  }
  uploading.value = true
  try {
    const contentBase64 = await readFileAsBase64(uploadFile.value)
    await uploadOssObject({
      ...props.connection,
      bucketName: props.bucket.name,
      key,
      contentBase64,
      contentType: uploadFile.value.type || 'application/octet-stream',
    })
    ElMessage.success(`已上传 ${key}`)
    uploadVisible.value = false
    await loadObjects()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

async function removeObject(row: OssObjectInfo) {
  if (!props.connection || row.isPrefix) return
  try {
    await ElMessageBox.confirm(
      `确定删除对象「${row.key}」吗？此操作不可恢复。`,
      '删除对象',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  loading.value = true
  try {
    await deleteOssObject({
      ...props.connection,
      bucketName: props.bucket.name,
      key: row.key,
    })
    ElMessage.success('已删除')
    await loadObjects()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.bucket?.name, props.connection?.endpoint] as const,
  () => {
    prefix.value = ''
    entries.value = []
    nextToken.value = null
    void loadObjects()
  },
  { immediate: true },
)
</script>

<template>
  <div v-loading="loading" class="oss-objects">
    <div class="pane-head">
      <BackLink @click="emit('back')" />
      <div class="crumbs">
        <button
          v-for="(item, index) in breadcrumb"
          :key="item.prefix + index"
          type="button"
          class="crumb"
          :class="{ current: index === breadcrumb.length - 1 }"
          @click="goPrefix(item.prefix)"
        >
          {{ item.label }}
          <span v-if="index < breadcrumb.length - 1" class="sep">/</span>
        </button>
      </div>
      <el-button type="primary" link :icon="Refresh" @click="loadObjects()">
        刷新
      </el-button>
      <el-button type="primary" link :icon="Upload" @click="openUpload">
        上传
      </el-button>
    </div>

    <el-empty
      v-if="!entries.length"
      description="暂无对象，点击上传"
      :image-size="64"
    />
    <div v-else class="table-wrap">
      <el-table :data="entries" border stripe empty-text="无对象">
        <el-table-column label="名称" min-width="240">
          <template #default="{ row }">
            <button type="button" class="name-btn" @click="openEntry(row)">
              <el-icon v-if="row.isPrefix" class="folder-icon"><Folder /></el-icon>
              <img
                v-else-if="isImageKey(row.key)"
                class="thumb"
                :src="thumbSrc(row.key)"
                alt=""
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              {{ displayName(row) }}
            </button>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            {{ row.isPrefix ? '目录' : isImageKey(row.key) ? '图片' : '文件' }}
          </template>
        </el-table-column>
        <el-table-column label="大小" width="110" align="right">
          <template #default="{ row }">
            {{ row.isPrefix ? '—' : formatSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column label="修改时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.lastModified) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <template v-if="!row.isPrefix">
              <el-button type="primary" link @click="viewMeta(row)">
                查看
              </el-button>
              <el-button type="primary" link @click="copyObjectLink(row)">
                复制外链
              </el-button>
              <el-button type="danger" link @click="removeObject(row)">
                删除
              </el-button>
            </template>
            <el-button v-else type="primary" link @click="openEntry(row)">
              打开
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="isTruncated" class="more-row">
        <el-button type="primary" link :icon="Plus" @click="loadObjects(true)">
          加载更多
        </el-button>
      </div>
    </div>

    <el-dialog
      v-model="uploadVisible"
      title="上传对象"
      width="560px"
      destroy-on-close
      append-to-body
    >
      <div class="upload-form">
        <div class="form-item">
          <div class="label">对象 Key</div>
          <div class="content">
            <el-input v-model="uploadKey" placeholder="path/to/file.png" />
          </div>
        </div>
        <div class="form-item">
          <div class="label">文件</div>
          <div class="content file-row">
            <el-button @click="fileInputRef?.click()">选择文件</el-button>
            <span class="file-name">{{ uploadFile?.name || '未选择' }}</span>
            <input
              ref="fileInputRef"
              type="file"
              class="hidden-input"
              @change="onFileChange"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="uploadVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="handleUpload">
          上传
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="metaVisible"
      title="对象信息"
      width="640px"
      destroy-on-close
      append-to-body
    >
      <div v-loading="metaLoading" class="meta-body">
        <template v-if="objectMeta">
          <div v-if="objectMeta.isImage" class="preview-wrap">
            <img
              v-if="!previewBroken"
              class="preview-img"
              :src="objectMeta.signedUrl || objectMeta.publicUrl"
              :alt="objectMeta.key"
              @error="previewBroken = true"
            />
            <div v-else class="preview-fallback">图片无法预览（可能未公开或链接失效）</div>
          </div>
          <div class="meta-row"><span>Key</span><code>{{ objectMeta.key }}</code></div>
          <div class="meta-row">
            <span>大小</span><code>{{ formatSize(objectMeta.size) }}</code>
          </div>
          <div class="meta-row">
            <span>类型</span><code>{{ objectMeta.contentType }}</code>
          </div>
          <div class="meta-row">
            <span>外链</span>
            <div class="url-row">
              <code>{{ objectMeta.publicUrl }}</code>
              <el-button type="primary" link @click="copyText(objectMeta.publicUrl)">
                复制
              </el-button>
            </div>
          </div>
          <div class="meta-row">
            <span>ETag</span><code>{{ objectMeta.etag || '—' }}</code>
          </div>
          <div class="meta-row">
            <span>修改时间</span><code>{{ formatTime(objectMeta.lastModified) }}</code>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.oss-objects {
  height: 100%;
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

.crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  overflow: hidden;
}

.crumb {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 13px;
  color: #409eff;
  cursor: pointer;
  line-height: 1.2;
}

.crumb.current {
  color: #303133;
  font-weight: 600;
  cursor: default;
}

.sep {
  margin-left: 4px;
  color: #c0c4cc;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.name-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
}

.name-btn:hover {
  color: #409eff;
}

.folder-icon {
  color: #e6a23c;
}

.thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #ebeef5;
  background: #f5f7fa;
  flex-shrink: 0;
}

.more-row {
  display: flex;
  justify-content: center;
  padding: 12px 0 4px;
}

.upload-form {
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

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.file-name {
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-input {
  display: none;
}

.meta-body {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 160px;
  max-height: 360px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  overflow: hidden;
}

.preview-img {
  max-width: 100%;
  max-height: 336px;
  object-fit: contain;
}

.preview-fallback {
  font-size: 13px;
  color: #94a3b8;
}

.meta-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
  font-size: 13px;
  color: #606266;
  align-items: start;
}

.meta-row code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #303133;
  word-break: break-all;
}

.url-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.url-row code {
  flex: 1;
  min-width: 0;
}
</style>
