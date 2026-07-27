<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Download, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '../stores/project'
import { exportProjectVue3 } from '../api/projects'
import WorkspaceSettingsButton from '../components/editor/WorkspaceSettingsButton.vue'

const router = useRouter()
const projectStore = useProjectStore()
const exporting = ref(false)

const pageTitle = computed(() => {
  const name = projectStore.config?.name
  return name ? `${name} · 工作区` : '工作区'
})

function closeProject() {
  projectStore.clearProject()
  void router.push('/')
}

async function handleExportCommand(command: string) {
  if (command !== 'vue3') return
  if (!projectStore.path) {
    ElMessage.warning('请先打开项目')
    return
  }
  exporting.value = true
  try {
    const result = await exportProjectVue3(projectStore.path)
    ElMessage.success(
      `已导出 Vue3 工程（${result.pages} 页 / ${result.components} 组件）到 ${result.outputPath}`,
    )
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败')
  } finally {
    exporting.value = false
  }
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
        <WorkspaceSettingsButton />
        <el-dropdown
          trigger="click"
          :disabled="exporting || !projectStore.path"
          @command="handleExportCommand"
        >
          <el-button :icon="Download" :loading="exporting">
            导出
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="vue3">
                导出为 vue3 工程
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button :icon="SwitchButton" @click="closeProject">关闭项目</el-button>
      </div>
    </header>
    <main class="main">
      <router-view />
    </main>
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
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.04em;
}

.title {
  font-size: 14px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
</style>
