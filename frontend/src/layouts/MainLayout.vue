<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { SwitchButton } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'

const router = useRouter()
const projectStore = useProjectStore()

const pageTitle = computed(() => {
  const name = projectStore.config?.name
  return name ? `${name} · 工作区` : '工作区'
})

function closeProject() {
  projectStore.clearProject()
  void router.push('/')
}
</script>

<template>
  <div class="layout">
    <header class="header">
      <div class="brand">
        <span class="logo">Voider</span>
        <span class="title">{{ pageTitle }}</span>
      </div>
      <el-button :icon="SwitchButton" @click="closeProject">关闭项目</el-button>
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

.main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
</style>
