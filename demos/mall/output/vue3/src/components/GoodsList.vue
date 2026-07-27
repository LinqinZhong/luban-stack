<script setup lang="ts">
import { computed } from 'vue'
import GoodsCard from './GoodsCard.vue'

const props = withDefaults(
  defineProps<{
  data?: any[]
  }>(),
  {
  data: [],
  },
)

const emit = defineEmits<{
  select: [payload: Record<string, any>]
}>()

const $props = props

const list1 = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  var list = $props.data
  if (!list || !list.filter) return []
  return list.filter(function (_, i) { return (i & 1) === 0 })
})
const list2 = computed(() => {
  // 可直接使用同级数据池字段名作为变量（无需形参）
  // return 的值即为该字段的计算值
  var list = $props.data
  if (!list || !list.filter) return []
  return list.filter(function (_, i) { return (i & 1) === 1 })
})

const store = {
  get $state(): Record<string, any> {
    return {
      list1: list1.value,
      list2: list2.value,
    }
  },
  setData(prop: string, value: any) {
    // no writable fields
  },
}
</script>

<template>
  <div>
    <div class="flex flex-row gap-[8px] w-full min-w-0 h-fit">
      <div class="flex flex-col gap-[8px] flex-1 min-w-0 h-fit">
        <template v-for="(item, index) in list1" :key="index">
          <GoodsCard
            class="w-full min-w-0 h-fit"
            :title="item.name"
            :price="item.price"
            :img="item.img"
            :id="item.id"
            :data="item"
            @select="(payload) => emit(&quot;select&quot;, { goods: payload?.goods ?? item?.goods ?? store.$state.goods })"
          />
        </template>
      </div>
      <div class="flex flex-col gap-[8px] flex-1 min-w-0 h-fit">
        <template v-for="(item, index) in list2" :key="index">
          <GoodsCard
            class="w-full min-w-0 h-fit"
            :title="item.name"
            :price="item.price"
            :img="item.img"
            :id="item.id"
            :data="item"
            @select="(payload) => emit(&quot;select&quot;, { goods: payload?.goods ?? item?.goods ?? store.$state.goods })"
          />
        </template>
      </div>
    </div>
  </div>
</template>
