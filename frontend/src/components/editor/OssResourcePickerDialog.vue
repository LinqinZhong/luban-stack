<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getOssLibrary,
  getOssObjectMeta,
  listOssBuckets,
  listOssObjects,
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
const entries = ref<OssObjectInfo[]>([])
const selectedKey = ref('')
const selectedUrl = ref('')
const metaLoading = ref(false)
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
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '列出对象失败')
    entries.value = []
  } finally {
    listing.value = false
  }
}

async function selectObject(row: OssObjectInfo) {
  if (row.isPrefix) {
    prefix.value = row.key.endsWith('/') ? row.key : `${row.key}/`
    selectedKey.value = ''
    selectedUrl.value = ''
    await loadObjects()
    return
  }
  selectedKey.value = row.key
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
  selectedKey.value = ''
  selectedUrl.value = ''
  void loadObjects()
}

function onCustomKeyInput(value: string) {
  selectedKey.value = value
  selectedUrl.value = buildPublicUrl(value.trim()) || ''
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
  if (!props.allowCustomKey) {
    selectedKey.value = ''
    selectedUrl.value = ''
  } else if (!selectedKey.value.trim() && props.suggestedKey) {
    selectedKey.value = props.suggestedKey
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
    width="720px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
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
        <div class="picker-row">
          <span class="picker-label">连接</span>
          <el-select
            v-model="connectionId"
            filterable
            placeholder="选择连接"
            style="flex: 1"
          >
            <el-option
              v-for="c in connections"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </div>
        <div class="picker-row">
          <span class="picker-label">桶</span>
          <el-select
            v-model="bucketName"
            filterable
            placeholder="选择桶"
            style="flex: 1"
            :disabled="!connectionId"
          >
            <el-option
              v-for="b in buckets"
              :key="b.name"
              :label="b.name"
              :value="b.name"
            />
          </el-select>
        </div>

        <div v-if="bucketName" class="objects-pane" v-loading="listing">
          <div class="crumb">
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
          <el-table
            :data="entries"
            height="280"
            size="small"
            empty-text="空目录"
            highlight-current-row
            @row-click="selectObject"
          >
            <el-table-column label="名称" min-width="220">
              <template #default="{ row }">
                <span class="obj-name" :class="{ prefix: row.isPrefix }">
                  <el-icon v-if="row.isPrefix"><Folder /></el-icon>
                  {{ displayName(row) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="100">
              <template #default="{ row }">
                {{ row.isPrefix ? '—' : row.size }}
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="allowCustomKey" class="picker-row">
          <span class="picker-label">对象 key</span>
          <el-input
            :model-value="selectedKey"
            placeholder="例如 icons/home.svg，可点上方文件回填"
            style="flex: 1"
            @update:model-value="onCustomKeyInput"
          />
        </div>

        <div class="selected-box">
          <div class="picker-label">已选外链</div>
          <el-input
            :model-value="selectedUrl"
            type="textarea"
            :rows="2"
            readonly
            :placeholder="
              metaLoading
                ? '解析中…'
                : allowCustomKey
                  ? '选择连接与桶后自动生成，或点击上方文件'
                  : '点击上方文件选择'
            "
          />
        </div>
      </template>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
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

.picker-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.picker-label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: #606266;
  text-align: right;
}

.objects-pane {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.crumb {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
}

.crumb-btn {
  border: none;
  background: transparent;
  color: #409eff;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.crumb-btn:not(:last-child)::after {
  content: '/';
  margin-left: 4px;
  color: #c0c4cc;
}

.obj-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.obj-name.prefix {
  color: #409eff;
  cursor: pointer;
}

.selected-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.selected-box .picker-label {
  width: auto;
  text-align: left;
}
</style>
