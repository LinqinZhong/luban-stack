<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    /** 显示在按钮旁的组件名 */
    label?: string
    size?: number
    active?: boolean
    /** 组件偏左则向左伸出；偏右则向右 */
    side?: 'left' | 'right'
    /**
     * 水平段长度（手机本地 px）：从组件边到屏外落点。
     */
    stemH?: number
    /**
     * 按钮中心相对锚点的纵向偏移（本地 px，向上为负）。
     */
    rise?: number
  }>(),
  {
    title: '查看组件入参',
    label: '',
    size: 18,
    active: false,
    side: 'right',
    stemH: 20,
    rise: undefined,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const BTN = computed(() => Math.max(14, props.size))
const STEM_H = computed(() => Math.max(10, props.stemH))
const RISE = computed(() => {
  if (props.rise != null && Number.isFinite(props.rise)) return props.rise
  return -Math.max(14, STEM_H.value * 0.35)
})
const DIAG_X = computed(() =>
  Math.max(12, Math.min(20, Math.abs(RISE.value) || 14)),
)
const displayLabel = computed(() => props.label.trim())

/** 引线总宽（不含按钮） */
const LEADER_W = computed(() => STEM_H.value + DIAG_X.value)
const svgW = computed(() => LEADER_W.value + BTN.value)
const svgH = computed(() => Math.abs(RISE.value) + BTN.value)
const y0 = computed(
  () => Math.abs(Math.min(0, RISE.value)) + BTN.value / 2,
)

const pathD = computed(() => {
  const yStart = y0.value
  const yEnd = yStart + RISE.value
  if (props.side === 'left') {
    const x1 = svgW.value - STEM_H.value
    const x2 = svgW.value - STEM_H.value - DIAG_X.value
    return `M ${svgW.value} ${yStart} H ${x1} L ${x2} ${yEnd}`
  }
  const x1 = STEM_H.value
  const x2 = STEM_H.value + DIAG_X.value
  return `M 0 ${yStart} H ${x1} L ${x2} ${yEnd}`
})

/**
 * 根节点包住「按钮 + 名称」；按钮靠手机一侧，名称在更外侧。
 * 引线 SVG 向组件方向溢出绘制，pointer-events:none。
 */
const boxStyle = computed(() => {
  const btnOffsetX = LEADER_W.value - BTN.value / 2
  const btnOffsetY = y0.value + RISE.value - BTN.value / 2
  return {
    height: `${BTN.value}px`,
    top: `${btnOffsetY}px`,
    ...(props.side === 'right'
      ? { left: `${btnOffsetX}px`, right: 'auto' }
      : { right: `${btnOffsetX}px`, left: 'auto' }),
  }
})

const leaderStyle = computed(() => {
  const btnOffsetY = y0.value + RISE.value - BTN.value / 2
  return {
    width: `${svgW.value}px`,
    height: `${svgH.value}px`,
    top: `${-btnOffsetY}px`,
    ...(props.side === 'right'
      ? { left: `${-(LEADER_W.value - BTN.value / 2)}px`, right: 'auto' }
      : { right: `${-(LEADER_W.value - BTN.value / 2)}px`, left: 'auto' }),
  }
})

function fire(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  emit('click', event as MouseEvent)
}
</script>

<template>
  <div
    class="inspect-callout"
    :class="[`side-${side}`, { active }]"
    :title="title"
    :style="boxStyle"
  >
    <svg
      class="inspect-leader"
      :width="svgW"
      :height="svgH"
      :viewBox="`0 0 ${svgW} ${svgH}`"
      :style="leaderStyle"
      aria-hidden="true"
    >
      <path
        class="inspect-path"
        :d="pathD"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-dasharray="4 3"
      />
    </svg>
    <button
      type="button"
      class="inspect-chip"
      :style="{ height: `${BTN}px` }"
      @pointerdown="fire"
      @click.prevent.stop
    >
      <span
        class="inspect-btn"
        :style="{ width: `${BTN}px`, height: `${BTN}px` }"
      >
        <svg class="inspect-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.2 1.4h3.6l1.2 1.2v2.4H14l1.2 1.2v3.6L14 10.8h-2.4V14L10.4 15.2H6.8L5.6 14v-3.2H3.2L2 9.6V6l1.2-1.2h2.4V2.6L6.2 1.4Zm.6 1.5v2.5H4.2v2.8h2.6v2.5h2.4v-2.5h2.6V5.4H9.2V2.9H6.8Z"
          />
        </svg>
      </span>
      <span v-if="displayLabel" class="inspect-label">{{ displayLabel }}</span>
    </button>
  </div>
</template>

<style scoped>
.inspect-callout {
  position: absolute;
  pointer-events: auto;
  z-index: 100060;
  overflow: visible;
  display: flex;
  align-items: center;
}

.inspect-callout.active {
  z-index: 100070;
}

.inspect-leader {
  position: absolute;
  display: block;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
}

.inspect-path {
  stroke: #94a3b8;
  stroke-width: 1.5;
  pointer-events: none;
}

.inspect-callout.active .inspect-path {
  stroke: #d48806;
}

.inspect-chip {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  pointer-events: auto;
  line-height: 0;
}

.inspect-callout.side-left .inspect-chip {
  flex-direction: row-reverse;
}

.inspect-btn {
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  background: #94a3b8;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
}

.inspect-chip:hover .inspect-btn {
  background: #64748b;
}

.inspect-callout.active .inspect-btn {
  background: #d48806;
  box-shadow: 0 0 0 2px rgba(212, 136, 6, 0.4);
}

.inspect-callout.active .inspect-chip:hover .inspect-btn {
  background: #b8740a;
}

.inspect-btn-icon {
  width: 62%;
  height: 62%;
  display: block;
  pointer-events: none;
}

.inspect-label {
  max-width: 88px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow:
    0 0 3px #fff,
    0 0 3px #fff,
    0 1px 2px rgba(255, 255, 255, 0.9);
  pointer-events: none;
  user-select: none;
}

.inspect-callout.active .inspect-label {
  color: #d48806;
}
</style>
