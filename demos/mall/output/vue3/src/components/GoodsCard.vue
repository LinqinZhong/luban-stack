<script setup lang="ts">


const props = withDefaults(
  defineProps<{
  title: string
  price: number
  img?: string
  id: string
  }>(),
  {
  img: '',
  },
)

const emit = defineEmits<{
  select: [payload: Record<string, any>]
}>()
</script>

<template>
  <div>
    <div
      class="flex flex-col w-full min-w-0 h-fit p-[0px] bg-[#ffffff] rounded-[12px] overflow-hidden"
      @click="() => emit(&quot;select&quot;, { id: props.id })"
    >
      <template v-if="!(props.img)">
        <div class="flex items-center justify-center text-xs text-[#909399] bg-[#f2f3f5] w-full min-w-0 h-[115px]">
          图片
        </div>
      </template>
      <template v-else>
        <img :src="props.img" alt="图片" class="object-cover w-full min-w-0 h-[115px]" />
      </template>
      <span class="text-[14px] text-[#303133] w-fit max-w-full h-fit ml-[12px] mr-[12px] mt-[12px] pr-[0px] pt-[0px]">
        {{ props.title }}
      </span>
      <div class="flex flex-row items-end w-full min-w-0 h-fit ml-[12px] mr-[12px] mt-[10px] mb-[10px] p-[0px] pt-[6px]">
        <span class="text-[14px] text-[#ff0000] w-fit max-w-full shrink-0 h-fit m-[0px] mt-[0px] mb-[0px] pb-[0px]">
          ￥
        </span>
        <span class="text-[20px] text-[#ff0000] w-fit max-w-full shrink-0 h-fit pt-[0px]">
          {{ props.price }}
        </span>
      </div>
    </div>
  </div>
</template>
