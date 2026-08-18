import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import type {
  DataMethodOperation,
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader'
import FlowPrintField from '../FlowPrintField'
import {
  createEmptyOutputNodeForm,
  type OutputNodeForm,
} from './output-node'
import './OutputNodeDialog.css'

export type { OutputNodeForm } from './output-node'

const WRITE_OPERATIONS = new Set<DataMethodOperation>([
  'insert',
  'batchInsert',
  'delete',
  'update',
  'custom',
])

const OPERATION_LABEL: Partial<Record<DataMethodOperation, string>> = {
  insert: '插入',
  batchInsert: '批量插入',
  delete: '删除',
  update: '修改',
  custom: '自定义',
}

export default function OutputNodeDialog({
  open,
  onOpenChange,
  form,
  dataProcessors,
  reservedNames,
  ambientVars,
  typeLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: OutputNodeForm
  dataProcessors: ServiceProcessor[]
  reservedNames: string[]
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  onSave?: (form: OutputNodeForm) => void
}) {
  const [draft, setDraft] = useState<OutputNodeForm>(createEmptyOutputNodeForm())

  useEffect(() => {
    if (!open) return
    setDraft(
      createEmptyOutputNodeForm({
        ...form,
        paramBindings: { ...(form.paramBindings ?? {}) },
      }),
    )
  }, [open, form])

  const methodOptions = useMemo(() => {
    const opts: Array<{
      value: string
      label: string
      processorId: string
      methodId: string
    }> = []
    for (const proc of dataProcessors) {
      for (const m of proc.methods) {
        const op = m.dataConfig?.operation
        const isHttp = m.dataConfig?.source === 'http'
        if (!isHttp && (!op || !WRITE_OPERATIONS.has(op))) continue
        const name = m.name.trim() || m.id
        const opLabel = isHttp ? '外部接口' : OPERATION_LABEL[op!] || op
        opts.push({
          value: `${proc.id}::${m.id}`,
          label: `${proc.name || proc.id}.${name}（${opLabel}）`,
          processorId: proc.id,
          methodId: m.id,
        })
      }
    }
    return opts
  }, [dataProcessors])

  const selectedMethod = useMemo(() => {
    for (const proc of dataProcessors) {
      if (proc.id !== draft.dataProcessorId) continue
      return proc.methods.find((m) => m.id === draft.dataMethodId) ?? null
    }
    return null
  }, [dataProcessors, draft.dataProcessorId, draft.dataMethodId])

  const methodParams = useMemo(
    (): ProcessorMethodParam[] =>
      (selectedMethod?.params ?? []).filter((p) => p.name.trim()),
    [selectedMethod],
  )

  function syncParamBindings(
    params: ProcessorMethodParam[],
    current: Record<string, string>,
  ): Record<string, string> {
    const next: Record<string, string> = {}
    for (const p of params) {
      const name = p.name.trim()
      if (!name) continue
      next[name] = current[name] ?? ''
    }
    return next
  }

  const selectedMethodKey =
    draft.dataProcessorId && draft.dataMethodId
      ? `${draft.dataProcessorId}::${draft.dataMethodId}`
      : ''

  function setSelectedMethodKey(key: string | null) {
    const opt = methodOptions.find((o) => o.value === key)
    if (!opt) {
      setDraft((d) => ({
        ...d,
        dataProcessorId: '',
        dataMethodId: '',
        methodLabel: '',
        paramBindings: {},
      }))
      return
    }
    const method = dataProcessors
      .find((p) => p.id === opt.processorId)
      ?.methods.find((m) => m.id === opt.methodId)
    setDraft((d) => ({
      ...d,
      dataProcessorId: opt.processorId,
      dataMethodId: opt.methodId,
      methodLabel: opt.label,
      paramBindings: syncParamBindings(method?.params ?? [], d.paramBindings),
      description: d.description.trim() ? d.description : opt.label,
    }))
  }

  useEffect(() => {
    if (!methodParams.length && !Object.keys(draft.paramBindings).length) return
    const next = syncParamBindings(methodParams, draft.paramBindings)
    const same =
      Object.keys(next).length === Object.keys(draft.paramBindings).length &&
      Object.keys(next).every((k) => next[k] === draft.paramBindings[k])
    if (same) return
    setDraft((d) => ({ ...d, paramBindings: next }))
  }, [methodParams])

  const methodError =
    draft.dataProcessorId && draft.dataMethodId
      ? ''
      : '请选择数据层写入方法（插入 / 删除 / 修改等）或外部接口'

  const bindingError = useMemo(() => {
    for (const p of methodParams) {
      const name = p.name.trim()
      if (!name) continue
      if (!(draft.paramBindings[name] ?? '').trim()) {
        return `请绑定入参「${name}」`
      }
    }
    return ''
  }, [methodParams, draft.paramBindings])

  const resultVarError = useMemo(() => {
    const name = draft.resultVarName.trim()
    if (!name) return ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return '变量名须为合法标识符'
    }
    if (reservedNames.includes(name)) {
      return '变量名与已有名称冲突'
    }
    return ''
  }, [draft.resultVarName, reservedNames])

  function paramTypeLabel(p: ProcessorMethodParam): string {
    return processorTypeExprToTs(p.typeExpr, typeLibrary)
  }

  const canSave = !methodError && !bindingError && !resultVarError

  function handleSave() {
    if (!canSave) return
    const paramBindings: Record<string, string> = {}
    for (const p of methodParams) {
      const name = p.name.trim()
      if (!name) continue
      paramBindings[name] = (draft.paramBindings[name] ?? '').trim()
    }
    onSave?.({
      ...createEmptyOutputNodeForm(),
      channel: 'local',
      dataProcessorId: draft.dataProcessorId,
      dataMethodId: draft.dataMethodId,
      methodLabel: draft.methodLabel,
      paramBindings,
      resultVarName: draft.resultVarName.trim(),
      description: draft.description.trim(),
      printExpr: draft.printExpr.trim(),
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑输出节点"
      width={560}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" size="small" disabled={!canSave} onClick={handleSave}>
          确定
        </Button>
      }
    >
      <Form
        className="flow-node-form"
        size="small"
        labelAlign="right"
        labelCol={{ flex: '110px' }}
        wrapperCol={{ flex: 1 }}
      >
        <Form.Item
          label="数据层方法"
          required
          validateStatus={methodError ? 'error' : undefined}
          help={methodError || undefined}
        >
          <Select
            value={selectedMethodKey || undefined}
            size="small"
            showSearch
            allowClear
            placeholder="选择插入 / 删除 / 修改等方法或外部接口"
            style={{ width: '100%' }}
            options={methodOptions.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            onChange={(key) => setSelectedMethodKey(key ?? null)}
          />
          {!methodOptions.length ? (
            <p className="hint">
              暂无写入类数据层方法或外部接口，请先在数据层配置插入、删除、修改或 HTTP 接口方法
            </p>
          ) : null}
        </Form.Item>

        {methodParams.length ? (
          <Form.Item
            label="绑定入参"
            required
            validateStatus={bindingError ? 'error' : undefined}
            help={bindingError || undefined}
          >
            <div className="param-bindings">
              {methodParams.map((p) => (
                <div key={p.id} className="param-row">
                  <span
                    className="param-name"
                    title={`${p.remark || p.name} · ${paramTypeLabel(p)}`}
                  >
                    {p.name}
                    <em className="param-type">{paramTypeLabel(p)}</em>
                  </span>
                  <TypedBindingCascader
                    className="param-bind"
                    value={draft.paramBindings[p.name] ?? ''}
                    onChange={(expr) =>
                      setDraft((d) => ({
                        ...d,
                        paramBindings: { ...d.paramBindings, [p.name]: expr },
                      }))
                    }
                    ambientVars={ambientVars}
                    targetType={p.typeExpr}
                    typeLibrary={typeLibrary}
                  />
                </div>
              ))}
            </div>
          </Form.Item>
        ) : selectedMethodKey ? (
          <Form.Item label="绑定入参">
            <span className="hint-inline">该方法无入参</span>
          </Form.Item>
        ) : null}

        <Form.Item
          label="结果变量"
          validateStatus={resultVarError ? 'error' : undefined}
          help={resultVarError || undefined}
        >
          <Input
            value={draft.resultVarName}
            size="small"
            placeholder="可选，如 affected / insertId"
            maxLength={64}
            allowClear
            onChange={(e) =>
              setDraft((d) => ({ ...d, resultVarName: e.target.value }))
            }
          />
        </Form.Item>

        <Form.Item label="说明">
          <Input
            value={draft.description}
            size="small"
            maxLength={80}
            showCount
            placeholder="显示在流程节点上"
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </Form.Item>
        <Form.Item label="打印">
          <FlowPrintField
            value={draft.printExpr}
            onChange={(printExpr) => setDraft((d) => ({ ...d, printExpr }))}
            ambientNames={ambientVars.map((v) => v.name).filter(Boolean)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
