<script setup lang="ts">
import { computed } from 'vue'
import { useNavigation, getDeviceInfo } from '../runtime/helpers'
import VoiderIcon from './VoiderIcon.vue'

const props = withDefaults(
  defineProps<{
  title: string
  showBack?: boolean
  background?: string
  color?: string
  isFillScreen?: boolean
  }>(),
  {
  showBack: true,
  background: '#ffffff',
  color: '#000000',
  isFillScreen: false,
  },
)

const emit = defineEmits<{
  // no events
}>()

const $props = props

const offsetTop = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  const info = getDeviceInfo()
  // 小程序自定义导航从屏幕顶部绘制，必须预留状态栏；
  // H5 仅在沉浸模式（isFillScreen）下预留
  if (info.platform === 'miniprogram' || ($props.isFillScreen && info.platform !== 'h5')) {
    return info.statusBarHeight || 0
  }
  return 0
})
const height = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  const info = getDeviceInfo()
  if (info.platform === 'h5') {
    return 45
  }
  const mb = info.menuButton
  if (!mb) {
    return offsetTop.value + 44
  }
  // 胶囊相对状态栏的上间距，导航区上下对称：gap + capsule + gap
  const gap = Math.max(0, (mb.top || 0) - (info.statusBarHeight || 0))
  return offsetTop.value + (mb.height || 32) + gap * 2
})

const { navigateBack } = useNavigation()
</script>

<template>
  <div>
    <div class="flex flex-col w-full min-w-0 h-fit p-[0px]">
      <div
        class="relative w-full min-w-0 p-[0px]"
        :style="{ backgroundColor: String(props.background ?? ''), height: (Number(height) || 0) + 'px', paddingTop: (Number(offsetTop) || 0) + 'px' }"
      >
        <div class="relative w-full h-full min-h-0 min-w-0">
          <VoiderIcon
            name="back"
            :size="20"
            :color="String(props.color ?? '')"
            class="inline-flex items-center justify-center shrink-0 absolute top-1/2 -translate-y-1/2 left-[10px] w-fit max-w-full h-fit"
            v-if="String(props.showBack ?? '') === 'true'"
            @click="() => navigateBack()"
          />
          <span
            class="text-[14px] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-fit max-w-full h-fit"
            :style="{ color: String(props.color ?? '') }"
          >
            {{ props.title }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
