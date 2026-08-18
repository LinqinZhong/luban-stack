import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import TsCodeEditor, { type TsCodeEditorHandle } from './TsCodeEditor'
import {
  METHOD_PARAM_TYPE_OPTIONS,
  METHOD_RETURN_TYPE_OPTIONS,
  createEmptyMethod,
  dataFieldsToAmbientVars,
  isValidMethodName,
  type MethodParam,
  type MethodReturnType,
  type PageMethod,
} from '../../types/page-method'
import type { DataField } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import type { ComponentRenderMap } from '../../types/component-render'
import {
  buildRefAmbientDeclarations,
  type ComponentMethodsMap,
} from '../../utils/widget-ref'
import './MethodEditDialog.css'

type Draft = {
  name: string
  params: MethodParam[]
  returnType: MethodReturnType
  body: string
  previousName: string
  builtin: boolean
}

const emptyDraft = (): Draft => ({
  name: '',
  params: [],
  returnType: 'void',
  body: '',
  previousName: '',
  builtin: false,
})

export default function MethodEditDialog({
  open,
  onOpenChange,
  method,
  dataFields,
  typeLibrary,
  xml,
  componentMap,
  componentMethodsMap,
  ambientExtra,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  method: PageMethod | null
  dataFields?: DataField[]
  typeLibrary?: DataTypeLibrary | null
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  ambientExtra?: string
  onSave?: (method: PageMethod, previousName?: string) => void
}) {
  const editorRef = useRef<TsCodeEditorHandle | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  const ambientVars = useMemo(
    () =>
      draft.builtin ? [] : dataFieldsToAmbientVars(dataFields, typeLibrary),
    [draft.builtin, dataFields, typeLibrary],
  )

  const mergedAmbientExtra = useMemo(() => {
    if (draft.builtin) return ''
    const refAmbient = buildRefAmbientDeclarations(
      dataFields,
      xml,
      componentMap,
      componentMethodsMap,
    )
    const extra = (ambientExtra ?? '').trim()
    return `${refAmbient}${extra ? `${extra}\n` : ''}`
  }, [
    draft.builtin,
    dataFields,
    xml,
    componentMap,
    componentMethodsMap,
    ambientExtra,
  ])

  const title = draft.builtin
    ? `查看方法 · ${draft.name}`
    : draft.previousName
      ? '编辑方法'
      : '添加方法'

  useEffect(() => {
    if (!open) return
    const source = method ?? createEmptyMethod()
    setDraft({
      name: source.name,
      params: source.params.map((item) => ({ ...item })),
      returnType: source.returnType || 'void',
      body: source.body || '',
      previousName: source.name,
      builtin: Boolean(source.builtin),
    })
  }, [open, method])

  function addParam() {
    setDraft((prev) => ({
      ...prev,
      params: [...prev.params, { name: '', type: 'string' }],
    }))
  }

  function removeParam(index: number) {
    setDraft((prev) => ({
      ...prev,
      params: prev.params.filter((_, i) => i !== index),
    }))
  }

  function handleSave() {
    if (draft.builtin) {
      onOpenChange?.(false)
      return
    }
    const name = draft.name.trim()
    if (!isValidMethodName(name)) {
      ElMessage.error('方法名需以字母或下划线开头，仅含字母、数字、下划线')
      return
    }
    const params = draft.params
      .map((item) => ({
        name: item.name.trim(),
        type: item.type,
      }))
      .filter((item) => item.name)
    const dup = new Set<string>()
    for (const item of params) {
      if (dup.has(item.name)) {
        ElMessage.error(`参数名重复：${item.name}`)
        return
      }
      dup.add(item.name)
    }

    const body = editorRef.current?.getBody?.() ?? draft.body

    onSave?.(
      {
        name,
        params,
        returnType: draft.returnType,
        body,
        builtin: false,
      },
      draft.previousName || undefined,
    )
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={title}
      width={760}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        draft.builtin ? (
          <Button onClick={() => onOpenChange?.(false)}>关闭</Button>
        ) : (
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        )
      }
    >
      <Form layout="vertical">
        <Form.Item label="命名" required>
          <Input
            value={draft.name}
            disabled={draft.builtin}
            placeholder="例如：loadMessages"
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, name: e.target.value }))
            }
          />
        </Form.Item>

        <Form.Item label="入参">
          <div className="param-list">
            {draft.params.map((param, index) => (
              <div key={index} className="param-row">
                <Input
                  value={param.name}
                  disabled={draft.builtin}
                  placeholder="参数名"
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      params: prev.params.map((p, i) =>
                        i === index ? { ...p, name: e.target.value } : p,
                      ),
                    }))
                  }
                />
                <Select
                  value={param.type}
                  disabled={draft.builtin}
                  style={{ width: 140 }}
                  options={METHOD_PARAM_TYPE_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  onChange={(type) =>
                    setDraft((prev) => ({
                      ...prev,
                      params: prev.params.map((p, i) =>
                        i === index ? { ...p, type } : p,
                      ),
                    }))
                  }
                />
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={draft.builtin}
                  onClick={() => removeParam(index)}
                />
              </div>
            ))}
            {!draft.builtin ? (
              <Button type="link" icon={<PlusOutlined />} onClick={addParam}>
                添加参数
              </Button>
            ) : !draft.params.length ? (
              <span className="muted">无参数</span>
            ) : null}
          </div>
        </Form.Item>

        <Form.Item label="返回值类型">
          <Select
            value={draft.returnType}
            disabled={draft.builtin}
            style={{ width: '100%' }}
            options={METHOD_RETURN_TYPE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            onChange={(returnType) =>
              setDraft((prev) => ({ ...prev, returnType }))
            }
          />
        </Form.Item>

        <Form.Item label="引入依赖">
          <Select
            disabled
            mode="multiple"
            placeholder="暂未实现"
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="方法体">
          <p className="hint">
            语法 TypeScript：顶部方法声明只读，只需编写方法体内部代码。数据池字段可按名字直接引用；Modal
            引用
            <code>.show()</code>/<code>.hide()</code>
            ，组件引用为其「暴露方法」。
          </p>
          {open && (
            <TsCodeEditor
              ref={editorRef}
              value={draft.body}
              onChange={(body) => setDraft((prev) => ({ ...prev, body }))}
              functionName={draft.name || 'fn'}
              readonly={draft.builtin}
              params={draft.params}
              returnType={draft.returnType}
              ambientVars={ambientVars}
              ambientExtra={mergedAmbientExtra}
            />
          )}
        </Form.Item>
      </Form>
    </Modal>
  )
}
