<script setup lang="ts">
import { computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'

export type PreviewRuntimeLogLevel = 'error' | 'warn' | 'info'

export type PreviewRuntimeLogEntry = {
  id: number
  time: string
  level: PreviewRuntimeLogLevel
  message: string
  /** 出错位置，如「组件 Pager · setData」 */
  location?: string
}

const props = defineProps<{
  logs?: PreviewRuntimeLogEntry[]
}>()

const emit = defineEmits<{
  clear: []
}>()

const entries = computed(() => props.logs ?? [])

function levelLabel(level: PreviewRuntimeLogLevel): string {
  if (level === 'error') return '错误'
  if (level === 'warn') return '警告'
  return '信息'
}
</script>

<template>
  <div class="runtime-log">
    <div class="log-header">
      <span>运行日志</span>
      <el-button
        text
        type="info"
        size="small"
        :icon="Delete"
        :disabled="!entries.length"
        @click="emit('clear')"
      >
        清空
      </el-button>
    </div>
    <div class="log-body">
      <el-empty
        v-if="!entries.length"
        description="暂无日志"
        :image-size="56"
      />
      <ul v-else class="log-list">
        <li
          v-for="item in entries"
          :key="item.id"
          class="log-item"
          :class="`is-${item.level}`"
        >
          <div class="log-meta">
            <span class="log-level">{{ levelLabel(item.level) }}</span>
            <span class="log-time">{{ item.time }}</span>
          </div>
          <div v-if="item.location" class="log-location">{{ item.location }}</div>
          <div class="log-message">{{ item.message }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.runtime-log {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border-top: 1px solid #ebeef5;
}

.log-header {
  flex-shrink: 0;
  height: 40px;
  padding: 0 8px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.log-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-item {
  border-radius: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  background: #fafafa;
}

.log-item.is-error {
  border-color: #fde2e2;
  background: #fef0f0;
}

.log-item.is-warn {
  border-color: #faecd8;
  background: #fdf6ec;
}

.log-item.is-info {
  border-color: #e9e9eb;
  background: #f4f4f5;
}

.log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.log-level {
  font-size: 12px;
  font-weight: 600;
}

.is-error .log-level {
  color: #f56c6c;
}

.is-warn .log-level {
  color: #e6a23c;
}

.is-info .log-level {
  color: #909399;
}

.log-time {
  font-size: 11px;
  color: #a8abb2;
  font-variant-numeric: tabular-nums;
}

.log-location {
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
  word-break: break-all;
}

.log-message {
  font-size: 13px;
  color: #303133;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}
</style>
