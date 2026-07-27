<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Delete, EditPen } from '@element-plus/icons-vue'
import type { PageMethod } from '../../types/page-method'

const props = defineProps<{
  methods: PageMethod[]
}>()

const emit = defineEmits<{
  edit: [method: PageMethod]
  remove: [method: PageMethod]
}>()

const customMethods = computed(() =>
  props.methods.filter((item) => !item.builtin),
)

const builtinMethods = computed(() =>
  props.methods.filter((item) => item.builtin),
)

/** 预置方法默认折叠 */
const builtinsExpanded = ref(false)

function formatSignature(method: PageMethod): string {
  const params = method.params.length
    ? method.params.map((p) => `${p.name}: ${p.type}`).join(', ')
    : '无参'
  return `( ${params} )`
}
</script>

<template>
  <div class="methods-panel">
    <el-empty
      v-if="!customMethods.length && !builtinMethods.length"
      description="暂无方法"
      :image-size="64"
    />

    <div v-else class="method-list">
      <div
        v-for="method in customMethods"
        :key="method.name"
        class="method-card"
        @click="emit('edit', method)"
      >
        <div class="method-main">
          <div class="method-name">{{ method.name }}</div>
          <div class="method-sig">{{ formatSignature(method) }}</div>
        </div>
        <div class="method-actions" @click.stop>
          <el-button
            type="primary"
            link
            :icon="EditPen"
            @click="emit('edit', method)"
          >
            编辑
          </el-button>
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click="emit('remove', method)"
          >
            删除
          </el-button>
        </div>
      </div>

      <div v-if="builtinMethods.length" class="builtins-block">
        <button
          type="button"
          class="builtins-toggle"
          @click="builtinsExpanded = !builtinsExpanded"
        >
          <el-icon
            class="builtins-arrow"
            :class="{ open: builtinsExpanded }"
          >
            <ArrowRight />
          </el-icon>
          <span>预置方法</span>
          <span class="builtins-count">{{ builtinMethods.length }}</span>
        </button>

        <div v-show="builtinsExpanded" class="builtins-list">
          <div
            v-for="method in builtinMethods"
            :key="method.name"
            class="method-card is-builtin"
          >
            <div class="method-main">
              <div class="method-name">{{ method.name }}</div>
              <div v-if="method.summary" class="method-summary">
                {{ method.summary }}
              </div>
              <div class="method-sig">{{ formatSignature(method) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.methods-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.method-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.method-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  background: #fafbfc;
}

.method-card:hover {
  border-color: #c6e2ff;
  background: #f5f9ff;
}

.method-card.is-builtin {
  cursor: default;
  background: #fff;
}

.method-card.is-builtin:hover {
  border-color: #ebeef5;
  background: #fff;
}

.method-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.method-summary {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: #606266;
}

.method-sig {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.method-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.builtins-block {
  margin-top: 4px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  background: #fafbfc;
}

.builtins-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: #606266;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}

.builtins-toggle:hover {
  background: #f5f7fa;
  color: #303133;
}

.builtins-arrow {
  transition: transform 0.15s ease;
  color: #909399;
}

.builtins-arrow.open {
  transform: rotate(90deg);
}

.builtins-count {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: #ebeef5;
  color: #909399;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-weight: 500;
}

.builtins-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px;
}
</style>
