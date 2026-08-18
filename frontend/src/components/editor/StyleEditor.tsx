import { useEffect, useMemo, useState } from 'react'
import { Form, Select } from 'antd'
import AttrBindField from './AttrBindField'
import { GRAVITY_OPTIONS, SIZE_OPTIONS } from '../../utils/xml-node'
import { OVERFLOW_OPTIONS } from '../../utils/xml'
import type { StyleOverrides } from '../../types/dynamic-styles'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import './StyleEditor.css'

type FormState = {
  widthMode: string
  widthValue: string
  heightMode: string
  heightValue: string
  margin: string
  marginLeft: string
  marginRight: string
  marginTop: string
  marginBottom: string
  padding: string
  paddingLeft: string
  paddingRight: string
  paddingTop: string
  paddingBottom: string
  background: string
  gravity: string
  borderRadius: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomRightRadius: string
  borderBottomLeftRadius: string
  borderWidth: string
  borderColor: string
  overflow: string
  zIndex: string
  text: string
  textSize: string
  textColor: string
  value: string
  placeholder: string
  color: string
  rotateX: string
  rotateY: string
  rotateZ: string
}

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

function syncFromModel(styles: StyleOverrides): FormState {
  const width = parseSizeMode(styles.width, 100)
  const height = parseSizeMode(styles.height, 40)
  return {
    widthMode: width.mode,
    widthValue: width.value,
    heightMode: height.mode,
    heightValue: height.value,
    margin: styles.margin ?? '',
    marginLeft: styles.marginLeft ?? '',
    marginRight: styles.marginRight ?? '',
    marginTop: styles.marginTop ?? '',
    marginBottom: styles.marginBottom ?? '',
    padding: styles.padding ?? '',
    paddingLeft: styles.paddingLeft ?? '',
    paddingRight: styles.paddingRight ?? '',
    paddingTop: styles.paddingTop ?? '',
    paddingBottom: styles.paddingBottom ?? '',
    background: styles.background ?? '',
    gravity: styles.gravity ?? '',
    borderRadius: styles.borderRadius ?? '',
    borderTopLeftRadius: styles.borderTopLeftRadius ?? '',
    borderTopRightRadius: styles.borderTopRightRadius ?? '',
    borderBottomRightRadius: styles.borderBottomRightRadius ?? '',
    borderBottomLeftRadius: styles.borderBottomLeftRadius ?? '',
    borderWidth: styles.borderWidth ?? '',
    borderColor: styles.borderColor ?? '',
    overflow: styles.overflow ?? '',
    zIndex: styles.zIndex ?? '',
    text: styles.text ?? '',
    textSize: styles.textSize ?? '',
    textColor: styles.textColor ?? '',
    value: styles.value ?? '',
    placeholder: styles.placeholder ?? '',
    color: styles.color ?? '',
    rotateX: styles.rotateX ?? '',
    rotateY: styles.rotateY ?? '',
    rotateZ: styles.rotateZ ?? '',
  }
}

export default function StyleEditor({
  value,
  onChange,
  tag,
  showBorder: showBorderProp,
  dataFields,
  componentProps,
  routeParams,
  pageQueryParams,
  repeatListName,
}: {
  value: StyleOverrides
  onChange?: (value: StyleOverrides) => void
  tag?: string
  showBorder?: boolean
  dataFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  pageQueryParams?: PageQueryParamDef[] | null
  repeatListName?: string | null
}) {
  const [form, setForm] = useState<FormState>(() => syncFromModel(value ?? {}))

  useEffect(() => {
    setForm(syncFromModel(value ?? {}))
  }, [value])

  const attrBindShared = {
    dataFields: dataFields ?? [],
    componentProps,
    routeParams,
    pageQueryParams,
    repeatListName,
  }

  const showTextProps = tag === 'Text' || tag === 'Button'
  const showInputProps = tag === 'Input'
  const showIconColor = tag === 'Icon'
  const showRotateProps = tag === 'Text' || tag === 'Image' || tag === 'Icon'
  const showSizeProps = tag !== 'Modal'
  const showMarginProps = tag !== 'Modal'
  const showBorder =
    showBorderProp ??
    (tag === 'LinearLayout' ||
      tag === 'RelativeLayout' ||
      tag === 'Swiper' ||
      tag === 'MultiWindow' ||
      tag === 'Modal' ||
      tag === 'Image' ||
      tag === 'Input')
  const showOverflow =
    tag === 'LinearLayout' ||
    tag === 'RelativeLayout' ||
    tag === 'Swiper' ||
    tag === 'MultiWindow'

  const overflowOptionsForTag = useMemo(() => {
    if (tag === 'Swiper' || tag === 'MultiWindow') {
      return OVERFLOW_OPTIONS.filter((item) => item.value !== 'scroll')
    }
    return OVERFLOW_OPTIONS
  }, [tag])

  function emitStyles(nextForm: FormState) {
    const next: StyleOverrides = {}
    const set = (key: string, raw: string) => {
      const trimmed = raw.trim()
      if (trimmed) next[key] = trimmed
    }

    if (showSizeProps) {
      if (nextForm.widthMode === 'match_parent' || nextForm.widthMode === 'fixed') {
        set('width', sizeToAttr(nextForm.widthMode, nextForm.widthValue))
      }
      if (nextForm.heightMode === 'match_parent' || nextForm.heightMode === 'fixed') {
        set('height', sizeToAttr(nextForm.heightMode, nextForm.heightValue))
      }
    }
    if (showMarginProps) {
      set('margin', nextForm.margin)
      set('marginLeft', nextForm.marginLeft)
      set('marginRight', nextForm.marginRight)
      set('marginTop', nextForm.marginTop)
      set('marginBottom', nextForm.marginBottom)
    }
    set('padding', nextForm.padding)
    set('paddingLeft', nextForm.paddingLeft)
    set('paddingRight', nextForm.paddingRight)
    set('paddingTop', nextForm.paddingTop)
    set('paddingBottom', nextForm.paddingBottom)
    set('background', nextForm.background)
    if (tag !== 'Modal') set('gravity', nextForm.gravity)
    set('borderRadius', nextForm.borderRadius)
    set('borderTopLeftRadius', nextForm.borderTopLeftRadius)
    set('borderTopRightRadius', nextForm.borderTopRightRadius)
    set('borderBottomRightRadius', nextForm.borderBottomRightRadius)
    set('borderBottomLeftRadius', nextForm.borderBottomLeftRadius)
    set('borderWidth', nextForm.borderWidth)
    set('borderColor', nextForm.borderColor)
    set('overflow', nextForm.overflow)
    set('zIndex', nextForm.zIndex)
    set('text', nextForm.text)
    set('textSize', nextForm.textSize)
    set('textColor', nextForm.textColor)
    set('value', nextForm.value)
    set('placeholder', nextForm.placeholder)
    set('color', nextForm.color)
    if (showRotateProps) {
      set('rotateX', nextForm.rotateX)
      set('rotateY', nextForm.rotateY)
      set('rotateZ', nextForm.rotateZ)
    }

    onChange?.(next)
  }

  function patch(partial: Partial<FormState>) {
    const next = { ...form, ...partial }
    setForm(next)
    emitStyles(next)
  }

  function bindField(key: keyof FormState) {
    return {
      value: form[key],
      onChange: (next: string) => patch({ [key]: next }),
      ...attrBindShared,
    }
  }

  return (
    <div className="style-editor">
      {showSizeProps ? (
        <>
          <div className="section-title">尺寸</div>
          <Form layout="vertical" size="small">
            <Form.Item label="宽度 width">
              <div className="size-row">
                <Select
                  value={form.widthMode}
                  options={[...SIZE_OPTIONS]}
                  onChange={(widthMode) => patch({ widthMode })}
                />
                {form.widthMode === 'fixed' ? (
                  <AttrBindField
                    {...bindField('widthValue')}
                    placeholder="数字 / 绑定"
                    valueType="number"
                  />
                ) : null}
              </div>
            </Form.Item>
            <Form.Item label="高度 height">
              <div className="size-row">
                <Select
                  value={form.heightMode}
                  options={[...SIZE_OPTIONS]}
                  onChange={(heightMode) => patch({ heightMode })}
                />
                {form.heightMode === 'fixed' ? (
                  <AttrBindField
                    {...bindField('heightValue')}
                    placeholder="数字 / 绑定"
                    valueType="number"
                  />
                ) : null}
              </div>
            </Form.Item>
          </Form>
        </>
      ) : null}

      <div className="section-title">间距</div>
      <Form layout="vertical" size="small">
        <Form.Item label="padding">
          <AttrBindField {...bindField('padding')} valueType="number" />
        </Form.Item>
        <div className="quad-grid">
          <Form.Item label="上">
            <AttrBindField {...bindField('paddingTop')} valueType="number" />
          </Form.Item>
          <Form.Item label="右">
            <AttrBindField {...bindField('paddingRight')} valueType="number" />
          </Form.Item>
          <Form.Item label="下">
            <AttrBindField {...bindField('paddingBottom')} valueType="number" />
          </Form.Item>
          <Form.Item label="左">
            <AttrBindField {...bindField('paddingLeft')} valueType="number" />
          </Form.Item>
        </div>
        {showMarginProps ? (
          <>
            <Form.Item label="margin">
              <AttrBindField {...bindField('margin')} valueType="number" />
            </Form.Item>
            <div className="quad-grid">
              <Form.Item label="上">
                <AttrBindField {...bindField('marginTop')} valueType="number" />
              </Form.Item>
              <Form.Item label="右">
                <AttrBindField {...bindField('marginRight')} valueType="number" />
              </Form.Item>
              <Form.Item label="下">
                <AttrBindField {...bindField('marginBottom')} valueType="number" />
              </Form.Item>
              <Form.Item label="左">
                <AttrBindField {...bindField('marginLeft')} valueType="number" />
              </Form.Item>
            </div>
          </>
        ) : null}
      </Form>

      <div className="section-title">外观</div>
      <Form layout="vertical" size="small">
        <Form.Item label="background">
          <AttrBindField
            {...bindField('background')}
            placeholder="色值 / 绑定"
            valueType="color"
          />
        </Form.Item>
        <Form.Item label="层级 zIndex">
          <AttrBindField
            {...bindField('zIndex')}
            placeholder="如 10"
            valueType="number"
          />
        </Form.Item>
        {tag !== 'Modal' ? (
          <Form.Item label="gravity">
            <Select
              allowClear
              placeholder="默认"
              value={form.gravity || undefined}
              options={GRAVITY_OPTIONS.map((opt) => ({
                label: opt.label,
                value: opt.value || undefined,
              }))}
              onChange={(gravity) => patch({ gravity: gravity ?? '' })}
            />
          </Form.Item>
        ) : null}
        {showBorder ? (
          <>
            <Form.Item label="borderRadius 统一圆角">
              <AttrBindField {...bindField('borderRadius')} valueType="number" />
            </Form.Item>
            <div className="quad-grid">
              <Form.Item label="上左">
                <AttrBindField {...bindField('borderTopLeftRadius')} valueType="number" />
              </Form.Item>
              <Form.Item label="上右">
                <AttrBindField {...bindField('borderTopRightRadius')} valueType="number" />
              </Form.Item>
              <Form.Item label="下右">
                <AttrBindField
                  {...bindField('borderBottomRightRadius')}
                  valueType="number"
                />
              </Form.Item>
              <Form.Item label="下左">
                <AttrBindField
                  {...bindField('borderBottomLeftRadius')}
                  valueType="number"
                />
              </Form.Item>
            </div>
            <Form.Item label="borderWidth">
              <AttrBindField {...bindField('borderWidth')} valueType="number" />
            </Form.Item>
            <Form.Item label="borderColor">
              <AttrBindField
                {...bindField('borderColor')}
                placeholder="色值 / 绑定"
                valueType="color"
              />
            </Form.Item>
          </>
        ) : null}
        {showOverflow ? (
          <Form.Item label="overflow 溢出">
            <Select
              allowClear
              placeholder="默认显示"
              value={form.overflow || undefined}
              options={overflowOptionsForTag}
              onChange={(overflow) => patch({ overflow: overflow ?? '' })}
            />
          </Form.Item>
        ) : null}
      </Form>

      {showTextProps ? (
        <>
          <div className="section-title">内容</div>
          <Form layout="vertical" size="small">
            <Form.Item label="text">
              <AttrBindField {...bindField('text')} />
            </Form.Item>
            <Form.Item label="textSize">
              <AttrBindField {...bindField('textSize')} valueType="number" />
            </Form.Item>
            <Form.Item label="textColor">
              <AttrBindField
                {...bindField('textColor')}
                placeholder="色值 / 绑定"
                valueType="color"
              />
            </Form.Item>
          </Form>
        </>
      ) : null}

      {showInputProps ? (
        <>
          <div className="section-title">输入</div>
          <Form layout="vertical" size="small">
            <Form.Item label="value">
              <AttrBindField {...bindField('value')} />
            </Form.Item>
            <Form.Item label="placeholder">
              <AttrBindField {...bindField('placeholder')} />
            </Form.Item>
            <Form.Item label="textSize">
              <AttrBindField {...bindField('textSize')} valueType="number" />
            </Form.Item>
            <Form.Item label="textColor">
              <AttrBindField
                {...bindField('textColor')}
                placeholder="色值 / 绑定"
                valueType="color"
              />
            </Form.Item>
          </Form>
        </>
      ) : null}

      {showIconColor ? (
        <>
          <div className="section-title">图标</div>
          <Form layout="vertical" size="small">
            <Form.Item label="color">
              <AttrBindField
                {...bindField('color')}
                placeholder="色值 / 绑定"
                valueType="color"
              />
            </Form.Item>
          </Form>
        </>
      ) : null}

      {showRotateProps ? (
        <>
          <div className="section-title">旋转</div>
          <Form layout="vertical" size="small">
            <Form.Item label="rotateX（度）">
              <AttrBindField
                {...bindField('rotateX')}
                placeholder="0"
                valueType="number"
              />
            </Form.Item>
            <Form.Item label="rotateY（度）">
              <AttrBindField
                {...bindField('rotateY')}
                placeholder="0"
                valueType="number"
              />
            </Form.Item>
            <Form.Item label="rotateZ（度）">
              <AttrBindField
                {...bindField('rotateZ')}
                placeholder="0"
                valueType="number"
              />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </div>
  )
}
