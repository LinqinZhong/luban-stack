<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import AttrBindField from './AttrBindField.vue'
import {
  GRAVITY_OPTIONS,
  SIZE_OPTIONS,
} from '../../utils/xml-node'
import { OVERFLOW_OPTIONS } from '../../utils/xml'
import type { StyleOverrides } from '../../types/dynamic-styles'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'

const props = defineProps<{
  modelValue: StyleOverrides
  /** 控件 tag，用于显示内容/图标等专属项 */
  tag?: string
  showBorder?: boolean
  dataFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  pageQueryParams?: PageQueryParamDef[] | null
  repeatListName?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: StyleOverrides]
}>()

const attrBindShared = computed(() => ({
  dataFields: props.dataFields ?? [],
  componentProps: props.componentProps,
  routeParams: props.routeParams,
  pageQueryParams: props.pageQueryParams,
  repeatListName: props.repeatListName,
}))

const form = reactive({
  widthMode: 'wrap_content' as string,
  widthValue: '100' as string,
  heightMode: 'wrap_content' as string,
  heightValue: '40' as string,
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
  zIndex: '',
  text: '',
  textSize: '',
  textColor: '',
  value: '',
  placeholder: '',
  color: '',
  rotateX: '',
  rotateY: '',
  rotateZ: '',
})

const showTextProps = computed(
  () => props.tag === 'Text' || props.tag === 'Button',
)
const showInputProps = computed(() => props.tag === 'Input')
const showIconColor = computed(() => props.tag === 'Icon')
const showRotateProps = computed(
  () => props.tag === 'Text' || props.tag === 'Image' || props.tag === 'Icon',
)
/** Modal 始终全屏，无宽高 / margin */
const showSizeProps = computed(() => props.tag !== 'Modal')
const showMarginProps = computed(() => props.tag !== 'Modal')
const showBorder = computed(
  () =>
    props.showBorder ??
    (props.tag === 'LinearLayout' ||
      props.tag === 'RelativeLayout' ||
      props.tag === 'Swiper' ||
      props.tag === 'MultiWindow' ||
      props.tag === 'Modal' ||
      props.tag === 'Image' ||
      props.tag === 'Input'),
)
const showOverflow = computed(
  () =>
    props.tag === 'LinearLayout' ||
    props.tag === 'RelativeLayout' ||
    props.tag === 'Swiper' ||
    props.tag === 'MultiWindow',
)

const overflowOptionsForTag = computed(() => {
  if (props.tag === 'Swiper' || props.tag === 'MultiWindow') {
    return OVERFLOW_OPTIONS.filter((item) => item.value !== 'scroll')
  }
  return OVERFLOW_OPTIONS
})

function parseSizeMode(value: string | undefined, fallbackValue: number) {
  if (!value || value === 'wrap_content') {
    return { mode: 'wrap_content', value: String(fallbackValue) }
  }
  if (value === 'match_parent') {
    return { mode: 'match_parent', value: String(fallbackValue) }
  }
  return {
    mode: 'fixed',
    value: String(value).replace(/px$/i, ''),
  }
}

function sizeToAttr(mode: string, value: number | string): string {
  if (mode === 'match_parent' || mode === 'wrap_content') return mode
  const raw = String(value ?? '').trim()
  if (!raw) return '0'
  if (/\{[^{}]+\}/.test(raw)) return raw
  const num = Number(raw.replace(/px$/i, ''))
  return Number.isFinite(num) ? String(num) : raw
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
  form.zIndex = styles.zIndex ?? ''
  form.text = styles.text ?? ''
  form.textSize = styles.textSize ?? ''
  form.textColor = styles.textColor ?? ''
  form.value = styles.value ?? ''
  form.placeholder = styles.placeholder ?? ''
  form.color = styles.color ?? ''
  form.rotateX = styles.rotateX ?? ''
  form.rotateY = styles.rotateY ?? ''
  form.rotateZ = styles.rotateZ ?? ''
}

function emitStyles() {
  const next: StyleOverrides = {}
  const set = (key: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed) next[key] = trimmed
  }

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
  set('zIndex', form.zIndex)
  set('text', form.text)
  set('textSize', form.textSize)
  set('textColor', form.textColor)
  set('value', form.value)
  set('placeholder', form.placeholder)
  set('color', form.color)
  if (showRotateProps.value) {
    set('rotateX', form.rotateX)
    set('rotateY', form.rotateY)
    set('rotateZ', form.rotateZ)
  }

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
            <AttrBindField
              v-if="form.widthMode === 'fixed'"
              v-model="form.widthValue"
              placeholder="数字 / 绑定"
              v-bind="attrBindShared"
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
            <AttrBindField
              v-if="form.heightMode === 'fixed'"
              v-model="form.heightValue"
              placeholder="数字 / 绑定"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </div>
        </el-form-item>
      </el-form>
    </template>

    <div class="section-title">间距</div>
    <el-form label-position="top" size="small">
      <el-form-item label="padding">
        <AttrBindField
          v-model="form.padding"
          v-bind="attrBindShared"
          @change="onFieldChange"
        />
      </el-form-item>
      <div class="quad-grid">
        <el-form-item label="上">
          <AttrBindField
            v-model="form.paddingTop"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="右">
          <AttrBindField
            v-model="form.paddingRight"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="下">
          <AttrBindField
            v-model="form.paddingBottom"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="左">
          <AttrBindField
            v-model="form.paddingLeft"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
      </div>
      <template v-if="showMarginProps">
        <el-form-item label="margin">
          <AttrBindField
            v-model="form.margin"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <div class="quad-grid">
          <el-form-item label="上">
            <AttrBindField
              v-model="form.marginTop"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="右">
            <AttrBindField
              v-model="form.marginRight"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="下">
            <AttrBindField
              v-model="form.marginBottom"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="左">
            <AttrBindField
              v-model="form.marginLeft"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
        </div>
      </template>
    </el-form>

    <div class="section-title">外观</div>
    <el-form label-position="top" size="small">
      <el-form-item label="background">
        <AttrBindField
          v-model="form.background"
          placeholder="色值 / 绑定"
          v-bind="attrBindShared"
          @change="onFieldChange"
        />
      </el-form-item>
      <el-form-item label="层级 zIndex">
        <AttrBindField
          v-model="form.zIndex"
          placeholder="如 10"
          v-bind="attrBindShared"
          @change="onFieldChange"
        />
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
          <AttrBindField
            v-model="form.borderRadius"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <div class="quad-grid">
          <el-form-item label="上左">
            <AttrBindField
              v-model="form.borderTopLeftRadius"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="上右">
            <AttrBindField
              v-model="form.borderTopRightRadius"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="下右">
            <AttrBindField
              v-model="form.borderBottomRightRadius"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
          <el-form-item label="下左">
            <AttrBindField
              v-model="form.borderBottomLeftRadius"
              v-bind="attrBindShared"
              @change="onFieldChange"
            />
          </el-form-item>
        </div>
        <el-form-item label="borderWidth">
          <AttrBindField
            v-model="form.borderWidth"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="borderColor">
          <AttrBindField
            v-model="form.borderColor"
            placeholder="色值 / 绑定"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
      </template>
      <el-form-item v-if="showOverflow" label="overflow 溢出">
        <el-select
          v-model="form.overflow"
          clearable
          placeholder="默认显示"
          @change="onFieldChange"
        >
          <el-option
            v-for="opt in overflowOptionsForTag"
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
          <AttrBindField
            v-model="form.text"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="textSize">
          <AttrBindField
            v-model="form.textSize"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="textColor">
          <AttrBindField
            v-model="form.textColor"
            placeholder="色值 / 绑定"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
      </el-form>
    </template>

    <template v-if="showInputProps">
      <div class="section-title">输入</div>
      <el-form label-position="top" size="small">
        <el-form-item label="value">
          <AttrBindField
            v-model="form.value"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="placeholder">
          <AttrBindField
            v-model="form.placeholder"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="textSize">
          <AttrBindField
            v-model="form.textSize"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="textColor">
          <AttrBindField
            v-model="form.textColor"
            placeholder="色值 / 绑定"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
      </el-form>
    </template>

    <template v-if="showIconColor">
      <div class="section-title">图标</div>
      <el-form label-position="top" size="small">
        <el-form-item label="color">
          <AttrBindField
            v-model="form.color"
            placeholder="色值 / 绑定"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
      </el-form>
    </template>

    <template v-if="showRotateProps">
      <div class="section-title">旋转</div>
      <el-form label-position="top" size="small">
        <el-form-item label="rotateX（度）">
          <AttrBindField
            v-model="form.rotateX"
            placeholder="0"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="rotateY（度）">
          <AttrBindField
            v-model="form.rotateY"
            placeholder="0"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
        </el-form-item>
        <el-form-item label="rotateZ（度）">
          <AttrBindField
            v-model="form.rotateZ"
            placeholder="0"
            v-bind="attrBindShared"
            @change="onFieldChange"
          />
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
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.quad-grid {
  display: flex;
  flex-direction: column;
  gap: 0;
}

:deep(.el-form-item) {
  margin-bottom: 10px;
}
</style>
