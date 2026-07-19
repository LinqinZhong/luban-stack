<script setup lang="ts">
import { computed } from 'vue'
import { Plus, View } from '@element-plus/icons-vue'
import type { PageMethod } from '../../types/page-method'

const props = defineProps<{
  methods: PageMethod[]
  /** 组件方法面板文案 */
  forComponent?: boolean
}>()

const emit = defineEmits<{
  add: []
  edit: [method: PageMethod]
  remove: [method: PageMethod]
}>()

const panelDesc = computed(() =>
  props.forComponent
    ? '组件 function 目录 · 内置 emit(事件名, ...参数) 向父页面抛事件'
    : '页面 function 目录 · 一个方法一个 .ts 文件',
)
</script>

<template>
  <div class="methods-panel">
    <div class="toolbar">
      <div>
        <div class="title">方法</div>
        <div class="desc">{{ panelDesc }}</div>
      </div>
      <el-button type="primary" :icon="Plus" @click="emit('add')">添加方法</el-button>
    </div>

    <el-empty
      v-if="!methods.length"
      description="暂无方法"
      :image-size="64"
    />

    <div v-else class="method-list">
      <div
        v-for="method in methods"
        :key="method.name"
        class="method-card"
        @click="emit('edit', method)"
      >
        <div class="method-main">
          <div class="method-name">
            {{ method.name }}
            <el-tag v-if="method.builtin" size="small" type="info">预置</el-tag>
          </div>
          <div class="method-sig">
            (
            <template v-if="method.params.length">
              <span
                v-for="(param, index) in method.params"
                :key="param.name"
              >
                {{ param.name }}: {{ param.type }}<span v-if="index < method.params.length - 1">, </span>
              </span>
            </template>
            <span v-else class="muted">无参</span>
            ) → {{ method.returnType === 'void' ? '无返回值' : method.returnType }}
          </div>
        </div>
        <div class="method-actions" @click.stop>
          <el-button
            v-if="method.builtin"
            type="primary"
            link
            :icon="View"
            @click="emit('edit', method)"
          >
            查看
          </el-button>
          <template v-else>
            <el-button type="primary" link @click="emit('edit', method)">编辑</el-button>
            <el-button type="danger" link @click="emit('remove', method)">
              删除
            </el-button>
          </template>
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

.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.desc {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
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

.method-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.method-sig {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.muted {
  color: #c0c4cc;
}

.method-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
