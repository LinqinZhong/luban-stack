<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import { useAiAssistantStore } from '../stores/ai-assistant'
import AiAssistantPanel from '../components/editor/AiAssistantPanel.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const aiAssistant = useAiAssistantStore()

const sessionId = computed(() => {
  const raw = route.query.session
  return typeof raw === 'string' && raw.trim() ? raw.trim() : ''
})

const panelVisible = computed({
  get: () => true,
  set: () => {
    // 独立窗口关闭面板即关闭窗口
    window.close()
    void router.push('/workspace')
  },
})

onMounted(() => {
  if (!projectStore.hasProject) {
    void router.replace('/')
    return
  }
  aiAssistant.setPanelOpen(true)
  document.title = 'AI 助手'
})
</script>

<template>
  <div class="ai-window-page">
    <AiAssistantPanel
      v-model="panelVisible"
      mode="window"
      :initial-session-id="sessionId"
    />
  </div>
</template>

<style scoped>
.ai-window-page {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f5f7fa;
}
</style>
