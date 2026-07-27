<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { useWorkspaceSettingsStore } from '../../stores/workspace-settings'
import { useProjectStore } from '../../stores/project'

const visible = ref(false)
const activeTab = ref('network')
const settings = useWorkspaceSettingsStore()
const projectStore = useProjectStore()
const pendingTab = ref('')

watch(visible, (open) => {
  if (open) {
    if (!pendingTab.value) activeTab.value = 'network'
    else {
      activeTab.value = pendingTab.value
      pendingTab.value = ''
    }
  }
})

const latencyDescription = computed(() => {
  const n = settings.apiLatencyMs
  if (n <= 0) return '设为 0 表示不延迟，预览调用 API 时立即返回数据'
  return `预览调用 API 时额外等待 ${n} ms 后再返回数据`
})

const hasProject = computed(() => projectStore.hasProject)

function open(tab?: string) {
  if (tab) {
    pendingTab.value = tab
    activeTab.value = tab
  }
  visible.value = true
}

defineExpose({ open })
</script>

<template>
  <el-tooltip content="设置" placement="bottom" :enterable="false">
    <el-button
      class="header-icon-btn settings-trigger"
      :icon="Setting"
      @click="open()"
    />
  </el-tooltip>
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
          <el-empty
            description="微信 AppID 请在「配置构建方案」的小程序应用中填写"
            :image-size="56"
          />
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
.settings-tabs :deep(.el-tabs__header) {
  margin: 0 0 4px;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0 4px;
}

.settings-empty {
  padding: 24px 0;
}

.settings-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
}

.settings-meta {
  min-width: 0;
  flex: 1;
}

.settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.settings-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.settings-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.latency-input {
  width: 120px;
}

.unit {
  font-size: 13px;
  color: #606266;
}
</style>
