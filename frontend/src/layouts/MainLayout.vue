<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '../stores/project'
import { useWorkspaceSettingsStore } from '../stores/workspace-settings'
import { useAiAssistantStore } from '../stores/ai-assistant'
import {
  buildProject,
  getBuildSchemes,
  type BuildScheme,
} from '../api/projects'
import WorkspaceSettingsButton from '../components/editor/WorkspaceSettingsButton.vue'
import AiAssistantPanel from '../components/editor/AiAssistantPanel.vue'
import BuildSchemeDialog from '../components/editor/BuildSchemeDialog.vue'
import BuildSchemeIcon from '../components/icons/BuildSchemeIcon.vue'
import HammerIcon from '../components/icons/HammerIcon.vue'
import LubanStackLogo from '../components/icons/LubanStackLogo.vue'
import { PRODUCT_NAME } from '../constants/brand'

type BuildTargetKind = 'backend' | 'frontend'

type BuildTarget = {
  key: string
  kind: BuildTargetKind
  name: string
  label: string
  detail: string
}

const router = useRouter()
const projectStore = useProjectStore()
const workspaceSettings = useWorkspaceSettingsStore()
const aiAssistant = useAiAssistantStore()
const showAiButton = computed(() => workspaceSettings.aiAssistantEnabled)
const aiPanelVisible = computed({
  get: () => aiAssistant.panelOpen,
  set: (open: boolean) => aiAssistant.setPanelOpen(open),
})
const building = ref(false)

watch(showAiButton, (enabled) => {
  if (!enabled) aiAssistant.setPanelOpen(false)
})
const buildingKey = ref('')
const buildingLabel = ref('')
const schemeDialogVisible = ref(false)
const buildSelectVisible = ref(false)
const schemes = ref<BuildScheme[]>([])

const pageTitle = computed(() => {
  const name = projectStore.config?.name
  return name ? `${name} · 工作区` : '工作区'
})

function closeProject() {
  projectStore.clearProject()
  void router.push('/')
}

function openSchemeDialog() {
  if (!projectStore.path) {
    ElMessage.warning('请先打开项目')
    return
  }
  schemeDialogVisible.value = true
}

function frontendTypeLabel(type: string): string {
  if (type === 'mp-wx') return '微信小程序'
  if (type === 'vue3') return 'Vue3'
  return type || '前端'
}

function targetsOf(scheme: BuildScheme): BuildTarget[] {
  const out: BuildTarget[] = []
  const schemeName = scheme.name.trim()
  for (const b of scheme.backends ?? []) {
    const name = b.name.trim()
    if (!name) continue
    out.push({
      key: `${schemeName}::backend::${name}`,
      kind: 'backend',
      name,
      label: name,
      detail: `${b.type === 'nestjs' ? 'Nest.js' : b.type || '后端'} :${b.port}${
        b.includeOss ? ' · OSS' : ''
      }`,
    })
  }
  for (const f of scheme.frontends ?? []) {
    const name = f.name.trim()
    if (!name) continue
    const pageCount = f.pageIds?.length ?? 0
    out.push({
      key: `${schemeName}::frontend::${name}`,
      kind: 'frontend',
      name,
      label: name,
      detail: `${frontendTypeLabel(f.type)}${
        pageCount ? ` · ${pageCount} 页` : ''
      }`,
    })
  }
  return out
}

const schemeRows = computed(() =>
  schemes.value.map((scheme) => ({
    scheme,
    targets: targetsOf(scheme),
  })),
)

async function handleBuild() {
  if (!projectStore.path) {
    ElMessage.warning('请先打开项目')
    return
  }
  try {
    const lib = await getBuildSchemes(projectStore.path)
    if (!lib.schemes.length) {
      ElMessage.warning('请先配置构建方案')
      schemeDialogVisible.value = true
      return
    }
    schemes.value = lib.schemes
    buildSelectVisible.value = true
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取构建方案失败')
  }
}

async function runBuild(payload: {
  schemeName: string
  backendNames?: string[]
  frontendNames?: string[]
  label: string
  key?: string
}) {
  if (!projectStore.path || building.value) return
  building.value = true
  buildingKey.value = payload.key || ''
  buildingLabel.value = payload.label
  try {
    const result = await buildProject({
      projectPath: projectStore.path,
      schemeName: payload.schemeName,
      ...(payload.backendNames != null
        ? { backendNames: payload.backendNames }
        : {}),
      ...(payload.frontendNames != null
        ? { frontendNames: payload.frontendNames }
        : {}),
    })
    ElMessage.success(
      `构建完成：${result.backends.length} 个后端 / ${result.frontends.length} 个前端 → ${result.outputRoot}`,
    )
    buildSelectVisible.value = false
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '构建失败')
  } finally {
    building.value = false
    buildingKey.value = ''
    buildingLabel.value = ''
  }
}

function onTargetClick(scheme: BuildScheme, item: BuildTarget) {
  void runBuild({
    schemeName: scheme.name,
    backendNames: item.kind === 'backend' ? [item.name] : [],
    frontendNames: item.kind === 'frontend' ? [item.name] : [],
    label: `正在构建 ${item.label}…`,
    key: item.key,
  })
}

function onBuildAll(scheme: BuildScheme) {
  void runBuild({
    schemeName: scheme.name,
    label: `正在构建 ${scheme.name}…`,
    key: `${scheme.name}::all`,
  })
}

function onBuildSelectClose(done: () => void) {
  if (building.value) return
  done()
}

function onDialogClosed() {
  schemes.value = []
}
</script>

<template>
  <div class="layout">
    <header class="header">
      <div class="brand">
        <LubanStackLogo class="brand-mark" :size="28" />
        <span class="logo">{{ PRODUCT_NAME }}</span>
        <span class="title">{{ pageTitle }}</span>
      </div>
      <div class="header-actions">
        <el-tooltip
          v-if="showAiButton"
          content="AI助手"
          placement="bottom"
          :enterable="false"
        >
          <el-button
            class="header-icon-btn"
            :icon="ChatDotRound"
            @click="aiAssistant.togglePanel()"
          />
        </el-tooltip>
        <WorkspaceSettingsButton />
        <el-tooltip content="配置构建方案" placement="bottom" :enterable="false">
          <el-button
            class="header-icon-btn"
            :disabled="!projectStore.path"
            @click="openSchemeDialog"
          >
            <BuildSchemeIcon class="header-action-icon" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="构建" placement="bottom" :enterable="false">
          <el-button
            class="header-icon-btn"
            :loading="building"
            :disabled="!projectStore.path"
            @click="handleBuild"
          >
            <HammerIcon class="header-action-icon" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="关闭项目" placement="bottom" :enterable="false">
          <el-button
            class="header-icon-btn"
            :icon="SwitchButton"
            @click="closeProject"
          />
        </el-tooltip>
      </div>
    </header>
    <main class="main">
      <router-view />
    </main>

    <AiAssistantPanel v-model="aiPanelVisible" />

    <BuildSchemeDialog
      v-if="projectStore.path"
      v-model="schemeDialogVisible"
      :project-path="projectStore.path"
    />

    <el-dialog
      v-model="buildSelectVisible"
      title="选择要构建的方案"
      width="560px"
      align-center
      destroy-on-close
      append-to-body
      :close-on-click-modal="!building"
      :close-on-press-escape="!building"
      :show-close="!building"
      :before-close="onBuildSelectClose"
      @closed="onDialogClosed"
    >
      <div
        v-loading="building"
        class="build-picker"
        :element-loading-text="buildingLabel || '正在构建…'"
      >
        <div
          v-for="row in schemeRows"
          :key="row.scheme.id || row.scheme.name"
          class="scheme-block"
        >
          <div class="scheme-head">
            <div class="scheme-titles">
              <div class="scheme-name">{{ row.scheme.name }}</div>
              <div class="scheme-desc">
                {{ row.scheme.description?.trim() || '暂无说明' }}
              </div>
            </div>
            <el-button
              type="primary"
              size="small"
              :disabled="building || !row.targets.length"
              :loading="
                building && buildingKey === `${row.scheme.name}::all`
              "
              @click="onBuildAll(row.scheme)"
            >
              构建全部
            </el-button>
          </div>

          <div v-if="row.targets.length" class="target-grid">
            <button
              v-for="item in row.targets"
              :key="item.key"
              type="button"
              class="target-tile"
              :class="{ 'is-building': building && buildingKey === item.key }"
              :disabled="building"
              @click="onTargetClick(row.scheme, item)"
            >
              <div class="tile-body">
                <div class="tile-name">{{ item.label }}</div>
                <div class="tile-detail">{{ item.detail }}</div>
              </div>
              <span class="tile-kind">
                {{ item.kind === 'backend' ? '后端' : '前端' }}
              </span>
            </button>
          </div>
          <div v-else class="targets-empty">没有可构建的后端/前端</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #f5f7fa;
}

.header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-mark {
  flex-shrink: 0;
}

.logo {
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0.01em;
  color: #303133;
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-left: 1px solid #e4e7ed;
  padding-left: 10px;
  margin-left: 2px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-actions :deep(.header-icon-btn) {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
}

.header-actions :deep(.header-icon-btn:hover) {
  color: #409eff;
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.header-action-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.build-picker {
  position: relative;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scheme-block {
  padding: 14px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #fff;
}

.scheme-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.scheme-titles {
  min-width: 0;
}

.scheme-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  line-height: 1.4;
}

.scheme-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.targets-empty {
  padding: 8px 0 2px;
  font-size: 12px;
  color: #c0c4cc;
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.target-tile {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  padding: 12px;
  text-align: left;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  background: #fafafa;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.target-tile:hover:not(:disabled) {
  border-color: #409eff;
  background: #f5faff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.12);
}

.target-tile.is-building {
  border-color: #409eff;
  background: #ecf5ff;
}

.target-tile:disabled {
  cursor: not-allowed;
}

.tile-body {
  flex: 1;
  min-width: 0;
}

.tile-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  line-height: 1.4;
  word-break: break-all;
}

.tile-detail {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.tile-kind {
  flex-shrink: 0;
  font-size: 11px;
  color: #909399;
  line-height: 22px;
}

.main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 560px) {
  .target-grid {
    grid-template-columns: 1fr;
  }
}
</style>
