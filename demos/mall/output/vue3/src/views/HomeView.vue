<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useNavigation, showToast } from '../runtime/helpers'
import { interpolate, type EventScope } from '../runtime/voider'
import TitleBar from '../components/TitleBar.vue'
import Pager from '../components/Pager.vue'
import GoodsList from '../components/GoodsList.vue'
import VoiderIcon from '../components/VoiderIcon.vue'
import VoiderSwiper from '../components/VoiderSwiper.vue'

const { navigateTo } = useNavigation()

const route = useRoute()

const messagList = ref<any[]>([
    {
      "id": "1",
      "name": "小明",
      "content": "晚上打游戏吗",
      "userId": ""
    }
  ])
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
const goodsList = ref<any[]>([])

const pageStore = {
  get $state(): Record<string, any> {
    return {
      messagList: messagList.value,
      navs: navs.value,
      currentNav: currentNav.value,
      goodsList: goodsList.value,
    }
  },
  setData(prop: string, value: any) {
    if (prop === 'messagList') { messagList.value = value as typeof messagList.value; return }
    if (prop === 'navs') { navs.value = value as typeof navs.value; return }
    if (prop === 'currentNav') { currentNav.value = value as typeof currentNav.value; return }
    if (prop === 'goodsList') { goodsList.value = value as typeof goodsList.value; return }
  },
}

function visibilityCtx(scope?: EventScope) {
  return {
    store: pageStore,
    scope,
    route: route.params as Record<string, any>,
  }
}
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
            <div class="overflow-visible relative min-h-0 w-full min-w-0 flex-1 min-h-0 h-full mb-[65px]">
              <div
                class="absolute inset-0 flex flex-col min-w-0 min-h-0 overflow-visible"
                v-show="String(currentNav ?? '') === 'home'"
                :key="'0:home'"
              >
                <div class="flex flex-col w-full min-w-0 h-full min-h-0">
                  <div
                    class="flex flex-col w-full min-w-0 flex-1 min-h-0 h-full overflow-hidden"
                    v-show="String(currentNav ?? '') === 'home'"
                  >
                    <Pager
                      class="w-full min-w-0 flex-1 min-h-0 h-full"
                      :fetchApi="interpolate('{"serviceId":"svc_mrqdgnhb_3ktq2g","controllerId":"cmrqed0jzshj7","apiId":"api_mrqedc08_9iml1r"}', { store: pageStore, scope: undefined, props: undefined, route: route.params as Record<string, any> })"
                      v-model:data="goodsList"
                    >
                      <template #header>
                        <div class="flex flex-col w-full min-w-0 h-fit pl-[10px] pr-[10px] pt-[10px]">
                          <div class="overflow-hidden w-full min-w-0 h-[140px] bg-[#ffffff] overflow-hidden">
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
                                  class="object-cover w-full min-w-0 h-[140px] rounded-[0px]"
                                />
                              </div>
                              <div class="voider-swiper-slide" :key="1">
                                <div class="flex items-center justify-center text-xs text-[#909399] bg-[#f2f3f5] w-full min-w-0 h-[140px]">
                                  图片
                                </div>
                              </div>
                            </VoiderSwiper>
                          </div>
                        </div>
                      </template>
                      <template #default="{ item }">
                        <GoodsList
                          class="w-full min-w-0 h-full min-h-0 pl-[10px] pr-[10px] pt-[10px]"
                          :data="goodsList"
                          @select="(payload) => navigateTo('goods-detail', { id: String(payload?.goods.id ?? '') })"
                        />
                      </template>
                    </Pager>
                  </div>
                </div>
              </div>
              <div
                class="absolute inset-0 flex flex-col min-w-0 min-h-0 overflow-visible"
                v-show="String(currentNav ?? '') === 'message'"
                :key="'1:message'"
              >
                <div class="flex flex-col w-full min-w-0 h-full min-h-0">
                  <div
                    class="flex flex-col w-full min-w-0 flex-1 min-h-0 h-full p-[12px]"
                    v-show="String(currentNav ?? '') === 'message'"
                  >
                    <div class="flex flex-col gap-[2px] justify-center w-full min-w-0 h-fit p-[0px]">
                      <template v-for="(item, index) in messagList" :key="index">
                        <div
                          class="flex flex-row items-center w-full min-w-0 h-fit m-[0px] ml-[0px] mr-[0px] mt-[0px] mb-[0px] p-[8px] pl-[8px] pr-[8px] pt-[8px] pb-[8px] bg-[#ffffff]"
                          @click="() => navigateTo('chat')"
                        >
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
                </div>
              </div>
              <div
                class="absolute inset-0 flex flex-col min-w-0 min-h-0 overflow-visible"
                v-show="String(currentNav ?? '') === 'me'"
                :key="'2:me'"
              >
                <div class="flex flex-col w-full min-w-0 h-fit p-[8px]"></div>
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
