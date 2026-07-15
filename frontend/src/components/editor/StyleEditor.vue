<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import ColorPicker from './ColorPicker.vue'
import NumericInput from './NumericInput.vue'
import {
  GRAVITY_OPTIONS,
  SIZE_OPTIONS,
} from '../../utils/xml-node'
import { OVERFLOW_OPTIONS } from '../../utils/xml'
import type { StyleOverrides } from '../../types/dynamic-styles'

const props = defineProps<{
  modelValue: StyleOverrides
  /** 控件 tag，用于显示内容/图标等专属项 */
  tag?: string
  showBorder?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: StyleOverrides]
}>()

const form = reactive({
  widthMode: 'wrap_content' as string,
  widthValue: 100,
  heightMode: 'wrap_content' as string,
  heightValue: 40,
  margin: '',
  marginLeft: '',
  marginRight: '',
  marginTop: '',
  marginBottom: '',
  padding: '',
  paddingLeft: '',
  paddingRight: '',
  paddingTop: '',
  paddingBottom: '',
  background: '',
  gravity: '',
  borderRadius: '',
  borderTopLeftRadius: '',
  borderTopRightRadius: '',
  borderBottomRightRadius: '',
  borderBottomLeftRadius: '',
  borderWidth: '',
  borderColor: '',
  overflow: '',
  text: '',
  textSize: '',
  textColor: '',
  color: '',
})

const showTextProps = computed(
  () => props.tag === 'Text' || props.tag === 'Button',
)
const showIconColor = computed(() => props.tag === 'Icon')
/** Modal 始终全屏，无宽高 / margin */
const showSizeProps = computed(() => props.tag !== 'Modal')
const showMarginProps = computed(() => props.tag !== 'Modal')
const showBorder = computed(
  () =>
    props.showBorder ??
    (props.tag === 'LinearLayout' ||
      props.tag === 'RelativeLayout' ||
      props.tag === 'Swiper' ||
      props.tag === 'Modal' ||
      props.tag === 'Image'),
)
const showOverflow = computed(
  () => props.tag === 'LinearLayout' || props.tag === 'RelativeLayout',
)

function parseSizeMode(value: string | undefined, fallbackValue: number) {
  if (!value || value === 'wrap_content') {
    return { mode: 'wrap_content', value: fallbackValue }
  }
  if (value === 'match_parent') {
    return { mode: 'match_parent', value: fallbackValue }
  }
  const num = Number(String(value).replace(/px$/i, ''))
  return {
    mode: 'fixed',
    value: Number.isFinite(num) ? num : fallbackValue,
  }
}

function sizeToAttr(mode: string, value: number | string): string {
  if (mode === 'match_parent' || mode === 'wrap_content') return mode
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '0'
}

function syncFromModel(styles: StyleOverrides) {
  const width = parseSizeMode(styles.width, 100)
  const height = parseSizeMode(styles.height, 40)
  form.widthMode = width.mode
  form.widthValue = width.value
  form.heightMode = height.mode
  form.heightValue = height.value
  form.margin = styles.margin ?? ''
  form.marginLeft = styles.marginLeft ?? ''
  form.marginRight = styles.marginRight ?? ''
  form.marginTop = styles.marginTop ?? ''
  form.marginBottom = styles.marginBottom ?? ''
  form.padding = styles.padding ?? ''
  form.paddingLeft = styles.paddingLeft ?? ''
  form.paddingRight = styles.paddingRight ?? ''
  form.paddingTop = styles.paddingTop ?? ''
  form.paddingBottom = styles.paddingBottom ?? ''
  form.background = styles.background ?? ''
  form.gravity = styles.gravity ?? ''
  form.borderRadius = styles.borderRadius ?? ''
  form.borderTopLeftRadius = styles.borderTopLeftRadius ?? ''
  form.borderTopRightRadius = styles.borderTopRightRadius ?? ''
  form.borderBottomRightRadius = styles.borderBottomRightRadius ?? ''
  form.borderBottomLeftRadius = styles.borderBottomLeftRadius ?? ''
  form.borderWidth = styles.borderWidth ?? ''
  form.borderColor = styles.borderColor ?? ''
  form.overflow = styles.overflow ?? ''
  form.text = styles.text ?? ''
  form.textSize = styles.textSize ?? ''
  form.textColor = styles.textColor ?? ''
  form.color = styles.color ?? ''
}

function emitStyles() {
  const next: StyleOverrides = {}
  const set = (key: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
  }

  // wrap_content 表示「不覆盖尺寸」，不写入 overrides；Modal 永不写宽高 / margin
  if (showSizeProps.value) {
    if (form.widthMode === 'match_parent' || form.widthMode === 'fixed') {
      set('width', sizeToAttr(form.widthMode, form.widthValue))
    }
    if (form.heightMode === 'match_parent' || form.heightMode === 'fixed') {
      set('height', sizeToAttr(form.heightMode, form.heightValue))
    }
  }
  if (showMarginProps.value) {
    set('margin', form.margin)
    set('marginLeft', form.marginLeft)
    set('marginRight', form.marginRight)
    set('marginTop', form.marginTop)
    set('marginBottom', form.marginBottom)
  }
  set('padding', form.padding)
  set('paddingLeft', form.paddingLeft)
  set('paddingRight', form.paddingRight)
  set('paddingTop', form.paddingTop)
  set('paddingBottom', form.paddingBottom)
  set('background', form.background)
  if (props.tag !== 'Modal') set('gravity', form.gravity)
  set('borderRadius', form.borderRadius)
  set('borderTopLeftRadius', form.borderTopLeftRadius)
  set('borderTopRightRadius', form.borderTopRightRadius)
  set('borderBottomRightRadius', form.borderBottomRightRadius)
  set('borderBottomLeftRadius', form.borderBottomLeftRadius)
  set('borderWidth', form.borderWidth)
  set('borderColor', form.borderColor)
  set('overflow', form.overflow)
  set('text', form.text)
  set('textSize', form.textSize)
  set('textColor', form.textColor)
  set('color', form.color)

  emit('update:modelValue', next)
}

watch(
  () => props.modelValue,
  (value) => syncFromModel(value ?? {}),
  { immediate: true, deep: true },
)

function onFieldChange() {
  emitStyles()
}
</script>

<template>
  <div class="style-editor">
    <template v-if="showSizeProps">
      <div class="section-title">尺寸</div>
      <el-form label-position="top" size="small">
        <el-form-item label="宽度 width">
          <div class="size-row">
            <el-select v-model="form.widthMode" @change="onFieldChange">
              <el-option
                v-for="opt in SIZE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <NumericInput
              v-if="form.widthMode === 'fixed'"
              v-model="form.widthValue"
              :min="1"
              :max="5000"
              @change="onFieldChange"
            />
          </div>
        </el-form-item>
        <el-form-item label="高度 height">
          <div class="size-row">
            <el-select v-model="form.heightMode" @change="onFieldChange">
              <el-option
                v-for="opt in SIZE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <NumericInput
              v-if="form.heightMode === 'fixed'"
              v-model="form.heightValue"
              :min="1"
              :max="5000"
              @change="onFieldChange"
            />
          </div>
        </el-form-item>
      </el-form>
    </template>

    <div class="section-title">间距</div>
    <el-form label-position="top" size="small">
      <el-form-item label="padding">
        <NumericInput v-model="form.padding" @change="onFieldChange" />
      </el-form-item>
      <div class="quad-grid">
        <el-form-item label="上">
          <NumericInput v-model="form.paddingTop" @change="onFieldChange" />
        </el-form-item>
        <el-form-item label="右">
          <NumericInput v-model="form.paddingRight" @change="onFieldChange" />
        </el-form-item>
        <el-form-item label="下">
          <NumericInput v-model="form.paddingBottom" @change="onFieldChange" />
        </el-form-item>
        <el-form-item label="左">
          <NumericInput v-model="form.paddingLeft" @change="onFieldChange" />
        </el-form-item>
      </div>
      <template v-if="showMarginProps">
        <el-form-item label="margin">
          <NumericInput v-model="form.margin" @change="onFieldChange" />
        </el-form-item>
        <div class="quad-grid">
          <el-form-item label="上">
            <NumericInput v-model="form.marginTop" @change="onFieldChange" />
          </el-form-item>
          <el-form-item label="右">
            <NumericInput v-model="form.marginRight" @change="onFieldChange" />
          </el-form-item>
          <el-form-item label="下">
            <NumericInput v-model="form.marginBottom" @change="onFieldChange" />
          </el-form-item>
          <el-form-item label="左">
            <NumericInput v-model="form.marginLeft" @change="onFieldChange" />
          </el-form-item>
        </div>
      </template>
    </el-form>

    <div class="section-title">外观</div>
    <el-form label-position="top" size="small">
      <el-form-item label="background">
        <ColorPicker v-model="form.background" @change="onFieldChange" />
      </el-form-item>
      <el-form-item v-if="tag !== 'Modal'" label="gravity">
        <el-select
          v-model="form.gravity"
          clearable
          placeholder="默认"
          @change="onFieldChange"
        >
          <el-option
            v-for="opt in GRAVITY_OPTIONS"
            :key="opt.value || 'default'"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <template v-if="showBorder">
        <el-form-item label="borderRadius 统一圆角">
          <NumericInput
            v-model="form.borderRadius"
            placeholder="四角共用；分角优先"
            @change="onFieldChange"
          />
        </el-form-item>
        <div class="quad-grid">
          <el-form-item label="上左">
            <NumericInput
              v-model="form.borderTopLeftRadius"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="上右">
            <NumericInput
              v-model="form.borderTopRightRadius"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="下右">
            <NumericInput
              v-model="form.borderBottomRightRadius"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="下左">
            <NumericInput
              v-model="form.borderBottomLeftRadius"
              @change="onFieldChange"
            />
          </el-form-item>
        </div>
        <el-form-item label="borderWidth">
          <NumericInput v-model="form.borderWidth" @change="onFieldChange" />
        </el-form-item>
        <el-form-item label="borderColor">
          <ColorPicker v-model="form.borderColor" @change="onFieldChange" />
        </el-form-item>
      </template>
      <el-form-item v-if="showOverflow" label="overflow 溢出">
        <el-select
          v-model="form.overflow"
          clearable
          placeholder="默认隐藏"
          @change="onFieldChange"
        >
          <el-option
            v-for="opt in OVERFLOW_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <template v-if="showTextProps">
      <div class="section-title">内容</div>
      <el-form label-position="top" size="small">
        <el-form-item label="text">
          <el-input v-model="form.text" clearable @change="onFieldChange" />
        </el-form-item>
        <el-form-item label="textSize">
          <NumericInput
            v-model="form.textSize"
            :min="1"
            :max="200"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="textColor">
          <ColorPicker v-model="form.textColor" @change="onFieldChange" />
        </el-form-item>
      </el-form>
    </template>

    <template v-if="showIconColor">
      <div class="section-title">图标</div>
      <el-form label-position="top" size="small">
        <el-form-item label="color">
          <ColorPicker v-model="form.color" @change="onFieldChange" />
        </el-form-item>
      </el-form>
    </template>
  </div>
</template>

<style scoped>
.style-editor {
  min-width: 0;
}

.section-title {
  margin: 12px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: #909399;
}

.section-title:first-child {
  margin-top: 0;
}

.size-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.size-row > :first-child {
  flex: 1;
  min-width: 0;
}

.size-row > :last-child {
  width: 100px;
  flex-shrink: 0;
}

.quad-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 8px;
}

:deep(.el-form-item) {
  margin-bottom: 10px;
}
</style>
