<script setup lang="ts">
import { ref } from 'vue'
import TitleBar from '../components/TitleBar.vue'

const content = ref<string>("")
const messageList = ref<any[]>([
    {
      "id": "1",
      "name": "小明",
      "content": "你好呀！",
      "userId": "1"
    }
  ])
</script>

<template>
  <div class="w-full h-full">
    <div class="flex flex-col w-full min-w-0 h-full min-h-0 bg-[#ededed]">
      <TitleBar class="w-full min-w-0 h-fit" title="聊天" />
      <div class="relative w-full min-w-0 flex-1 min-h-0 h-full p-[0px]">
        <div class="relative w-full h-full min-h-0 min-w-0">
          <div class="flex flex-row gap-[10px] items-center absolute bottom-0 w-full min-w-0 h-[40px] p-[0px] pl-[10px] pr-[10px] bg-[#ffffff] border-[#ffffff]">
            <input
              type="text"
              :value="content"
              placeholder="请输入消息"
              class="box-border w-full outline-none border-solid bg-[#ffffff] text-[#303133] border-[#dcdfe6] border-[1px] rounded-[4px] text-[14px] flex-1 min-w-0 h-[30px] pl-[12px] pr-[12px] bg-[#ffffff] rounded-[4px] border border-solid border-[#dcdfe6]"
            />
            <button
              type="button"
              class="inline-flex items-center justify-center border-none cursor-pointer rounded-[4px] bg-[#409eff] text-[#ffffff] text-[14px] w-[100px] shrink-0 h-[30px]"
              @click="() => console.warn('unknown method: sendMessage')"
            >
              按钮
            </button>
          </div>
          <div class="flex flex-col absolute bottom-0 top-[0px] bottom-[40px] w-full min-w-0 h-full min-h-0 max-h-full p-[8px] overflow-x-hidden overflow-y-auto min-h-0 overscroll-contain touch-pan-y">
            <template v-for="(item, index) in messageList" :key="index">
              <div class="flex flex-row justify-end shrink-0 w-full min-w-0 h-fit p-[8px]">
                <div class="flex flex-col w-fit max-w-full shrink-0 h-fit ml-[30px] mr-[10px] mt-[10px] pl-[10px] pr-[10px] pt-[5px] pb-[5px] bg-[#409eff] rounded-[5px]">
                  <span class="text-[14px] text-[#ffffff] shrink-0 w-fit max-w-full h-fit">
                    {{ item.content }}
                  </span>
                </div>
                <div class="flex items-center justify-center text-xs text-[#909399] bg-[#f2f3f5] w-[40px] shrink-0 h-[40px] rounded-[100px]">
                  图片
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
