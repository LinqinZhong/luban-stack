<script setup lang="ts">
import { ref, computed } from 'vue'
import VoiderIcon from './VoiderIcon.vue'

const props = withDefaults(
  defineProps<{
  bottomText?: string
  fetchApi: ((args?: Record<string, any>) => Promise<any>)
  data: any[]
  }>(),
  {
  bottomText: '没有更多了~',
  },
)

const emit = defineEmits<{
  'update:data': [value: any[]]
}>()

const $props = props

const pagination = ref<Record<string, any>>({
    "current": 2,
    "pageSize": 10
  })
const loading = ref<boolean>(false)
const hasNext = ref<boolean>(true)
const isReachTop = ref<boolean>(true)
const pullHeight = ref<number>(0)
const touchStartY = ref<number>(0)
const refreshing = ref<boolean>(false)
const pullText = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return refreshing.value ? '刷新中...' : pullHeight.value > 100 ? '释放即可刷新' : '下拉刷新'
})
const arrowSize = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return Math.min(pullHeight.value, 100)/100 *10 + 5
})


const _scrollEdge6 = { atLower: false, atUpper: true }

function onTouchstart1(payload?: Record<string, any>) {
  const clientX = payload?.clientX
  const clientY = payload?.clientY
  const pageX = payload?.pageX
  const pageY = payload?.pageY
  setData('touchStartY', clientY)
}

function onTouchmove2(payload?: Record<string, any>) {
  const clientX = payload?.clientX
  const clientY = payload?.clientY
  const pageX = payload?.pageX
  const pageY = payload?.pageY
  if (!isReachTop) return
  
  const dy = Math.max(0, clientY - touchStartY) // 下拉距离
  const maxPull = 500 // 视觉最大高度
  const t = Math.min(1, dy / maxPull) // 归一化到 0~1
  const h = maxPull * Math.sin(t * Math.PI * 0.5)
  
  setData('pullHeight', h)
}

function onTouchend3(payload?: Record<string, any>) {
  const clientX = payload?.clientX
  const clientY = payload?.clientY
  const pageX = payload?.pageX
  const pageY = payload?.pageY
  const shouldRefresh = pullHeight > 100
  setData('pullHeight', 0)
  if (shouldRefresh) {
    refresh()
  }
}

function onScroll4(e: Event) {
  setData('isReachTop', scrollTop <= 30)
}

function onScrollToLower5(e: Event) {
  loadData()
}

function onScrollDispatch6(e: Event) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  onScroll4(e)
  const threshold = 50
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  const nowLower = maxScroll > 0 && el.scrollTop >= maxScroll - threshold
  const nowUpper = el.scrollTop <= threshold
  if (nowLower && !_scrollEdge6.atLower) {
    onScrollToLower5(e)
  }
  _scrollEdge6.atLower = nowLower
}
</script>

<template>
  <div>
    <div
      class="flex flex-col w-full min-w-0 h-full min-h-0 max-h-full bg-[transparent] overflow-x-hidden overflow-y-auto min-h-0 overscroll-contain touch-pan-y"
      @touchstart="(e) => onTouchstart1({ clientX: (e.touches?.[0] ?? e.changedTouches?.[0])?.clientX ?? 0, clientY: (e.touches?.[0] ?? e.changedTouches?.[0])?.clientY ?? 0, pageX: (e.touches?.[0] ?? e.changedTouches?.[0])?.pageX ?? 0, pageY: (e.touches?.[0] ?? e.changedTouches?.[0])?.pageY ?? 0 })"
      @touchmove="(e) => onTouchmove2({ clientX: (e.touches?.[0] ?? e.changedTouches?.[0])?.clientX ?? 0, clientY: (e.touches?.[0] ?? e.changedTouches?.[0])?.clientY ?? 0, pageX: (e.touches?.[0] ?? e.changedTouches?.[0])?.pageX ?? 0, pageY: (e.touches?.[0] ?? e.changedTouches?.[0])?.pageY ?? 0 })"
      @touchend="(e) => onTouchend3({ clientX: (e.changedTouches?.[0] ?? e.touches?.[0])?.clientX ?? 0, clientY: (e.changedTouches?.[0] ?? e.touches?.[0])?.clientY ?? 0, pageX: (e.changedTouches?.[0] ?? e.touches?.[0])?.pageX ?? 0, pageY: (e.changedTouches?.[0] ?? e.touches?.[0])?.pageY ?? 0 })"
      @scroll="onScrollDispatch6"
    >
      <div
        class="flex flex-row gap-[10px] justify-center items-center shrink-0 w-full min-w-0 overflow-hidden"
        :style="{ height: (Number(pullHeight) || 0) + 'px' }"
      >
        <VoiderIcon
          name="arrow"
          :size="16"
          color="#626262"
          class="inline-flex items-center justify-center shrink-0 w-fit max-w-full shrink-0 h-fit"
          :style="{ transform: 'rotateZ(90deg)' }"
          v-show="String(refreshing ?? '') === 'false'"
        />
        <VoiderIcon
          name="loading"
          :size="20"
          color="#303133"
          class="inline-flex items-center justify-center shrink-0 w-fit max-w-full shrink-0 h-fit"
          v-if="String(refreshing ?? '') === 'true'"
        />
        <span class="text-[14px] text-[#303133] w-fit max-w-full shrink-0 h-fit">
          {{ pullText }}
        </span>
      </div>
      <slot name="header" />
      <slot :item="item" />
      <div class="flex flex-col justify-center items-center shrink-0 w-full min-w-0 h-fit">
        <span
          class="text-[14px] text-[#303133] shrink-0 w-fit max-w-full h-fit mt-[10px] mb-[10px]"
          v-if="(String(hasNext ?? '') === 'false' && String(loading ?? '') === 'false')"
        >
          {{ props.bottomText }}
        </span>
        <div
          class="flex flex-row gap-[10px] justify-center items-center shrink-0 w-full min-w-0 h-fit p-[8px]"
          v-show="(String(loading ?? '') === 'true' && String(refreshing ?? '') === 'false')"
        >
          <VoiderIcon
            name="loading"
            :size="20"
            color="#303133"
            class="inline-flex items-center justify-center shrink-0 w-fit max-w-full shrink-0 h-fit"
          />
          <span class="text-[14px] text-[#303133] w-fit max-w-full shrink-0 h-fit">加载中...</span>
        </div>
      </div>
      <slot name="footer" />
    </div>
  </div>
</template>
