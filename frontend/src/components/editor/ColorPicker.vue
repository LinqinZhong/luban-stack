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

/** 快捷参考色 */
const PRESET_COLORS = [
  { label: '透明', value: 'transparent' },
  { label: '白', value: '#ffffff' },
  { label: '黑', value: '#000000' },
] as const

/** el-color-picker 预置（含透明） */
const PREDEFINE = ['transparent', '#ffffff', '#000000', '#409eff', '#67c23a', '#e6a23c', '#f56c6c']

const localValue = ref(normalizeColor(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    localValue.value = normalizeColor(value)
  },
)

const isBinding = computed(() => /\{[^{}]+\}/.test(localValue.value.trim()))

/** 供 el-color-picker 使用的可解析色值 */
const pickerModel = computed({
  get() {
    return toPickerColor(localValue.value)
  },
  set(value: string | null) {
    if (value == null || value === '') {
      commit('transparent')
      return
    }
    commit(formatOutgoingColor(value))
  },
})

function normalizeColor(value: unknown): string {
  return String(value ?? '').trim()
}

function toPickerColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'transparent' || /\{[^{}]+\}/.test(trimmed)) {
    return 'rgba(255, 255, 255, 0)'
  }
  if (/^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) return hex8ToRgba(trimmed)
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#ffffff'
}

function hex8ToRgba(hex: string): string {
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = parseInt(h.slice(6, 8), 16) / 255
  const alpha = Math.round(a * 1000) / 1000
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 写出：全透明 → transparent；不透明 hex → #rrggbb；半透明 → rgba */
function formatOutgoingColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'transparent'

  const rgba = parseRgba(trimmed)
  if (rgba) {
    if (rgba.a <= 0.005) return 'transparent'
    if (rgba.a >= 0.995) {
      return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`
    }
    const a = Math.round(rgba.a * 1000) / 1000
    return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a})`
  }

  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return formatOutgoingColor(hex8ToRgba(trimmed))
  }
  if (/^#[0-9a-f]{3,6}$/i.test(trimmed)) return trimmed.toLowerCase()
  return trimmed
}

function parseRgba(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const m = value
    .trim()
    .match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i,
    )
  if (!m) return null
  return {
    r: clampByte(Number(m[1])),
    g: clampByte(Number(m[2])),
    b: clampByte(Number(m[3])),
    a: m[4] == null ? 1 : Math.min(1, Math.max(0, Number(m[4]))),
  }
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(255, Math.max(0, Math.round(n)))
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0')
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

function applyPreset(value: string) {
  commit(value)
}

function handleEyedropper() {
  void colorPickState.startPick((color) => {
    commit(color)
  })
}

function isPresetActive(value: string): boolean {
  const cur = localValue.value.trim().toLowerCase()
  if (value === 'transparent') return !cur || cur === 'transparent'
  return cur === value.toLowerCase()
}
</script>

<template>
  <div class="color-picker">
    <div class="color-picker-row">
      <el-color-picker
        v-model="pickerModel"
        class="ep-picker"
        size="small"
        show-alpha
        :predefine="PREDEFINE"
        :disabled="isBinding"
      />

      <el-input
        v-model="localValue"
        class="hex-input"
        size="small"
        :placeholder="placeholder || '#ffffff / transparent / rgba()'"
        clearable
        @change="handleTextChange"
      />

      <el-tooltip content="吸管取色" placement="top">
        <el-button
          class="eyedropper-btn"
          size="small"
          :icon="Aim"
          @click="handleEyedropper"
        />
      </el-tooltip>
    </div>

    <div class="preset-row" role="list" aria-label="参考颜色">
      <button
        v-for="item in PRESET_COLORS"
        :key="item.value"
        type="button"
        class="preset-chip"
        :class="{ active: isPresetActive(item.value) }"
        :title="item.label"
        role="listitem"
        @click="applyPreset(item.value)"
      >
        <span
          class="preset-swatch"
          :class="{ checker: item.value === 'transparent' }"
          :style="
            item.value === 'transparent' ? undefined : { background: item.value }
          "
        />
        <span class="preset-label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 24px;
}

.ep-picker {
  flex-shrink: 0;
  height: 24px;
}

.ep-picker :deep(.el-color-picker__trigger) {
  width: 24px;
  height: 24px;
  padding: 2px;
  border-radius: 4px;
}

.hex-input {
  flex: 1;
  min-width: 0;
}

.hex-input :deep(.el-input__wrapper) {
  min-height: 24px;
}

.eyedropper-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px 0 4px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}

.preset-chip:hover {
  border-color: #c0c4cc;
  color: #303133;
}

.preset-chip.active {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}

.preset-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
  flex-shrink: 0;
}

.preset-swatch.checker {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 6px 6px;
  background-position:
    0 0,
    0 3px,
    3px -3px,
    -3px 0;
}

.preset-label {
  white-space: nowrap;
}
</style>
