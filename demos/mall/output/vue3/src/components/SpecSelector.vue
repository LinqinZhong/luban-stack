<script setup lang="ts">
import { reactive } from 'vue'

const props = defineProps<{

}>()

const emit = defineEmits<{
  // no events
}>()

const modalVisible = reactive<Record<string, boolean>>({
  'mask': false,
})



function open() {
  const firstModal = Object.keys(modalVisible)[0]
  if (firstModal) modalVisible[firstModal] = true
}

defineExpose({ open, close })
</script>

<template>
  <div>
    <Teleport to=".voider-page">
      <div
        v-if="modalVisible['mask']"
        class="absolute inset-0 z-50 box-border p-[0px] bg-[rgba(0_0_0_0.45)]"
        @click.self="modalVisible['mask'] = false"
      >
        <div
          class="relative w-full h-full min-h-0 overflow-hidden"
          @click.self="modalVisible['mask'] = false"
        >
        <div class="flex flex-col absolute bottom-0 w-full min-w-0 h-[400px] p-[12px] pt-[0px] pb-[0px] bg-[#ffffff] rounded-[0px] rounded-tl-[30px] rounded-tr-[30px] rounded-br-[0px]"></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
