<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { SwitchButton } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '../stores/project'
import {
  buildProject,
  getBuildSchemes,
} from '../api/projects'
import WorkspaceSettingsButton from '../components/editor/WorkspaceSettingsButton.vue'
import BuildSchemeDialog from '../components/editor/BuildSchemeDialog.vue'
import BuildSchemeIcon from '../components/icons/BuildSchemeIcon.vue'
import HammerIcon from '../components/icons/HammerIcon.vue'

const router = useRouter()
const projectStore = useProjectStore()
const building = ref(false)
const buildingSchemeName = ref('')
const schemeDialogVisible = ref(false)
const buildSelectVisible = ref(false)
const buildSchemeOptions = ref<Array<{ name: string; description: string }>>([])

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
    buildSchemeOptions.value = lib.schemes.map((s) => ({
      name: s.name,
      description: s.description?.trim() || '',
    }))
    buildSelectVisible.value = true
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '读取构建方案失败')
  }
}

async function runBuild(schemeName: string) {
  if (!projectStore.path || !schemeName || building.value) return
  building.value = true
  buildingSchemeName.value = schemeName
  try {
    const result = await buildProject({
      projectPath: projectStore.path,
      schemeName,
    })
    ElMessage.success(
      `构建完成：${result.backends.length} 个后端 / ${result.frontends.length} 个前端 → ${result.outputRoot}`,
    )
    buildSelectVisible.value = false
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '构建失败')
  } finally {
    building.value = false
    buildingSchemeName.value = ''
  }
}

function onBuildSchemeRowClick(row: { name: string }) {
  void runBuild(row.name)
}

function onBuildSelectClose(done: () => void) {
  if (building.value) return
  done()
}
</script>

<template>
  <div class="layout">
    <header class="header">
      <div class="brand">
        <span class="logo">Voider</span>
        <span class="title">{{ pageTitle }}</span>
      </div>
      <div class="header-actions">
        <WorkspaceSettingsButton ref="settingsButtonRef" />
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

    <BuildSchemeDialog
      v-if="projectStore.path"
      v-model="schemeDialogVisible"
      :project-path="projectStore.path"
    />

    <el-dialog
      v-model="buildSelectVisible"
      title="选择要构建的方案"
      width="480px"
      align-center
      destroy-on-close
      append-to-body
      :close-on-click-modal="!building"
      :close-on-press-escape="!building"
      :show-close="!building"
      :before-close="onBuildSelectClose"
    >
      <div
        v-loading="building"
        class="build-scheme-cards"
        :element-loading-text="
          buildingSchemeName ? `正在构建 ${buildingSchemeName}…` : '正在构建…'
        "
      >
        <button
          v-for="item in buildSchemeOptions"
          :key="item.name"
          type="button"
          class="build-scheme-card"
          :class="{ 'is-building': building && buildingSchemeName === item.name }"
          :disabled="building"
          @click="onBuildSchemeRowClick(item)"
        >
          <div class="card-name">{{ item.name }}</div>
          <div class="card-desc">{{ item.description || '暂无说明' }}</div>
        </button>
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
  gap: 12px;
  min-width: 0;
}

.logo {
  font-weight: 700;
  font-size: 18px;
  color: #303133;
}

.title {
  font-size: 14px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.build-scheme-cards {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}

.build-scheme-card {
  display: block;
  width: 100%;
  margin: 0;
  padding: 14px 16px;
  text-align: left;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.build-scheme-card:hover:not(:disabled) {
  border-color: #409eff;
  background: #f5faff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.12);
}

.build-scheme-card.is-building {
  border-color: #409eff;
  background: #f5faff;
}

.build-scheme-card:disabled {
  cursor: not-allowed;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  line-height: 1.4;
  pointer-events: none;
}

.card-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  pointer-events: none;
}

.main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
