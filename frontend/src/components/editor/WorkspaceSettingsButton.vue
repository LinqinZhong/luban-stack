<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import {
  useWorkspaceSettingsStore,
  type AiApiType,
  type AiModelConfig,
} from '../../stores/workspace-settings'
import { useProjectStore } from '../../stores/project'

const visible = ref(false)
const activeTab = ref('network')
const settings = useWorkspaceSettingsStore()
const projectStore = useProjectStore()
const pendingTab = ref('')

const modelDialogVisible = ref(false)
const editingModelId = ref<string | null>(null)
const modelForm = reactive({
  name: '',
  apiType: 'openai' as AiApiType,
  baseUrl: '',
  apiKey: '',
  modelId: '',
  thinking: false,
})

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

const modelDialogTitle = computed(() =>
  editingModelId.value ? '编辑模型' : '添加模型',
)

function open(tab?: string) {
  if (tab) {
    pendingTab.value = tab
    activeTab.value = tab
  }
  visible.value = true
}

function resetModelForm() {
  modelForm.name = ''
  modelForm.apiType = 'openai'
  modelForm.baseUrl = ''
  modelForm.apiKey = ''
  modelForm.modelId = ''
  modelForm.thinking = false
}

function openAddModel() {
  editingModelId.value = null
  resetModelForm()
  modelDialogVisible.value = true
}

function openEditModel(model: AiModelConfig) {
  editingModelId.value = model.id
  modelForm.name = model.name
  modelForm.apiType = model.apiType
  modelForm.baseUrl = model.baseUrl
  modelForm.apiKey = model.apiKey
  modelForm.modelId = model.modelId
  modelForm.thinking = model.thinking
  modelDialogVisible.value = true
}

function saveModel() {
  const name = modelForm.name.trim()
  if (!name) {
    ElMessage.warning('请填写模型名称')
    return
  }
  settings.upsertAiModel({
    id: editingModelId.value ?? undefined,
    name,
    apiType: modelForm.apiType,
    baseUrl: modelForm.baseUrl,
    apiKey: modelForm.apiKey,
    modelId: modelForm.modelId,
    thinking: modelForm.thinking,
  })
  modelDialogVisible.value = false
  ElMessage.success(editingModelId.value ? '模型已更新' : '模型已添加')
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
    :close-on-click-modal="false"
    :close-on-press-escape="false"
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
      <el-tab-pane label="AI助手" name="ai">
        <div class="settings-list">
          <div class="settings-row">
            <div class="settings-meta">
              <div class="settings-title">开启AI助手</div>
              <div class="settings-desc">开启后在顶栏显示 AI 按钮，模型在浮窗中选择</div>
            </div>
            <div class="settings-control">
              <el-switch v-model="settings.aiAssistantEnabled" />
            </div>
          </div>

          <div
            v-for="model in settings.aiModels"
            :key="model.id"
            class="settings-row model-row"
          >
            <div class="settings-meta">
              <div class="settings-title">
                模型：{{ model.name }}
                <span
                  v-if="model.id === settings.activeAiModelId"
                  class="active-tag"
                >使用中</span>
              </div>
              <div class="settings-desc">
                {{ model.apiType === 'anthropic' ? 'Anthropic' : 'OpenAI' }}
                <template v-if="model.modelId"> · {{ model.modelId }}</template>
              </div>
            </div>
            <div class="settings-control model-actions">
              <el-button size="small" @click="openEditModel(model)">编辑</el-button>
            </div>
          </div>

          <div class="add-model-row">
            <el-button type="primary" plain @click="openAddModel">添加模型</el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>

  <el-dialog
    v-model="modelDialogVisible"
    :title="modelDialogTitle"
    width="480px"
    append-to-body
    destroy-on-close
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form label-width="96px" class="model-form">
      <el-form-item label="模型名称" required>
        <el-input v-model="modelForm.name" placeholder="例如 GPT-4o" />
      </el-form-item>
      <el-form-item label="API类型">
        <el-select v-model="modelForm.apiType" style="width: 100%">
          <el-option label="openai" value="openai" />
          <el-option label="Anthropic" value="anthropic" />
        </el-select>
      </el-form-item>
      <el-form-item label="BaseUrl">
        <el-input v-model="modelForm.baseUrl" placeholder="https://api.openai.com/v1" />
      </el-form-item>
      <el-form-item label="ApiKey">
        <el-input
          v-model="modelForm.apiKey"
          type="password"
          show-password
          placeholder="API Key"
        />
      </el-form-item>
      <el-form-item label="模型ID">
        <el-input v-model="modelForm.modelId" placeholder="例如 gpt-4o" />
      </el-form-item>
      <el-form-item label="思考">
        <el-switch v-model="modelForm.thinking" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modelDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveModel">保存</el-button>
    </template>
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

.model-row {
  align-items: center;
}

.model-actions {
  gap: 6px;
}

.active-tag {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 11px;
  font-weight: 500;
}

.add-model-row {
  display: flex;
  justify-content: flex-start;
  padding: 0 2px;
}

.model-form {
  padding-top: 4px;
}
</style>
