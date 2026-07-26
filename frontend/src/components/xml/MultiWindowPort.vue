<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import type { OverflowStrategy } from '../../utils/xml'

const props = withDefaults(
  defineProps<{
    /** 编辑态：横向平铺全部窗口；预览态：仅展示激活项匹配的窗口 */
    editable?: boolean
    /** 预览态溢出策略（默认 visible）；编辑态忽略，始终可溢出 */
    overflow?: OverflowStrategy
    /** 激活项（已解析的数据池值或字面量） */
    activeValue?: string | number | null
    /** 编辑态当前聚焦的窗口下标 */
    focusIndex?: number
    windows: Array<{ key: string; index: number }>
  }>(),
  {
    editable: false,
    overflow: 'visible',
    activeValue: '',
    focusIndex: 0,
  },
)

const emit = defineEmits<{
  'add-window': []
  'select-window': [index: number]
}>()

const viewportRef = ref<HTMLElement | null>(null)
const paneWidthPx = ref(0)
let resizeObserver: ResizeObserver | null = null

const EDIT_GAP_PX = 10

const activeKey = computed(() => {
  const v = props.activeValue
  if (v == null) return ''
  return String(v)
})

const previewIndex = computed(() => {
  const key = activeKey.value
  if (!key) return -1
  return props.windows.findIndex((w) => w.key === key)
})

const editIndex = computed(() => {
  if (!props.windows.length) return -1
  const fi = props.focusIndex ?? 0
  if (fi >= 0 && fi < props.windows.length) return fi
  return 0
})

function isPreviewVisible(index: number, key: string): boolean {
  if (!key) return false
  return index === previewIndex.value
}

const viewportStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.editable && paneWidthPx.value) {
    style['--pane-w'] = `${paneWidthPx.value}px`
  }
  if (!props.editable) {
    style.overflow = props.overflow === 'hidden' ? 'hidden' : 'visible'
  }
  return Object.keys(style).length ? style : undefined
})

const trackStyle = computed(() => {
  if (!props.editable) return undefined
  return {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
    height: '100%',
    width: 'max-content',
    maxWidth: 'none',
    gap: `${EDIT_GAP_PX}px`,
    boxSizing: 'border-box' as const,
  }
})

function syncPaneWidth() {
  const el = viewportRef.value
  if (!el) return
  paneWidthPx.value = Math.max(0, Math.round(el.clientWidth))
}

watch(
  () => props.windows.length,
  (n, prev) => {
    if (props.editable && n > (prev ?? 0)) {
      emit('select-window', n - 1)
    }
  },
)

watch(
  () => props.editable,
  (editable) => {
    if (editable) void nextTick(() => syncPaneWidth())
  },
)

onMounted(() => {
  syncPaneWidth()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncPaneWidth())
    if (viewportRef.value) resizeObserver.observe(viewportRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="viewportRef"
    class="multi-window-port"
    :class="{ 'is-edit': editable }"
    :style="viewportStyle"
  >
    <div class="multi-window-track" :style="trackStyle">
      <div
        v-for="win in windows"
        v-show="editable || isPreviewVisible(win.index, win.key)"
        :key="`${win.index}:${win.key}`"
        class="multi-window-pane"
        :class="{
          editable,
          active: editable && win.index === editIndex,
          unbound: editable && !win.key,
        }"
        @click.stop="editable && emit('select-window', win.index)"
      >
        <slot :index="win.index" />
      </div>

      <button
        v-if="editable"
        type="button"
        class="multi-window-add"
        @click.stop="emit('add-window')"
      >
        <el-icon :size="22"><Plus /></el-icon>
        <span>新建窗口</span>
      </button>

      <div
        v-if="editable && !windows.length"
        class="multi-window-empty multi-window-empty--edit"
      >
        点击右侧新建窗口
      </div>
      <div
        v-else-if="!editable && previewIndex < 0"
        class="multi-window-empty"
      >
        {{ activeKey ? `无匹配窗口「${activeKey}」` : '未绑定激活项' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.multi-window-port {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: visible;
}

.multi-window-port.is-edit {
  overflow: visible;
}

.multi-window-track {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 48px;
  box-sizing: border-box;
}

.multi-window-pane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: visible;
}

.multi-window-pane.editable {
  position: relative;
  inset: auto;
  flex: 0 0 var(--pane-w, 100%);
  width: var(--pane-w, 100%);
  min-width: var(--pane-w, 100%);
  height: 100%;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.04);
  overflow: visible;
}

.multi-window-pane.editable.active {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.06);
}

.multi-window-pane.editable.unbound {
  border-style: dashed;
  border-color: #f59e0b;
}

.multi-window-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 12px;
  pointer-events: none;
}

.multi-window-empty--edit {
  position: relative;
  inset: auto;
  flex: 0 0 var(--pane-w, 160px);
  width: var(--pane-w, 160px);
  min-width: 120px;
  height: 100%;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
}

.multi-window-add {
  flex: 0 0 88px;
  width: 88px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  padding: 8px;
  box-sizing: border-box;
}

.multi-window-add:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
</style>
