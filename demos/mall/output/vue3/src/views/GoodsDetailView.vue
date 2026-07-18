<script setup lang="ts">
import { ref, computed } from 'vue'
import TitleBar from '../components/TitleBar.vue'
import SpecSelector from '../components/SpecSelector.vue'
import VoiderSwiper from '../components/VoiderSwiper.vue'

const titleBarOpacity = ref<number>(0)
const titleBarColor = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return `rgba(255, 255, 255, ${titleBarOpacity.value})`
})
const titleTextColor = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  const a = 255 * (1 - titleBarOpacity.value)
  return `rgb(${a}, ${a}, ${a})`
})
const statusBarColor = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return titleBarOpacity.value > 0.5 ? 'black' : 'white'
})

const specSelectRef = ref<{ open?: () => void; close?: () => void } | null>(null)
</script>

<template>
  <div class="w-full h-full">
    <div class="flex flex-col w-full min-w-0 h-full min-h-0 p-[0px] bg-[#ededed]">
      <div class="relative w-full min-w-0 flex-1 min-h-0 h-full p-[0px]">
        <div class="relative w-full h-full min-h-0 min-w-0">
          <div
            class="flex flex-col absolute inset-0 w-full min-w-0 p-[0px] overflow-x-hidden overflow-y-auto min-h-0 overscroll-contain touch-pan-y"
            @scroll="(e) => titleBarOpacity = (e.currentTarget).scrollTop"
          >
            <div class="overflow-hidden shrink-0 w-full min-w-0 h-[200px]">
              <VoiderSwiper
                class="w-full h-full min-h-0"
                :slide-count="3"
                :indicator="true"
                indicator-color="rgba(0,0,0,0.25)"
                indicator-active-color="#409eff"
                :autoplay="true"
                :circular="true"
                :interval="3000"
                :duration="280"
                :current="1"
              >
                <div class="voider-swiper-slide" :key="0">
                  <img
                    src="https://baconmockup.com/300/200/"
                    alt="图片"
                    class="object-cover shrink-0 w-full min-w-0 h-full min-h-0"
                  />
                </div>
                <div class="voider-swiper-slide" :key="1">
                  <img
                    src="https://fastly.picsum.photos/id/997/300/200.jpg?hmac=dLJ1PQmtDOqFj1QsmFHLkdTyUzcUpf9-qPpFCbgHBzQ"
                    alt="图片"
                    class="object-cover shrink-0 w-full min-w-0 h-full min-h-0"
                  />
                </div>
                <div class="voider-swiper-slide" :key="2">
                  <img
                    src="https://baconmockup.com/300/200/"
                    alt="图片"
                    class="object-cover shrink-0 w-full min-w-0 h-full min-h-0"
                  />
                </div>
              </VoiderSwiper>
            </div>
            <div class="flex flex-col shrink-0 w-full min-w-0 h-fit mt-[0px] p-[8px] bg-[#ffffff]">
              <span class="text-[14px] text-[#303133] shrink-0 w-fit max-w-full h-fit">
                商品名称商品名称商品名称
              </span>
              <span class="text-[12px] text-[#6b6b6b] shrink-0 w-fit max-w-full h-fit mt-[2px]">
                运费：￥2.00
              </span>
            </div>
            <div class="flex items-center justify-center text-xs text-[#909399] shrink-0 w-full min-w-0 h-[1000px] bg-[#f07a7a]">
              图片
            </div>
          </div>
          <TitleBar
            class="absolute w-full min-w-0 h-fit mt-[0px] pt-[0px]"
            title="商品详情"
            :color="titleTextColor"
            :background="titleBarColor"
            :isFillScreen="true"
            :showBack="true"
          />
          <div class="flex flex-row gap-[4px] absolute bottom-0 w-full min-w-0 h-fit p-[8px]">
            <button
              type="button"
              class="inline-flex items-center justify-center border-none cursor-pointer rounded-[4px] bg-[#ffffff] text-[#000000] text-[14px] flex-1 min-w-0 h-[44px] mt-[8px] bg-[#ffffff]"
              @click="() => specSelectRef?.open()"
            >
              加入购物车
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center border-none cursor-pointer rounded-[4px] bg-[#409eff] text-[#ffffff] text-[14px] flex-1 min-w-0 h-[44px] mt-[8px]"
              @click="() => specSelectRef?.open()"
            >
              立即购买
            </button>
          </div>
        </div>
      </div>
      <SpecSelector
        ref="specSelectRef"
        class="absolute top-0 left-0 w-0 h-0 m-0 overflow-visible pointer-events-none"
      />
    </div>
  </div>
</template>
