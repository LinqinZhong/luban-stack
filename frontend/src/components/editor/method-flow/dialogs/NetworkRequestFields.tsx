import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Select } from 'antd'
import type { MethodParam } from '../../../../types/page-method'
import {
  NETWORK_HTTP_METHODS,
  NETWORK_MEDIA_CUSTOM,
  NETWORK_MEDIA_TYPE_OPTIONS,
  createEmptyNetworkParamRow,
  isFormUrlEncoded,
  usesRequestBody,
  type NetworkConstantType,
  type NetworkParamRow,
  type NetworkRequestConfig,
} from './network-request'
import './NetworkRequestFields.css'

const CONSTANT_TYPES: Array<{ value: NetworkConstantType; label: string }> = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
]

function ParamRows({
  rows,
  listKey,
  onUpdate,
  onRemove,
  onAdd,
  addLabel,
  ambientOptions,
}: {
  rows: NetworkParamRow[]
  listKey: 'headers' | 'queryParams' | 'formParams'
  onUpdate: (
    key: 'headers' | 'queryParams' | 'formParams',
    index: number,
    patchRow: Partial<NetworkParamRow>,
  ) => void
  onRemove: (
    key: 'headers' | 'queryParams' | 'formParams',
    index: number,
  ) => void
  onAdd: (key: 'headers' | 'queryParams' | 'formParams') => void
  addLabel: string
  ambientOptions: Array<{ value: string; label: string }>
}) {
  return (
    <div className="param-list">
      {rows.map((row, idx) => (
        <div key={`${listKey}-${idx}`} className="param-row">
          <Input
            className="param-name"
            value={row.name}
            placeholder="参数名"
            onChange={(e) => onUpdate(listKey, idx, { name: e.target.value })}
          />
          <Select
            className="param-kind"
            value={row.valueKind}
            options={[
              { label: '变量', value: 'variable' },
              { label: '常量', value: 'constant' },
            ]}
            onChange={(value) =>
              onUpdate(listKey, idx, { valueKind: value, value: '' })
            }
          />
          {row.valueKind === 'variable' ? (
            <Select
              className="param-value"
              value={row.value || undefined}
              showSearch
              allowClear
              placeholder="选择变量"
              options={ambientOptions}
              onChange={(value) =>
                onUpdate(listKey, idx, { value: value ?? '' })
              }
            />
          ) : (
            <div className="param-const">
              <Select
                className="const-type"
                value={row.constantType || 'string'}
                options={CONSTANT_TYPES}
                onChange={(value) =>
                  onUpdate(listKey, idx, { constantType: value })
                }
              />
              {(row.constantType || 'string') === 'boolean' ? (
                <Select
                  className="const-value"
                  value={row.value || undefined}
                  placeholder="值"
                  options={[
                    { label: 'true', value: 'true' },
                    { label: 'false', value: 'false' },
                  ]}
                  onChange={(value) =>
                    onUpdate(listKey, idx, { value: value ?? '' })
                  }
                />
              ) : (
                <Input
                  className="const-value"
                  value={row.value}
                  placeholder={
                    (row.constantType || 'string') === 'number' ? '数字' : '值'
                  }
                  onChange={(e) =>
                    onUpdate(listKey, idx, { value: e.target.value })
                  }
                />
              )}
            </div>
          )}
          <Button type="text" danger onClick={() => onRemove(listKey, idx)}>
            删
          </Button>
        </div>
      ))}
      <Button onClick={() => onAdd(listKey)}>{addLabel}</Button>
    </div>
  )
}

export default function NetworkRequestFields({
  value,
  onChange,
  ambientVars,
}: {
  value: NetworkRequestConfig
  onChange?: (value: NetworkRequestConfig) => void
  ambientVars: MethodParam[]
}) {
  const [mediaPreset, setMediaPreset] = useState('application/json')
  const [customMedia, setCustomMedia] = useState('')

  useEffect(() => {
    const mt = value.mediaType
    const known = NETWORK_MEDIA_TYPE_OPTIONS.some(
      (o) => o.value !== NETWORK_MEDIA_CUSTOM && o.value === mt,
    )
    if (known) {
      setMediaPreset(mt)
      setCustomMedia('')
    } else if (mt.trim()) {
      setMediaPreset(NETWORK_MEDIA_CUSTOM)
      setCustomMedia(
        mt.startsWith('application/')
          ? mt.slice('application/'.length)
          : mt,
      )
    } else {
      setMediaPreset('application/json')
      setCustomMedia('')
    }
  }, [value.mediaType])

  function patch(partial: Partial<NetworkRequestConfig>) {
    onChange?.({ ...value, ...partial })
  }

  function onMediaPresetChange(preset: string) {
    setMediaPreset(preset)
    if (preset === NETWORK_MEDIA_CUSTOM) {
      const suffix = customMedia.trim() || ''
      patch({
        mediaType: suffix ? `application/${suffix}` : 'application/',
      })
      return
    }
    patch({ mediaType: preset })
  }

  function onCustomMediaInput(suffix: string) {
    setCustomMedia(suffix)
    patch({ mediaType: `application/${suffix.trim()}` })
  }

  const showFormParams = isFormUrlEncoded(value.mediaType)
  const showBodyVar = usesRequestBody(value.mediaType)

  const ambientOptions = useMemo(
    () =>
      ambientVars
        .map((v) => v.name.trim())
        .filter(Boolean)
        .map((name) => ({ value: name, label: name })),
    [ambientVars],
  )

  function updateRow(
    key: 'headers' | 'queryParams' | 'formParams',
    index: number,
    patchRow: Partial<NetworkParamRow>,
  ) {
    const list = value[key].map((r, i) =>
      i === index ? { ...r, ...patchRow } : r,
    )
    patch({ [key]: list })
  }

  function addRow(key: 'headers' | 'queryParams' | 'formParams') {
    patch({
      [key]: [...value[key], createEmptyNetworkParamRow()],
    })
  }

  function removeRow(
    key: 'headers' | 'queryParams' | 'formParams',
    index: number,
  ) {
    patch({
      [key]: value[key].filter((_, i) => i !== index),
    })
  }

  return (
    <div className="network-request-fields">
      <Form.Item label="API地址" required>
        <Input
          value={value.apiUrl}
          placeholder="如 https://api.example.com/v1/list 或含变量表达式"
          onChange={(e) => patch({ apiUrl: e.target.value })}
        />
      </Form.Item>

      <Form.Item label="请求方法" required>
        <Select
          value={value.httpMethod}
          style={{ width: '100%' }}
          options={NETWORK_HTTP_METHODS.map((m) => ({ label: m, value: m }))}
          onChange={(httpMethod) => patch({ httpMethod })}
        />
      </Form.Item>

      <Form.Item label="请求头">
        <ParamRows
          rows={value.headers}
          listKey="headers"
          onUpdate={updateRow}
          onRemove={removeRow}
          onAdd={addRow}
          addLabel="添加请求头"
          ambientOptions={ambientOptions}
        />
      </Form.Item>

      <Form.Item label="查询参数">
        <ParamRows
          rows={value.queryParams}
          listKey="queryParams"
          onUpdate={updateRow}
          onRemove={removeRow}
          onAdd={addRow}
          addLabel="添加查询参数"
          ambientOptions={ambientOptions}
        />
      </Form.Item>

      <Form.Item label="媒体类型" required>
        <div className="media-block">
          <Select
            value={mediaPreset}
            style={{ width: '100%' }}
            options={NETWORK_MEDIA_TYPE_OPTIONS}
            onChange={onMediaPresetChange}
          />
          {mediaPreset === NETWORK_MEDIA_CUSTOM ? (
            <Input
              value={customMedia}
              placeholder="如 soap+xml（将拼为 application/…）"
              addonBefore="application/"
              onChange={(e) => onCustomMediaInput(e.target.value)}
            />
          ) : null}
        </div>
      </Form.Item>

      {showFormParams ? (
        <Form.Item label="表单参数">
          <ParamRows
            rows={value.formParams}
            listKey="formParams"
            onUpdate={updateRow}
            onRemove={removeRow}
            onAdd={addRow}
            addLabel="添加表单参数"
            ambientOptions={ambientOptions}
          />
        </Form.Item>
      ) : null}

      {showBodyVar ? (
        <Form.Item label="请求体">
          <Select
            value={value.bodyVarName || undefined}
            showSearch
            allowClear
            placeholder="选择已有变量"
            style={{ width: '100%' }}
            options={ambientOptions}
            onChange={(bodyVarName) => patch({ bodyVarName: bodyVarName || '' })}
          />
        </Form.Item>
      ) : null}
    </div>
  )
}
