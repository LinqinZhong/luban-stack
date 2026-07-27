<script setup lang="ts">
import { ref } from 'vue'
import EventBindDialog from './EventBindDialog.vue'
import {
  LIFECYCLE_HOOKS,
  type LifecycleConfig,
  type LifecycleHookKey,
} from '../../types/lifecycle'
import {
  countEventBindings,
  type PageMethod,
} from '../../types/page-method'
import type { DataField } from '../../types/page-data'
import type { ComponentEventDef, ComponentPropDef } from '../../types/component'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeLibrary } from '../../types/data-types'

const props = defineProps<{
  lifecycle: LifecycleConfig
  methods: PageMethod[]
  dataFields?: DataField[]
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  emitEvents?: ComponentEventDef[]
  /** 组件参数：自定义代码中 $props 提示 */
  componentProps?: ComponentPropDef[] | null
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:lifecycle': [value: LifecycleConfig]
}>()

function summaryFor(key: LifecycleHookKey): string {
  const count = countEventBindings(props.lifecycle[key])
  if (!count) return '未配置'
  return `已绑定 ${count} 个方法`
}

const bindVisible = ref(false)
const bindKey = ref<LifecycleHookKey>('onMounted')
const bindLabel = ref('')

function openBind(key: LifecycleHookKey, label: string) {
  bindKey.value = key
  bindLabel.value = label
  bindVisible.value = true
}

function handleBindSave(value: string) {
  const next: LifecycleConfig = { ...props.lifecycle }
  if (value.trim()) next[bindKey.value] = value
  else delete next[bindKey.value]
  emit('update:lifecycle', next)
}
</script>

<template>
  <div class="lifecycle-panel">
    <div class="hook-list">
      <div
        v-for="hook in LIFECYCLE_HOOKS"
        :key="hook.key"
        class="hook-card"
      >
        <div class="hook-main">
          <div class="hook-name">{{ hook.label }}</div>
          <div class="hook-key">{{ hook.key }}</div>
        </div>
        <div class="hook-actions">
          <span class="hook-summary">{{ summaryFor(hook.key) }}</span>
          <el-button
            type="primary"
            link
            @click="openBind(hook.key, hook.label)"
          >
            配置
          </el-button>
        </div>
      </div>
    </div>

    <EventBindDialog
      v-model="bindVisible"
      :event-label="bindLabel"
      :event-key="bindKey"
      :raw-value="lifecycle[bindKey] ?? ''"
      :methods="methods"
      :emit-events="emitEvents"
      :data-fields="dataFields ?? []"
      :xml="xml"
      :component-map="componentMap"
      :component-methods-map="componentMethodsMap"
      :icon-options="iconOptions"
      :component-props="componentProps"
      :type-library="typeLibrary"
      @save="handleBindSave"
    />
  </div>
</template>

<style scoped>
.lifecycle-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.hook-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hook-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.hook-card:hover {
  border-color: #c6e2ff;
  background: #f5f9ff;
}

.hook-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.hook-key {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.hook-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.hook-summary {
  font-size: 12px;
  color: #94a3b8;
}
</style>
