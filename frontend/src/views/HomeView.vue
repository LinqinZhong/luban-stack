<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getApiInfo, getHealthStatus } from '../api'
import type { ApiInfo, HealthStatus } from '../api'

const loading = ref(false)
const apiInfo = ref<ApiInfo | null>(null)
const health = ref<HealthStatus | null>(null)
const error = ref('')

async function loadData() {
  loading.value = true
  error.value = ''

  try {
    const [info, status] = await Promise.all([getApiInfo(), getHealthStatus()])
    apiInfo.value = info
    health.value = status
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>系统概览</span>
        <el-button type="primary" :loading="loading" @click="loadData">
          刷新
        </el-button>
      </div>
    </template>

    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="alert"
    />

    <el-skeleton v-else-if="loading && !apiInfo" :rows="4" animated />

    <el-descriptions v-else-if="apiInfo && health" :column="1" border>
      <el-descriptions-item label="API 消息">
        {{ apiInfo.message }}
      </el-descriptions-item>
      <el-descriptions-item label="版本">
        {{ apiInfo.version }}
      </el-descriptions-item>
      <el-descriptions-item label="服务状态">
        <el-tag type="success">{{ health.status }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="服务名称">
        {{ health.service }}
      </el-descriptions-item>
      <el-descriptions-item label="检查时间">
        {{ health.timestamp }}
      </el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.alert {
  margin-bottom: 16px;
}
</style>
