<script setup lang="ts">
import { computed, inject } from 'vue'
import { FLOW_DEBUG_KEY } from './flow-debug-inject'

const props = defineProps<{
  nodeId: string
}>()

const debug = inject(FLOW_DEBUG_KEY, null)

const printText = computed(() => {
  const map = debug?.printByNode?.value
  const text = map?.[props.nodeId]
  return typeof text === 'string' && text.trim() ? text : ''
})

const isCursor = computed(
  () => Boolean(debug?.cursorId.value) && debug?.cursorId.value === props.nodeId,
)

const visible = computed(() => Boolean(printText.value))

/** 按内容估算宽度，避免过窄竖排折行 */
const bubbleStyle = computed(() => {
  const text = printText.value
  const lines = text.split(/\r?\n/)
  let maxLen = 0
  for (const line of lines) {
    // CJK 约 1 宽，ASCII 约 0.55
    let w = 0
    for (const ch of line) {
      w += /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.55
    }
    maxLen = Math.max(maxLen, w)
  }
  const widthPx = Math.min(320, Math.max(120, Math.ceil(maxLen * 13 + 28)))
  return {
    width: `${widthPx}px`,
    maxWidth: '320px',
  }
})
</script>

<template>
  <div
    v-if="visible"
    class="print-bubble"
    :class="{ 'is-cursor': isCursor }"
    :style="bubbleStyle"
    :title="printText"
  >
    <pre class="print-bubble-body">{{ printText }}</pre>
  </div>
</template>

<style scoped>
.print-bubble {
  position: absolute;
  left: calc(100% + 28px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 8;
  min-width: 120px;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: 16px;
  background: #fff;
  color: #303133;
  border: 1px solid #e4e7ed;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08);
  pointer-events: none;
  opacity: 0.92;
}

.print-bubble.is-cursor {
  z-index: 9;
  opacity: 1;
  border-color: #c6e2ff;
  box-shadow: 0 4px 14px rgba(64, 158, 255, 0.16);
}

.print-bubble::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  margin-top: -5px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 6px 5px 0;
  border-color: transparent #e4e7ed transparent transparent;
}

.print-bubble::after {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  margin-top: -4px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 4px 5px 4px 0;
  border-color: transparent #fff transparent transparent;
}

.print-bubble.is-cursor::before {
  border-color: transparent #c6e2ff transparent transparent;
}

.print-bubble-body {
  margin: 0;
  position: relative;
  z-index: 1;
  font-size: 12px;
  line-height: 1.45;
  color: #303133;
  font-weight: 500;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  max-height: 220px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #c0c4cc transparent;
}

.print-bubble-body::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.print-bubble-body::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 4px;
}

.print-bubble-body::-webkit-scrollbar-track {
  background: transparent;
}
</style>
