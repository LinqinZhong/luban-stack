<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Aim } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const localValue = ref(normalizeColor(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    localValue.value = normalizeColor(value)
  },
)

const swatchColor = computed(() => {
  const value = localValue.value.trim()
  if (!value || value === 'transparent') return 'transparent'
  return value.startsWith('#') ? value : '#ffffff'
})

function normalizeColor(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed || trimmed === 'transparent') return trimmed
  if (trimmed.startsWith('#')) return trimmed
  return trimmed
}

function toPickerHex(value: string): string {
  if (!value || value === 'transparent') return '#ffffff'
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [, r, g, b] = value
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#ffffff'
}

function commit(value: string) {
  const next = normalizeColor(value)
  localValue.value = next
  emit('update:modelValue', next)
  emit('change', next)
}

function handleTextChange() {
  commit(localValue.value)
}

function handlePickerInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  commit(value)
}

function handleEyedropper() {
  void colorPickState.startPick((color) => {
    commit(color)
  })
}
</script>

<template>
  <div class="color-picker">
    <label class="swatch" :title="placeholder || '选择颜色'">
      <input
        class="native-picker"
        type="color"
        :value="toPickerHex(localValue)"
        @input="handlePickerInput"
      />
      <span class="swatch-fill" :style="{ background: swatchColor }" />
    </label>

    <el-input
      v-model="localValue"
      class="hex-input"
      :placeholder="placeholder || '#ffffff / transparent'"
      clearable
      @change="handleTextChange"
    />

    <el-tooltip content="吸管取色" placement="top">
      <el-button class="eyedropper-btn" :icon="Aim" @click="handleEyedropper" />
    </el-tooltip>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.swatch {
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
}

.native-picker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.swatch-fill {
  display: block;
  width: 100%;
  height: 100%;
  background:
  linear-gradient(45deg, #ccc 25%, transparent 25%),
  linear-gradient(-45deg, #ccc 25%, transparent 25%),
  linear-gradient(45deg, transparent 75%, #ccc 75%),
  linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}

.hex-input {
  flex: 1;
  min-width: 0;
}

.eyedropper-btn {
  flex-shrink: 0;
}
</style>
