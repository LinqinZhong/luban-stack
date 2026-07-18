<script setup lang="ts">
import { ref, computed } from 'vue'
import { useNavigation, showToast } from '../runtime/helpers'
import TitleBar from '../components/TitleBar.vue'
import GoodsCard from '../components/GoodsCard.vue'
import VoiderIcon from '../components/VoiderIcon.vue'
import VoiderSwiper from '../components/VoiderSwiper.vue'

const { navigateTo } = useNavigation()

const messagList = ref<any[]>([])
const navs = ref<any[]>([
    {
      "label": "首页",
      "color": "#00b2ff",
      "icon": "home",
      "key": "home"
    },
    {
      "label": "消息",
      "color": "#333333",
      "icon": "message",
      "key": "message"
    },
    {
      "label": "我的",
      "color": "#333333",
      "icon": "user",
      "key": "me"
    }
  ])
const currentNav = ref<string>("home")
const goodsList = ref<any[]>([
    {
      "id": "1",
      "name": "内裤",
      "price": 2.12,
      "stock": 0
    },
    {
      "id": "2",
      "name": "上衣",
      "price": 0,
      "stock": 0
    },
    {
      "id": "3",
      "name": "阿三大苏打",
      "price": 0,
      "stock": 0
    }
  ])
const goodsList1 = computed(() => {
  {}  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return goodsList.value.filter((a, i) => (i&1) === 1)
})
const goodsList2 = computed(() => {
  {}  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  return goodsList.value.filter((a, i) => (i&1) === 0)
})
</script>

<template>
  <div class="w-full h-full">
    <div class="flex flex-col w-full min-w-0 h-full min-h-0 m-[0px] p-[0px] bg-[#ededed]">
      <div class="relative w-full min-w-0 flex-1 min-h-0 h-full p-[0px]">
        <div class="relative w-full h-full min-h-0 min-w-0">
          <div class="flex flex-col absolute w-full min-w-0 h-full min-h-0 p-[0px]">
            <TitleBar
              class="w-full min-w-0 h-fit bg-[#409EFF]"
              title="商城"
              :showBack="false"
              background="#409EFF"
              color="#ffffff"
              :isFillScreen="false"
            />
            <div class="relative w-full min-w-0 flex-1 min-h-0 h-full mb-[65px] p-[0px]">
              <div class="relative w-full h-full min-h-0 min-w-0">
                <div
                  class="flex flex-col absolute w-full min-w-0 h-full min-h-0 p-[12px]"
                  v-show="String(currentNav ?? '') === 'message'"
                >
                  <div class="flex flex-col gap-[2px] justify-center w-full min-w-0 h-fit p-[0px]">
                    <template v-for="(item, index) in messagList" :key="index">
                      <div class="flex flex-row items-center w-full min-w-0 h-fit m-[0px] ml-[0px] mr-[0px] mt-[0px] mb-[0px] p-[8px] pl-[8px] pr-[8px] pt-[8px] pb-[8px] bg-[#ffffff]">
                        <div class="flex flex-col justify-center w-fit max-w-full shrink-0 h-fit p-[0px] bg-[#446ecf] rounded-[44px]">
                          <template v-if="!(item.avatar)">
                            <div class="flex items-center justify-center text-xs text-[#909399] bg-[#f2f3f5] w-[40px] h-[40px] rounded-[40px]">
                              图片
                            </div>
                          </template>
                          <template v-else>
                            <img
                              :src="item.avatar"
                              alt="图片"
                              class="object-cover w-[40px] h-[40px] rounded-[40px]"
                            />
                          </template>
                        </div>
                        <div class="flex flex-col flex-1 min-w-0 h-fit ml-[11px] p-[8px]">
                          <span class="text-[16px] text-[#303133] w-fit max-w-full h-fit">
                            {{ item.name }}
                          </span>
                          <span class="text-[12px] text-[#8a8a8a] w-fit max-w-full h-fit">
                            {{ item.content }}
                          </span>
                        </div>
                        <span class="text-[10px] text-[#303133] w-fit max-w-full shrink-0 h-fit">
                          {{ item.time }}
                        </span>
                      </div>
                    </template>
                  </div>
                </div>
                <div
                  class="flex flex-col absolute inset-0 w-full min-w-0 p-[0px] pl-[12px] pr-[12px] pt-[12px] pb-[12px] overflow-x-hidden overflow-y-auto min-h-0 overscroll-contain touch-pan-y"
                  v-show="String(currentNav ?? '') === 'home'"
                >
                  <div class="flex flex-col shrink-0 w-full min-w-0 h-fit p-[0px]">
                    <div class="overflow-hidden shrink-0 w-full min-w-0 h-[140px]">
                      <VoiderSwiper
                        class="w-full h-full min-h-0"
                        :slide-count="2"
                        :indicator="true"
                        indicator-color="rgba(0,0,0,0.25)"
                        indicator-active-color="#409eff"
                        :autoplay="false"
                        :circular="true"
                        :interval="3000"
                        :duration="280"
                        :current="0"
                      >
                        <div class="voider-swiper-slide" :key="0">
                          <img
                            src="https://placebeard.it/370x200"
                            alt="图片"
                            class="object-cover shrink-0 w-full min-w-0 h-[140px] rounded-[0px]"
                          />
                        </div>
                        <div class="voider-swiper-slide" :key="1">
                          <div class="flex items-center justify-center text-xs text-[#909399] bg-[#f2f3f5] shrink-0 w-full min-w-0 h-[140px]">
                            图片
                          </div>
                        </div>
                      </VoiderSwiper>
                    </div>
                  </div>
                  <div class="flex flex-row gap-[12px] shrink-0 w-full min-w-0 h-fit mt-[10px] p-[0px] overflow-visible">
                    <div class="flex flex-col gap-[12px] flex-1 min-w-0 h-fit p-[0px] overflow-visible">
                      <template v-for="(item, index) in goodsList1" :key="index">
                        <GoodsCard
                          class="shrink-0 w-full min-w-0 h-fit p-[0px]"
                          :title="item.name"
                          :price="item.price"
                          :img="item.img"
                          :id="item.id"
                          @select="(payload) => navigateTo('goods-detail', { id: String(payload?.id ?? item?.id ?? '') })"
                        />
                      </template>
                    </div>
                    <div class="flex flex-col gap-[12px] flex-1 min-w-0 h-fit p-[0px] overflow-visible">
                      <template v-for="(item, index) in goodsList2" :key="index">
                        <GoodsCard
                          class="shrink-0 w-full min-w-0 h-fit p-[0px]"
                          :title="item.name"
                          :price="item.price"
                          :img="item.img"
                          :id="item.id"
                          @select="(payload) => navigateTo('goods-detail', { id: String(payload?.id ?? item?.id ?? '') })"
                        />
                      </template>
                    </div>
                  </div>
                  <div class="flex flex-row justify-center shrink-0 w-full min-w-0 h-fit p-[8px]">
                    <span class="text-[14px] text-[#303133] w-fit max-w-full shrink-0 h-fit">
                      已经到低了~
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-row absolute bottom-0 w-full min-w-0 h-[65px] p-[0px] bg-[#ffffff] border border-solid">
            <template v-for="(item, index) in navs" :key="index">
              <div
                class="flex flex-col justify-center items-center flex-1 min-w-0 h-full min-h-0 p-[8px]"
                @click="() => currentNav = item.key"
              >
                <VoiderIcon
                  :name="String(item.icon ?? '')"
                  :size="20"
                  :color="(((String(index ?? '') === '0' && String(currentNav ?? '') === 'home') || (String(index ?? '') === '1' && String(currentNav ?? '') === 'message') || (String(index ?? '') === '2' && String(currentNav ?? '') === 'me'))) ? '#409eff' : ('#555')"
                  class="inline-flex items-center justify-center shrink-0 w-fit max-w-full h-fit"
                />
                <span
                  class="w-fit max-w-full h-fit pt-[5px]"
                  :style="{ color: (((String(index ?? '') === '0' && String(currentNav ?? '') === 'home') || (String(index ?? '') === '1' && String(currentNav ?? '') === 'message') || (String(index ?? '') === '2' && String(currentNav ?? '') === 'me'))) ? '#409eff' : ('#555') }"
                >
                  {{ item.label }}
                </span>
              </div>
            </template>
          </div>
          <div class="overflow-hidden absolute left-0 bottom-0 left-[10px] bottom-[100px] w-[60px] h-[60px] overflow-hidden">
            <VoiderSwiper
              class="w-full h-full min-h-0"
              :slide-count="2"
              :indicator="true"
              indicator-color="#ffffff"
              indicator-active-color="#ff0000"
              :autoplay="false"
              :circular="true"
              :interval="3000"
              :duration="280"
              :current="0"
            >
              <div class="voider-swiper-slide" :key="0">
                <img
                  src="https://ts3.tc.mm.bing.net/th/id/OIP-C.BaTVG1gAGyDZczd-kwb5kgAAAA?w=108&amp;h=108&amp;c=1&amp;bgcl=f66a1b&amp;r=0&amp;o=7&amp;pid=ImgRC&amp;rm=3"
                  alt="图片"
                  class="object-cover cursor-pointer w-[60px] h-[60px]"
                  @click="() => showToast('你好', 'short')"
                />
              </div>
              <div class="voider-swiper-slide" :key="1">
                <img
                  src="https://ts3.tc.mm.bing.net/th/id/OIP-C.trK-7XBjUo2GwvRAHp3kgwAAAA?w=108&amp;h=108&amp;c=1&amp;bgcl=b0a5d8&amp;r=0&amp;o=7&amp;pid=ImgRC&amp;rm=3"
                  alt="图片"
                  class="object-cover w-[60px] h-[60px]"
                />
              </div>
            </VoiderSwiper>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
