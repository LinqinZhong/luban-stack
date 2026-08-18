import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, Select, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  createEmptyServiceApiParam,
  SERVICE_API_PARAM_LOCATION_OPTIONS,
  type ServiceApiParam,
  type ServiceApiParamLocation,
} from '../../types/backend-services'
import type { DataFieldType } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import './ServiceApiParamsDialog.css'

export default function ServiceApiParamsDialog({
  open,
  onOpenChange,
  inputs,
  typeLibrary,
  typeOptions,
  canSyncFromMethod,
  onSave,
  onSyncFromMethod,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  inputs: ServiceApiParam[]
  typeLibrary?: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  canSyncFromMethod?: boolean
  onSave?: (inputs: ServiceApiParam[]) => void
  onSyncFromMethod?: () => void
}) {
  const [draft, setDraft] = useState<ServiceApiParam[]>([])
  const [genericVisible, setGenericVisible] = useState(false)
  const [genericIndex, setGenericIndex] = useState(-1)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setDraft(
      inputs.map((p) => ({
        ...p,
        genericArgs: { ...(p.genericArgs ?? {}) },
      })),
    )
  }, [open, inputs])

  function typeDefById(id: string) {
    if (!id) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === id)
      if (hit) return hit
    }
    return null
  }

  function genericNamesOf(typeRef: string): string[] {
    return (typeDefById(typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  function addInput() {
    setDraft((prev) => [
      ...prev,
      createEmptyServiceApiParam({
        varName: `arg${prev.length + 1}`,
        location: 'query',
      }),
    ])
  }

  function updateInput(index: number, patch: Partial<ServiceApiParam>) {
    setDraft((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function removeInput(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  function handleInputTypeChange(index: number, payload: TypeSelectPayload) {
    if (payload.type === 'void' || payload.type === 'generic') return
    const row = draft[index]
    const prevRef = row?.typeRef ?? ''
    const typeRef = payload.typeRef ?? ''
    const type =
      typeRef || payload.type === 'json' || payload.type === 'array'
        ? payload.type === 'array'
          ? 'json'
          : typeRef
            ? 'json'
            : payload.type
        : payload.type
    const nextGenericArgs: Record<string, string> =
      typeRef && typeRef === prevRef ? { ...(row?.genericArgs ?? {}) } : {}
    if (typeRef && typeRef !== prevRef) {
      for (const n of genericNamesOf(typeRef)) nextGenericArgs[n] = ''
    }
    updateInput(index, {
      type: typeRef ? 'json' : type,
      typeRef,
      genericArgs: nextGenericArgs,
    })
    if (genericNamesOf(typeRef).length) {
      openGenerics(index, typeRef, nextGenericArgs)
    }
  }

  function openGenerics(
    index: number,
    typeRef?: string,
    args?: Record<string, string>,
  ) {
    const row = draft[index]
    const ref = typeRef ?? row?.typeRef ?? ''
    const names = genericNamesOf(ref)
    if (!names.length) return
    setGenericIndex(index)
    setGenericNames(names)
    setGenericTypeName(typeDefById(ref)?.name ?? '')
    setGenericArgs({ ...(args ?? row?.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function handleGenericSave(args: Record<string, string>) {
    if (genericIndex < 0) return
    updateInput(genericIndex, { genericArgs: { ...args } })
    setGenericIndex(-1)
    setGenericVisible(false)
  }

  function handleSave() {
    onSave?.(
      draft.map((p) => ({
        ...p,
        varName: p.varName.trim(),
        remark: p.remark.trim(),
        type: p.typeRef ? 'json' : p.type.trim() || 'string',
        typeRef: p.typeRef.trim(),
        genericArgs: { ...(p.genericArgs ?? {}) },
      })),
    )
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑入参"
      width={760}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" onClick={handleSave}>
          确定
        </Button>
      }
    >
      <div className="params-head">
        <span className="hint">
          配置 API 入参（变量名、来源、类型）；保存后可在「入参绑定」中映射到业务方法。
        </span>
        <div className="params-actions">
          {canSyncFromMethod ? (
            <Button type="link" onClick={() => onSyncFromMethod?.()}>
              从方法同步
            </Button>
          ) : null}
          <Button type="link" icon={<PlusOutlined />} onClick={addInput}>
            添加
          </Button>
        </div>
      </div>
      <Table
        dataSource={draft}
        rowKey={(row) => row.id || row.varName}
        pagination={false}
        bordered
        size="small"
        locale={{ emptyText: '暂无入参，点击添加或从方法同步' }}
        columns={[
          {
            title: '变量名',
            minWidth: 110,
            render: (_, row, index) => (
              <Input
                value={row.varName}
                placeholder="变量名"
                size="small"
                onChange={(e) =>
                  updateInput(index, { varName: e.target.value })
                }
              />
            ),
          },
          {
            title: '来源',
            width: 120,
            render: (_, row, index) => (
              <Select
                value={row.location}
                size="small"
                style={{ width: '100%' }}
                options={SERVICE_API_PARAM_LOCATION_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={(location: ServiceApiParamLocation) =>
                  updateInput(index, { location })
                }
              />
            ),
          },
          {
            title: '类型',
            minWidth: 160,
            render: (_, row, index) => (
              <div className="type-cell">
                <DataFieldTypeTreeSelect
                  className="type-select"
                  type={(row.type || 'string') as DataFieldType}
                  typeRef={row.typeRef}
                  library={typeLibrary}
                  size="small"
                  composable
                  excludeTypes={['api', 'icon', 'color', 'ref', 'resource']}
                  onChange={(p) => handleInputTypeChange(index, p)}
                />
                {genericNamesOf(row.typeRef).length ? (
                  <Button type="link" size="small" onClick={() => openGenerics(index)}>
                    泛型
                  </Button>
                ) : null}
              </div>
            ),
          },
          {
            title: '必传',
            width: 64,
            align: 'center',
            render: (_, row, index) => (
              <Checkbox
                checked={row.required}
                onChange={(e) =>
                  updateInput(index, { required: e.target.checked })
                }
              />
            ),
          },
          {
            title: '说明',
            minWidth: 100,
            render: (_, row, index) => (
              <Input
                value={row.remark}
                placeholder="可选"
                size="small"
                onChange={(e) =>
                  updateInput(index, { remark: e.target.value })
                }
              />
            ),
          },
          {
            title: '',
            width: 56,
            align: 'center',
            render: (_, __, index) => (
              <Button
                type="link"
                danger
                size="small"
                onClick={() => removeInput(index)}
              >
                删除
              </Button>
            ),
          },
        ]}
      />

      <TypeGenericArgsDialog
        open={genericVisible}
        onOpenChange={setGenericVisible}
        typeName={genericTypeName}
        genericNames={genericNames}
        args={genericArgs}
        typeOptions={typeOptions}
        onSave={handleGenericSave}
      />
    </Modal>
  )
}
