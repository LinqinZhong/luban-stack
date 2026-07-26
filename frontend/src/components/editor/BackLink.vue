<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'

withDefaults(
  defineProps<{
    /** 文案，默认「返回」 */
    label?: string
    disabled?: boolean
  }>(),
  {
    label: '返回',
    disabled: false,
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <el-button
    class="back-link"
    type="primary"
    link
    :icon="ArrowLeft"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    {{ label }}
  </el-button>
</template>

<style scoped>
.back-link {
  flex-shrink: 0;
  padding: 0;
  height: auto;
  font-size: 13px;
}
</style>
