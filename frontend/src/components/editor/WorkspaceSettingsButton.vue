<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useWorkspaceSettingsStore } from '../../stores/workspace-settings'
import { useProjectStore } from '../../stores/project'
import { patchProjectConfig } from '../../api/projects'

const visible = ref(false)
const activeTab = ref('network')
const settings = useWorkspaceSettingsStore()
const projectStore = useProjectStore()

const wechatAppIdDraft = ref('')
const savingWechatAppId = ref(false)

watch(visible, (open) => {
  if (open) {
    activeTab.value = 'network'
    wechatAppIdDraft.value = projectStore.config?.wechatAppId ?? ''
  }
})

watch(
  () => projectStore.config?.wechatAppId,
  (value) => {
    if (!visible.value) return
    wechatAppIdDraft.value = value ?? ''
  },
)

const latencyDescription = computed(() => {
  const n = settings.apiLatencyMs
  if (n <= 0) return '设为 0 表示不延迟，预览调用 API 时立即返回数据'
  return `预览调用 API 时额外等待 ${n} ms 后再返回数据`
})

const hasProject = computed(() => projectStore.hasProject)

function open() {
  visible.value = true
}

async function saveWechatAppId() {
  if (!projectStore.path || !projectStore.config) {
    ElMessage.warning('请先打开项目')
    return
  }
  const next = wechatAppIdDraft.value.trim()
  const prev = projectStore.config.wechatAppId ?? ''
  if (next === prev) return

  savingWechatAppId.value = true
  try {
    const result = await patchProjectConfig({
      projectPath: projectStore.path,
      wechatAppId: next || null,
    })
    projectStore.setProject(result.path, result.config)
    wechatAppIdDraft.value = result.config.wechatAppId ?? ''
    ElMessage.success('已保存到项目配置')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
    wechatAppIdDraft.value = projectStore.config?.wechatAppId ?? ''
  } finally {
    savingWechatAppId.value = false
  }
}
</script>

<template>
  <el-button
    :icon="Setting"
    class="settings-trigger"
    title="设置"
    aria-label="设置"
    @click="open"
  />
  <el-dialog
    v-model="visible"
    title="设置"
    width="560px"
    append-to-body
    destroy-on-close
    class="workspace-settings-dialog"
    align-center
  >
    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="工作台" name="workbench">
        <el-empty description="暂无设置" :image-size="56" />
      </el-tab-pane>
      <el-tab-pane label="项目" name="project">
        <div v-if="!hasProject" class="settings-empty">
          <el-empty description="请先打开项目" :image-size="56" />
        </div>
        <div v-else class="settings-list">
          <div class="settings-row">
            <div class="settings-meta">
              <div class="settings-title">微信小程序 AppID</div>
              <div class="settings-desc">
                写入项目 voider.json，供小程序相关能力使用
              </div>
            </div>
            <div class="settings-control settings-control--wide">
              <el-input
                v-model="wechatAppIdDraft"
                clearable
                placeholder="例如 wx1234567890abcdef"
                class="appid-input"
                :disabled="savingWechatAppId"
                @change="saveWechatAppId"
                @keyup.enter="saveWechatAppId"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="文件" name="file">
        <el-empty description="暂无设置" :image-size="56" />
      </el-tab-pane>
      <el-tab-pane label="网络" name="network">
        <div class="settings-list">
          <div class="settings-row">
            <div class="settings-meta">
              <div class="settings-title">模拟 API 延迟</div>
              <div class="settings-desc">{{ latencyDescription }}</div>
            </div>
            <div class="settings-control">
              <el-input-number
                v-model="settings.apiLatencyMs"
                :min="0"
                :max="60000"
                :step="100"
                controls-position="right"
                class="latency-input"
              />
              <span class="unit">ms</span>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.settings-trigger {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
}

.settings-tabs :deep(.el-tabs__header) {
  margin: 0 0 4px;
}

.settings-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background-color: #ebeef5;
}

.settings-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  color: #909399;
}

.settings-tabs :deep(.el-tabs__item.is-active) {
  color: #409eff;
  font-weight: 500;
}

.settings-tabs :deep(.el-tab-pane) {
  min-height: 120px;
}

.settings-empty {
  padding: 8px 0;
}

.settings-list {
  margin: 0 -4px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 4px;
  border-bottom: 1px solid #ebeef5;
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-meta {
  flex: 1;
  min-width: 0;
}

.settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  line-height: 1.4;
}

.settings-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.settings-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.settings-control--wide {
  width: min(240px, 42%);
}

.appid-input {
  width: 100%;
}

.latency-input {
  width: 128px;
}

.unit {
  font-size: 13px;
  color: #606266;
  min-width: 22px;
}
</style>

<style>
/* dialog 挂到 body，需非 scoped */
.workspace-settings-dialog.el-dialog {
  border-radius: 10px;
  overflow: hidden;
}

.workspace-settings-dialog .el-dialog__header {
  padding: 16px 20px 8px;
  margin-right: 0;
}

.workspace-settings-dialog .el-dialog__title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.workspace-settings-dialog .el-dialog__body {
  padding: 0 20px 20px;
}
</style>
