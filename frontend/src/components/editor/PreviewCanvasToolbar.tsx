import { useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Select, Tooltip } from 'antd'
import {
  HomeFilled,
  RedoOutlined,
  RollbackOutlined,
} from '@ant-design/icons'
import type { ComponentConfig } from '../../types/component'
import type { MethodParam, PageMethod } from '../../types/page-method'
import './PreviewCanvasToolbar.css'

export default function PreviewCanvasToolbar({
  mode,
  canGoBack,
  hasEntryPage,
  config,
  methods,
  onBack,
  onGoEntry,
  onRefresh,
  onInvokeMethod,
}: {
  mode: 'page' | 'component'
  canGoBack?: boolean
  hasEntryPage?: boolean
  config?: ComponentConfig | null
  methods?: PageMethod[]
  onBack?: () => void
  onGoEntry?: () => void
  onRefresh?: () => void
  onInvokeMethod?: (payload: { name: string; args: unknown[] }) => void
}) {
  const exposedMethods = useMemo(() => {
    const names = config?.exposedMethods ?? []
    const list = methods ?? []
    return names
      .map((name) => {
        const method = list.find((item) => item.name === name && !item.builtin)
        return {
          name,
          params: method?.params ?? [],
          hasBody: Boolean(method?.body?.trim()),
        }
      })
      .filter((item) => item.name.trim())
  }, [config?.exposedMethods, methods])

  const [invokeVisible, setInvokeVisible] = useState(false)
  const [invokeName, setInvokeName] = useState('')
  const [invokeParams, setInvokeParams] = useState<MethodParam[]>([])
  const [invokeDraft, setInvokeDraft] = useState<Record<string, string>>({})

  function openInvoke(method: {
    name: string
    params: MethodParam[]
    hasBody: boolean
  }) {
    if (!method.hasBody) return
    if (!method.params.length) {
      onInvokeMethod?.({ name: method.name, args: [] })
      return
    }
    setInvokeName(method.name)
    setInvokeParams(method.params)
    const next: Record<string, string> = {}
    for (const param of method.params) {
      const key = param.name.trim()
      if (!key) continue
      next[key] =
        param.type === 'boolean'
          ? 'false'
          : param.type === 'number'
            ? '0'
            : param.type === 'object' || param.type === 'array'
              ? param.type === 'array'
                ? '[]'
                : '{}'
              : ''
    }
    setInvokeDraft(next)
    setInvokeVisible(true)
  }

  function parseParamValue(param: MethodParam, raw: string): unknown {
    const text = raw.trim()
    if (param.type === 'boolean') {
      const s = text.toLowerCase()
      return s === 'true' || s === '1'
    }
    if (param.type === 'number') {
      const n = Number(text)
      return Number.isFinite(n) ? n : 0
    }
    if (param.type === 'object' || param.type === 'array' || param.type === 'any') {
      if (!text) return param.type === 'array' ? [] : {}
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    return raw
  }

  function confirmInvoke() {
    const args = invokeParams.map((param) =>
      parseParamValue(param, invokeDraft[param.name.trim()] ?? ''),
    )
    onInvokeMethod?.({ name: invokeName, args })
    setInvokeVisible(false)
  }

  return (
    <div
      className="preview-canvas-toolbar"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {mode === 'page' ? (
        <div className="page-actions">
          <Tooltip title="返回" placement="left">
            <button
              type="button"
              className="circle-btn"
              disabled={!canGoBack}
              onClick={() => onBack?.()}
            >
              <RollbackOutlined style={{ fontSize: 18 }} />
            </button>
          </Tooltip>
          <Tooltip title="回到入口页" placement="left">
            <button
              type="button"
              className="circle-btn"
              disabled={!hasEntryPage}
              onClick={() => onGoEntry?.()}
            >
              <HomeFilled style={{ fontSize: 18 }} />
            </button>
          </Tooltip>
          <Tooltip title="刷新" placement="left">
            <button
              type="button"
              className="circle-btn is-primary"
              onClick={() => onRefresh?.()}
            >
              <RedoOutlined style={{ fontSize: 18 }} />
            </button>
          </Tooltip>
        </div>
      ) : exposedMethods.length ? (
        <div className="method-actions">
          {exposedMethods.map((method) => (
            <Tooltip
              key={method.name}
              title={
                method.hasBody
                  ? method.params.length
                    ? `${method.name}（需填入参）`
                    : method.name
                  : '方法体为空'
              }
              placement="left"
            >
              <button
                type="button"
                className="method-btn"
                disabled={!method.hasBody}
                onClick={() => openInvoke(method)}
              >
                {method.name}
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}

      <Modal
        open={invokeVisible}
        title={`执行 ${invokeName}`}
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        footer={
          <Button type="primary" onClick={confirmInvoke}>
            执行
          </Button>
        }
        onCancel={() => setInvokeVisible(false)}
      >
        <Form labelCol={{ style: { width: 88 } }}>
          {invokeParams.map((param) => (
            <Form.Item key={param.name} label={param.name}>
              {param.type === 'boolean' ? (
                <Select
                  value={invokeDraft[param.name]}
                  style={{ width: '100%' }}
                  options={[
                    { label: 'true', value: 'true' },
                    { label: 'false', value: 'false' },
                  ]}
                  onChange={(v) =>
                    setInvokeDraft((prev) => ({ ...prev, [param.name]: v }))
                  }
                />
              ) : (
                <Input
                  value={invokeDraft[param.name]}
                  placeholder={param.type}
                  onChange={(e) =>
                    setInvokeDraft((prev) => ({
                      ...prev,
                      [param.name]: e.target.value,
                    }))
                  }
                />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  )
}
