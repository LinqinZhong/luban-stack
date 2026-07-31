<script setup lang="ts">
import { computed } from 'vue'
import type { MysqlColumnDef } from '../../types/mysql'
import { formatMysqlColumnSummary } from '../../utils/mysql-schema'

const props = defineProps<{
  modelValue: boolean
  tableName: string
  local: MysqlColumnDef[]
  remote: MysqlColumnDef[]
  resolving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  adopt: [side: 'local' | 'remote']
}>()

const localLines = computed(() =>
  props.local.map((c) => formatMysqlColumnSummary(c)),
)
const remoteLines = computed(() =>
  props.remote.map((c) => formatMysqlColumnSummary(c)),
)

</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`表结构不一致 · ${tableName}`"
    width="860px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    :close-on-press-escape="false"
  >
    <p class="hint">
      数据库中的表结构与本地 <code>mysql/{{ tableName }}.json</code> 不一致，请选择要采纳的一方。
    </p>
    <div class="compare">
      <section class="pane">
        <header class="pane-head">本地（mysql/{{ tableName }}.json）</header>
        <ul class="col-list">
          <li v-for="(line, i) in localLines" :key="`l-${i}`">{{ line }}</li>
          <li v-if="!localLines.length" class="empty">（无列）</li>
        </ul>
      </section>
      <section class="pane">
        <header class="pane-head">数据库</header>
        <ul class="col-list">
          <li v-for="(line, i) in remoteLines" :key="`r-${i}`">{{ line }}</li>
          <li v-if="!remoteLines.length" class="empty">（无列）</li>
        </ul>
      </section>
    </div>
    <template #footer>
      <el-button
        type="warning"
        :loading="resolving"
        @click="emit('adopt', 'remote')"
      >
        采用数据库
      </el-button>
      <el-button
        type="primary"
        :loading="resolving"
        @click="emit('adopt', 'local')"
      >
        采用本地并推送到数据库
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
}

.hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #606266;
}

.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.pane {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.pane-head {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
}

.col-list {
  margin: 0;
  padding: 10px 12px;
  list-style: none;
  flex: 1;
  overflow: auto;
  max-height: 360px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: #303133;
}

.col-list li {
  padding: 2px 0;
  word-break: break-all;
}

.empty {
  color: #94a3b8;
}
</style>
