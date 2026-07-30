<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, EditPen, Link, Plus, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteOssObject,
  getOssLibrary,
  getOssObjectMeta,
  listOssBuckets,
  uploadOssObject,
} from '../../api/projects'
import {
  isValidIconId,
  parseSvgSource,
  type IconDefinition,
  type IconLibrary,
} from '../../types/icon-library'
import type { OssBindingConfig } from '../../types/page-data'
import type {
  OssBucketInfo,
  OssConnectionConfig,
  OssConnectionPayload,
} from '../../types/oss'
import {
  buildIconSvgMarkup,
  buildOssPublicUrl,
  createIconOssObjectKey,
  isOssBound,
  resolveOssConnectionPayload,
  utf8ToBase64,
} from '../../utils/oss-binding'

const props = defineProps<{
  library: IconLibrary
  projectPath?: string | null
}>()

const emit = defineEmits<{
  'update:library': [library: IconLibrary]
}>()

const icons = computed({
  get: () => props.library.icons,
  set(value: IconDefinition[]) {
    emit('update:library', { icons: value })
  },
})

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = reactive({
  id: '',
  label: '',
  rawSvg: '',
})

const bindDialogVisible = ref(false)
const bindingIconId = ref('')
const bindBusy = ref(false)
const bindLoading = ref(false)
const bindHydrating = ref(false)
const bindConnections = ref<OssConnectionConfig[]>([])
const bindConnectionId = ref('')
const bindBucketName = ref('')

const bindingIcon = computed(
  () => icons.value.find((item) => item.id === bindingIconId.value) ?? null,
)

const bindActiveConnection = computed(
  () =>
    bindConnections.value.find((c) => c.id === bindConnectionId.value) ?? null,
)

const bindBuckets = computed<OssBucketInfo[]>(
  () => bindActiveConnection.value?.buckets ?? [],
)

const bindPayload = computed<OssConnectionPayload | null>(() => {
  const c = bindActiveConnection.value
  if (!c) return null
  return {
    endpoint: c.endpoint,
    region: c.region,
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    forcePathStyle: c.forcePathStyle,
  }
})

function openCreate() {
  editingId.value = null
  form.id = ''
  form.label = ''
  form.rawSvg = ''
  dialogVisible.value = true
}

function openEdit(icon: IconDefinition) {
  editingId.value = icon.id
  form.id = icon.id
  form.label = icon.label
  form.rawSvg = buildIconSvgMarkup(icon.viewBox, icon.content)
  dialogVisible.value = true
}

function updateIcon(id: string, patch: Partial<IconDefinition>) {
  icons.value = icons.value.map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  )
}

async function syncIconToOss(icon: IconDefinition): Promise<OssBindingConfig | null> {
  const binding = icon.ossBinding
  if (!isOssBound(binding)) return null
  const path = props.projectPath?.trim()
  if (!path) throw new Error('未打开项目，无法同步对象存储')

  const payload = await resolveOssConnectionPayload(path, binding)
  const svg = buildIconSvgMarkup(icon.viewBox, icon.content)
  await uploadOssObject({
    ...payload,
    bucketName: binding.bucketName,
    key: binding.objectKey,
    contentBase64: utf8ToBase64(svg),
    contentType: 'image/svg+xml',
  })

  let url =
    binding.url ||
    buildOssPublicUrl(payload, binding.bucketName, binding.objectKey) ||
    ''
  try {
    const meta = await getOssObjectMeta({
      ...payload,
      bucketName: binding.bucketName,
      key: binding.objectKey,
    })
    if (meta.publicUrl) url = meta.publicUrl
  } catch {
    // 保留原外链
  }

  return {
    ...binding,
    url,
  }
}

async function deleteIconFromOss(icon: IconDefinition) {
  const binding = icon.ossBinding
  if (!isOssBound(binding)) return
  const path = props.projectPath?.trim()
  if (!path) throw new Error('未打开项目，无法同步对象存储')
  const payload = await resolveOssConnectionPayload(path, binding)
  await deleteOssObject({
    ...payload,
    bucketName: binding.bucketName,
    key: binding.objectKey,
  })
}

async function removeIcon(icon: IconDefinition) {
  const bound = isOssBound(icon.ossBinding)
  try {
    await ElMessageBox.confirm(
      bound
        ? `确定删除图标「${icon.label || icon.id}」吗？将同时删除对象存储中的对应文件。`
        : `确定删除图标「${icon.label || icon.id}」吗？引用该图标的控件将显示占位。`,
      '删除图标',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  if (bound) {
    try {
      await deleteIconFromOss(icon)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除对象存储文件失败')
      return
    }
  }

  icons.value = icons.value.filter((item) => item.id !== icon.id)
  ElMessage.success('已删除图标')
}

async function refreshBindBuckets() {
  const payload = bindPayload.value
  if (!payload) return
  try {
    const result = await listOssBuckets(payload)
    const conn = bindActiveConnection.value
    if (conn) conn.buckets = result.buckets
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '列出桶失败')
  }
}

async function openBind(icon: IconDefinition) {
  const path = props.projectPath?.trim()
  if (!path) {
    ElMessage.warning('未打开项目，无法绑定对象存储')
    return
  }
  bindingIconId.value = icon.id
  bindDialogVisible.value = true
  bindLoading.value = true
  bindHydrating.value = true
  try {
    const preferredConn = icon.ossBinding?.connectionId || ''
    const preferredBucket = icon.ossBinding?.bucketName || ''
    const lib = await getOssLibrary(path)
    bindConnections.value = lib.connections ?? []
    bindConnectionId.value =
      (preferredConn &&
        bindConnections.value.some((c) => c.id === preferredConn) &&
        preferredConn) ||
      bindConnections.value[0]?.id ||
      ''
    if (bindConnectionId.value && !bindBuckets.value.length) {
      await refreshBindBuckets()
    }
    bindBucketName.value =
      (preferredBucket &&
        bindBuckets.value.some((b) => b.name === preferredBucket) &&
        preferredBucket) ||
      bindBuckets.value[0]?.name ||
      ''
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载对象存储失败')
    bindConnections.value = []
    bindConnectionId.value = ''
    bindBucketName.value = ''
  } finally {
    bindLoading.value = false
    bindHydrating.value = false
  }
}

watch(bindConnectionId, async (id, prev) => {
  if (!bindDialogVisible.value || bindHydrating.value || !id || id === prev) {
    return
  }
  bindBucketName.value = ''
  await refreshBindBuckets()
  bindBucketName.value = bindBuckets.value[0]?.name || ''
})

async function confirmBind() {
  const icon = bindingIcon.value
  const payload = bindPayload.value
  if (!icon || !payload) return
  if (!bindConnectionId.value || !bindBucketName.value) {
    ElMessage.warning('请选择连接和桶')
    return
  }

  bindBusy.value = true
  try {
    const prevBinding = icon.ossBinding
    if (isOssBound(prevBinding)) {
      try {
        await deleteIconFromOss(icon)
      } catch {
        // 旧对象删除失败不阻断重新绑定
      }
    }

    const objectKey = createIconOssObjectKey()
    const svg = buildIconSvgMarkup(icon.viewBox, icon.content)
    await uploadOssObject({
      ...payload,
      bucketName: bindBucketName.value,
      key: objectKey,
      contentBase64: utf8ToBase64(svg),
      contentType: 'image/svg+xml',
    })

    let url = buildOssPublicUrl(payload, bindBucketName.value, objectKey) || ''
    try {
      const meta = await getOssObjectMeta({
        ...payload,
        bucketName: bindBucketName.value,
        key: objectKey,
      })
      if (meta.publicUrl) url = meta.publicUrl
    } catch {
      // 保留拼出的外链
    }

    const config: OssBindingConfig = {
      connectionId: bindConnectionId.value,
      bucketName: bindBucketName.value,
      objectKey,
      url,
    }
    updateIcon(icon.id, { ossBinding: config })
    bindDialogVisible.value = false
    ElMessage.success('已绑定并上传到对象存储')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '绑定对象存储失败')
  } finally {
    bindBusy.value = false
  }
}

async function unbindIcon(icon: IconDefinition) {
  if (!isOssBound(icon.ossBinding)) return
  try {
    await ElMessageBox.confirm(
      `确定解绑「${icon.label || icon.id}」吗？仅清除绑定关系，不会删除对象存储中的文件。`,
      '解绑对象存储',
      {
        type: 'warning',
        confirmButtonText: '解绑',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  icons.value = icons.value.map((item) => {
    if (item.id !== icon.id) return item
    const { ossBinding: _removed, ...rest } = item
    return rest
  })
  ElMessage.success('已解绑')
}

async function saveIcon() {
  const id = form.id.trim()
  if (!isValidIconId(id)) {
    ElMessage.error('图标 ID 需以字母开头，仅含字母、数字、下划线和短横线')
    return
  }

  const parsed = parseSvgSource(form.rawSvg)
  if (!parsed?.content) {
    ElMessage.error('请粘贴有效的 SVG 代码')
    return
  }

  const duplicate = icons.value.some(
    (item) => item.id === id && item.id !== editingId.value,
  )
  if (duplicate) {
    ElMessage.error('图标 ID 已存在')
    return
  }

  const prev = editingId.value
    ? icons.value.find((item) => item.id === editingId.value)
    : undefined

  const next: IconDefinition = {
    id,
    label: form.label.trim() || id,
    viewBox: parsed.viewBox || '0 0 24 24',
    content: parsed.content,
    ...(prev?.ossBinding ? { ossBinding: prev.ossBinding } : {}),
  }

  saving.value = true
  try {
    if (isOssBound(next.ossBinding)) {
      const synced = await syncIconToOss(next)
      if (synced) next.ossBinding = synced
    }

    if (editingId.value) {
      icons.value = icons.value.map((item) =>
        item.id === editingId.value ? next : item,
      )
    } else {
      icons.value = [...icons.value, next]
    }

    dialogVisible.value = false
    ElMessage.success(editingId.value ? '已更新图标' : '已添加图标')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '同步对象存储失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="icon-library-panel">
    <div class="panel-toolbar">
      <div class="toolbar-text">
        <div class="title">图标库</div>
        <div class="desc">项目级 SVG 符号表，控件通过 iconId 引用，不重复内联代码</div>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加图标</el-button>
    </div>

    <el-empty
      v-if="!icons.length"
      description="暂无图标，点击添加自定义 SVG"
      :image-size="72"
    />

    <div v-else class="icon-grid">
      <div v-for="icon in icons" :key="icon.id" class="icon-card">
        <div class="icon-main">
          <div class="icon-preview">
            <svg
              class="preview-svg"
              :viewBox="icon.viewBox"
              aria-hidden="true"
              v-html="icon.content"
            />
          </div>
          <div class="icon-meta">
            <div class="icon-label" :title="icon.label">{{ icon.label }}</div>
            <div class="icon-id" :title="icon.id">{{ icon.id }}</div>
            <div v-if="isOssBound(icon.ossBinding)" class="icon-bound" title="已绑定对象存储">
              已绑定
            </div>
          </div>
        </div>
        <div class="icon-actions">
          <el-tooltip
            :content="isOssBound(icon.ossBinding) ? '重新绑定' : '绑定'"
            placement="top"
          >
            <el-button
              :icon="Upload"
              text
              circle
              :disabled="bindBusy"
              @click.stop="openBind(icon)"
            />
          </el-tooltip>
          <el-tooltip
            v-if="isOssBound(icon.ossBinding)"
            content="解绑"
            placement="top"
          >
            <el-button
              :icon="Link"
              text
              circle
              @click.stop="unbindIcon(icon)"
            />
          </el-tooltip>
          <el-tooltip content="编辑" placement="top">
            <el-button
              :icon="EditPen"
              text
              circle
              @click.stop="openEdit(icon)"
            />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button
              :icon="Delete"
              text
              circle
              type="danger"
              @click.stop="removeIcon(icon)"
            />
          </el-tooltip>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑图标' : '添加图标'"
      width="560px"
      destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <el-form label-position="top" size="default">
        <el-form-item label="图标 ID" required>
          <el-input
            v-model="form.id"
            :disabled="Boolean(editingId)"
            placeholder="例如：home"
          />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="form.label" placeholder="例如：首页" />
        </el-form-item>
        <el-form-item label="SVG 代码" required>
          <el-input
            v-model="form.rawSvg"
            type="textarea"
            :rows="8"
            placeholder="粘贴完整 <svg>...</svg>，或仅内部 path 等 markup"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="saving" @click="saveIcon">
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bindDialogVisible"
      title="绑定对象存储"
      width="420px"
      destroy-on-close
      append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <div v-loading="bindLoading" class="bind-form">
        <el-empty
          v-if="!projectPath"
          description="未打开项目，无法读取对象存储"
          :image-size="56"
        />
        <el-empty
          v-else-if="!bindConnections.length"
          description="暂无对象存储连接，请先在「对象存储」中配置"
          :image-size="56"
        />
        <el-form v-else label-position="top" size="default">
          <el-form-item label="连接" required>
            <el-select
              v-model="bindConnectionId"
              filterable
              placeholder="选择连接"
              style="width: 100%"
            >
              <el-option
                v-for="c in bindConnections"
                :key="c.id"
                :label="c.name"
                :value="c.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="桶" required>
            <el-select
              v-model="bindBucketName"
              filterable
              placeholder="选择桶"
              style="width: 100%"
              :disabled="!bindConnectionId"
            >
              <el-option
                v-for="b in bindBuckets"
                :key="b.name"
                :label="b.name"
                :value="b.name"
              />
            </el-select>
          </el-form-item>
          <p class="bind-hint">将自动生成以 icon_ 开头的对象 key，并上传当前 SVG。</p>
        </el-form>
      </div>
      <template #footer>
        <el-button
          type="primary"
          :loading="bindBusy"
          :disabled="!bindConnectionId || !bindBucketName"
          @click="confirmBind"
        >
          绑定并上传
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.icon-library-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
  box-sizing: border-box;
  background: #fff;
}

.panel-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.toolbar-text .title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.toolbar-text .desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.icon-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  align-content: start;
}

.icon-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  box-sizing: border-box;
  min-width: 0;
}

.icon-card:hover {
  border-color: #dcdfe6;
}

.icon-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.icon-preview {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafbfc;
  color: #303133;
}

.preview-svg {
  width: 32px;
  height: 32px;
  display: block;
}

.icon-meta {
  min-width: 0;
  flex: 1;
}

.icon-label {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-id {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-bound {
  margin-top: 6px;
  display: inline-block;
  font-size: 11px;
  color: #67c23a;
  line-height: 1;
}

.icon-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
}

.bind-form {
  min-height: 120px;
}

.bind-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
