import { useEffect, useState } from 'react'
import { Button, Form, Input, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  dataFieldToMethodParamType,
  methodParamToDataFieldType,
  type MethodParam,
  type PageMethod,
} from '../../types/page-method'
import {
  createEmptyComponentEvent,
  createEmptyComponentProp,
  type ComponentConfig,
  type ComponentPropDef,
} from '../../types/component'
import { SIZE_OPTIONS } from '../../utils/xml-node'
import NumericInput from './NumericInput'
import ComponentPropDialog from './ComponentPropDialog'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import type { DataTypeLibrary } from '../../types/data-types'
import { DATA_FIELD_TYPE_OPTIONS } from '../../types/page-data'
import './ComponentMetaPanel.css'

function parseSize(value: string | undefined, fallback: number) {
  if (!value || value === 'wrap_content') return { mode: 'wrap_content', value: fallback }
  if (value === 'match_parent') return { mode: 'match_parent', value: fallback }
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return { mode: 'fixed', value: n }
  if (Number.isFinite(n)) return { mode: 'fixed', value: fallback }
  return { mode: 'wrap_content', value: fallback }
}

function sizeToAttr(mode: string, value: number | string, fallback = 0) {
  if (mode === 'wrap_content' || mode === 'match_parent') return mode
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return String(fallback)
  return String(num)
}

function cloneConfig(config: ComponentConfig): ComponentConfig {
  return {
    name: config.name,
    title: config.title || config.name,
    width: config.width,
    height: config.height,
    props: config.props.map((item) => ({
      ...item,
      required: Boolean(item.required),
    })),
    events: config.events.map((item) => ({
      ...item,
      params: item.params.map((p) => ({ ...p })),
    })),
    exposedMethods: [...config.exposedMethods],
    debugProps: { ...(config.debugProps ?? {}) },
  }
}

export default function ComponentMetaPanel({
  config,
  methods,
  iconOptions,
  typeLibrary,
  onConfigChange,
}: {
  config: ComponentConfig
  methods: PageMethod[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  onConfigChange?: (config: ComponentConfig) => void
}) {
  const [draft, setDraft] = useState<ComponentConfig>(() => cloneConfig(config))
  const [widthMode, setWidthMode] = useState(() => parseSize(config.width, 200))
  const [heightMode, setHeightMode] = useState(() => parseSize(config.height, 80))
  const [propDialogVisible, setPropDialogVisible] = useState(false)
  const [editingPropIndex, setEditingPropIndex] = useState(-1)
  const [editingProp, setEditingProp] = useState<ComponentPropDef | null>(null)

  useEffect(() => {
    setDraft(cloneConfig(config))
    setWidthMode(parseSize(config.width, 200))
    setHeightMode(parseSize(config.height, 80))
  }, [config])

  function commit(
    nextDraft = draft,
    nextWidth = widthMode,
    nextHeight = heightMode,
  ) {
    const width = sizeToAttr(nextWidth.mode, nextWidth.value, 200)
    const height = sizeToAttr(nextHeight.mode, nextHeight.value, 80)
    onConfigChange?.({
      name: nextDraft.name.trim(),
      title: (nextDraft.title || nextDraft.name).trim(),
      width,
      height,
      props: nextDraft.props.map((item) => ({
        ...item,
        name: item.name.trim(),
        required: Boolean(item.required),
      })),
      events: nextDraft.events.map((item) => ({
        name: item.name.trim(),
        params: item.params.map((p) => ({
          ...p,
          name: p.name.trim(),
        })),
      })),
      exposedMethods: [...nextDraft.exposedMethods],
      debugProps: { ...(nextDraft.debugProps ?? config.debugProps ?? {}) },
    })
  }

  function onWidthModeChange(mode: string) {
    let next = { ...widthMode, mode }
    if (mode === 'fixed') {
      const n = Number(next.value)
      if (!Number.isFinite(n) || n <= 0) next = { ...next, value: 200 }
    }
    setWidthMode(next)
    commit(draft, next, heightMode)
  }

  function onHeightModeChange(mode: string) {
    let next = { ...heightMode, mode }
    if (mode === 'fixed') {
      const n = Number(next.value)
      if (!Number.isFinite(n) || n <= 0) next = { ...next, value: 80 }
    }
    setHeightMode(next)
    commit(draft, widthMode, next)
  }

  function openAddProp() {
    setEditingPropIndex(-1)
    setEditingProp(createEmptyComponentProp())
    setPropDialogVisible(true)
  }

  function openEditProp(index: number) {
    setEditingPropIndex(index)
    setEditingProp({ ...draft.props[index] })
    setPropDialogVisible(true)
  }

  function removeProp(index: number) {
    const next = {
      ...draft,
      props: draft.props.filter((_, i) => i !== index),
    }
    setDraft(next)
    commit(next)
  }

  function saveProp(prop: ComponentPropDef) {
    const nextProps = [...draft.props]
    if (editingPropIndex >= 0) {
      nextProps[editingPropIndex] = { ...prop }
    } else {
      nextProps.push({ ...prop })
    }
    const next = { ...draft, props: nextProps }
    setDraft(next)
    commit(next)
  }

  function propExistingNames(): string[] {
    return draft.props
      .map((item, index) => (index === editingPropIndex ? '' : item.name))
      .filter(Boolean)
  }

  function propTypeLabel(type: string): string {
    return DATA_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
  }

  function propSummary(row: ComponentPropDef): string {
    const parts = [propTypeLabel(row.type)]
    if (row.required) parts.push('必填')
    if (row.type === 'api') {
      const n = row.apiParams?.length ?? 0
      parts.push(n ? `${n} 个形参` : '无形参')
      if (
        row.apiReturnType?.typeRef ||
        (row.apiReturnType?.type && row.apiReturnType.type !== 'any')
      ) {
        parts.push('有出参')
      }
      parts.push('props')
    } else if (row.twoWay) {
      parts.push('可更新')
    } else {
      parts.push('props')
    }
    return parts.join(' · ')
  }

  function addEvent() {
    const next = {
      ...draft,
      events: [...draft.events, createEmptyComponentEvent()],
    }
    setDraft(next)
    commit(next)
  }

  function removeEvent(index: number) {
    const next = {
      ...draft,
      events: draft.events.filter((_, i) => i !== index),
    }
    setDraft(next)
    commit(next)
  }

  function addEventParam(eIndex: number) {
    const next = {
      ...draft,
      events: draft.events.map((event, i) =>
        i === eIndex
          ? { ...event, params: [...event.params, { name: '', type: 'any' as const }] }
          : event,
      ),
    }
    setDraft(next)
    commit(next)
  }

  function removeEventParam(eIndex: number, pIndex: number) {
    const next = {
      ...draft,
      events: draft.events.map((event, i) =>
        i === eIndex
          ? { ...event, params: event.params.filter((_, j) => j !== pIndex) }
          : event,
      ),
    }
    setDraft(next)
    commit(next)
  }

  function onEventParamTypeChange(
    eIndex: number,
    pIndex: number,
    payload: TypeSelectPayload,
  ) {
    const fieldType =
      payload.type === 'void' || payload.type === 'generic' ? 'any' : payload.type
    const next = {
      ...draft,
      events: draft.events.map((event, i) => {
        if (i !== eIndex) return event
        return {
          ...event,
          params: event.params.map((param, j) => {
            if (j !== pIndex) return param
            const nextParam: MethodParam = {
              ...param,
              type: dataFieldToMethodParamType(fieldType),
              typeRef: payload.typeRef,
              itemType:
                fieldType === 'array'
                  ? payload.itemType === 'generic'
                    ? 'any'
                    : payload.itemType || 'string'
                  : undefined,
              itemTypeRef: fieldType === 'array' ? payload.itemTypeRef : undefined,
              itemItemType:
                fieldType === 'array' && payload.itemType === 'array'
                  ? payload.itemItemType === 'generic'
                    ? 'any'
                    : payload.itemItemType || 'string'
                  : undefined,
              itemItemTypeRef:
                fieldType === 'array' && payload.itemType === 'array'
                  ? payload.itemItemTypeRef
                  : undefined,
            }
            return nextParam
          }),
        }
      }),
    }
    setDraft(next)
    commit(next)
  }

  const customMethodOptions = methods
    .filter((item) => !item.builtin)
    .map((item) => item.name)

  return (
    <div className="component-meta">
      <div className="panel-header">组件设置</div>
      <div className="panel-body">
        <div className="section-title">基本</div>
        <Form layout="vertical" size="small">
          <Form.Item label="名称">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              onBlur={() => commit()}
            />
          </Form.Item>
          <Form.Item label="标题">
            <Input
              value={draft.title}
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              onBlur={() => commit()}
            />
          </Form.Item>
        </Form>

        <div className="section-title">默认尺寸</div>
        <Form layout="vertical" size="small">
          <Form.Item label="宽度 width">
            <div className="size-row">
              <Select
                value={widthMode.mode}
                options={[...SIZE_OPTIONS]}
                onChange={onWidthModeChange}
              />
              {widthMode.mode === 'fixed' ? (
                <NumericInput
                  value={widthMode.value}
                  onChange={(v) => {
                    const next = { ...widthMode, value: Number(v) || 0 }
                    setWidthMode(next)
                    commit(draft, next, heightMode)
                  }}
                />
              ) : null}
            </div>
          </Form.Item>
          <Form.Item label="高度 height">
            <div className="size-row">
              <Select
                value={heightMode.mode}
                options={[...SIZE_OPTIONS]}
                onChange={onHeightModeChange}
              />
              {heightMode.mode === 'fixed' ? (
                <NumericInput
                  value={heightMode.value}
                  onChange={(v) => {
                    const next = { ...heightMode, value: Number(v) || 0 }
                    setHeightMode(next)
                    commit(draft, widthMode, next)
                  }}
                />
              ) : null}
            </div>
          </Form.Item>
        </Form>

        <div className="section-title">
          <span>参数（Props / Model）</span>
          <Button type="link" icon={<PlusOutlined />} onClick={openAddProp}>
            添加
          </Button>
        </div>
        <p className="hint">
          点击条目编辑。模板中用 <code>{'{$props.字段名}'}</code> 读取。
        </p>
        {!draft.props.length ? <div className="empty">暂无参数</div> : null}
        {draft.props.map((row, index) => (
          <div key={`${row.name}-${index}`} className="prop-item">
            <button type="button" className="prop-main" onClick={() => openEditProp(index)}>
              <span className="prop-name">{row.name || '未命名'}</span>
              <span className="prop-meta">{propSummary(row)}</span>
            </button>
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeProp(index)}
            />
          </div>
        ))}

        <div className="section-title">
          <span>事件方法</span>
          <Button type="link" icon={<PlusOutlined />} onClick={addEvent}>
            添加
          </Button>
        </div>
        <p className="hint">组件对外抛出的事件，父页面可绑定。</p>
        {!draft.events.length ? <div className="empty">暂无事件</div> : null}
        {draft.events.map((event, eIndex) => (
          <div key={eIndex} className="card">
            <div className="card-row">
              <Input
                value={event.name}
                placeholder="事件名，如 onChange"
                onChange={(e) => {
                  const next = {
                    ...draft,
                    events: draft.events.map((item, i) =>
                      i === eIndex ? { ...item, name: e.target.value } : item,
                    ),
                  }
                  setDraft(next)
                }}
                onBlur={() => commit()}
              />
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeEvent(eIndex)}
              />
            </div>
            <div className="params">
              {event.params.map((param, pIndex) => (
                <div key={pIndex} className="param-row">
                  <Input
                    value={param.name}
                    placeholder="参数名"
                    onChange={(e) => {
                      const next = {
                        ...draft,
                        events: draft.events.map((item, i) =>
                          i === eIndex
                            ? {
                                ...item,
                                params: item.params.map((p, j) =>
                                  j === pIndex ? { ...p, name: e.target.value } : p,
                                ),
                              }
                            : item,
                        ),
                      }
                      setDraft(next)
                    }}
                    onBlur={() => commit()}
                  />
                  <DataFieldTypeTreeSelect
                    type={methodParamToDataFieldType(param.type)}
                    typeRef={param.typeRef}
                    itemType={param.itemType}
                    itemTypeRef={param.itemTypeRef}
                    itemItemType={param.itemItemType}
                    itemItemTypeRef={param.itemItemTypeRef}
                    library={typeLibrary}
                    composable
                    size="small"
                    onChange={(payload) =>
                      onEventParamTypeChange(eIndex, pIndex, payload)
                    }
                  />
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeEventParam(eIndex, pIndex)}
                  />
                </div>
              ))}
              <Button type="link" icon={<PlusOutlined />} onClick={() => addEventParam(eIndex)}>
                添加参数
              </Button>
            </div>
          </div>
        ))}

        <div className="section-title">暴露方法</div>
        <p className="hint">从组件方法中多选，供父页面调用。</p>
        <Select
          mode="multiple"
          showSearch
          allowClear
          placeholder="选择要暴露的方法"
          style={{ width: '100%' }}
          value={draft.exposedMethods}
          options={customMethodOptions.map((name) => ({ label: name, value: name }))}
          onChange={(exposedMethods) => {
            const next = { ...draft, exposedMethods }
            setDraft(next)
            commit(next)
          }}
        />
        {!customMethodOptions.length ? (
          <p className="hint">请先在「方法」模式中添加自定义方法。</p>
        ) : null}
      </div>

      <ComponentPropDialog
        open={propDialogVisible}
        onOpenChange={setPropDialogVisible}
        prop={editingProp}
        existingNames={propExistingNames()}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        onSave={saveProp}
      />
    </div>
  )
}
