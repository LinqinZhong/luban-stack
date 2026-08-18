import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Switch, Table } from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import TypeExprEditor from './TypeExprEditor'
import {
  cloneDataTypeDef,
  createEmptyClearedTypeExpr,
  createEmptyEnumMember,
  createEmptyGenericParam,
  createEmptyInterfaceField,
  formatTypeExprPreview,
  isTypeExprCleared,
  isValidTypeName,
  type DataTypeDef,
  type DataTypeLibrary,
  type TypeAtom,
  type TypeExpr,
  type TypeGenericParam,
} from '../../types/data-types'
import './TypeConfigDialog.css'

export default function TypeConfigDialog({
  open,
  onOpenChange,
  typeDef,
  library,
  namedOptions,
  readonly,
  onSave,
}: {
  open: boolean
  onOpenChange: (visible: boolean) => void
  typeDef: DataTypeDef | null
  library?: DataTypeLibrary | null
  namedOptions: Array<{ id: string; label: string }>
  readonly?: boolean
  onSave?: (def: DataTypeDef) => void
}) {
  const [draft, setDraft] = useState<DataTypeDef | null>(null)
  const [showFieldErrors, setShowFieldErrors] = useState(false)
  const [genericDialogVisible, setGenericDialogVisible] = useState(false)
  const [genericIndex, setGenericIndex] = useState(-1)
  const [genericDraft, setGenericDraft] = useState<TypeGenericParam | null>(
    null,
  )

  useEffect(() => {
    if (!open || !typeDef) {
      setDraft(null)
      setShowFieldErrors(false)
      setGenericDialogVisible(false)
      return
    }
    const next = cloneDataTypeDef(typeDef)
    if (next.kind === 'interface' && !next.fields.length) {
      next.fields = [createEmptyInterfaceField()]
    }
    if (next.kind === 'enum' && !next.enumMembers.length) {
      next.enumMembers = [createEmptyEnumMember()]
    }
    setDraft(next)
    setShowFieldErrors(false)
  }, [open, typeDef])

  const title = useMemo(() => {
    if (!draft) return readonly ? '查看类型' : '配置类型'
    const verb = readonly ? '查看' : '配置'
    if (draft.kind === 'interface')
      return `${verb}对象 · ${draft.name || '未命名'}`
    if (draft.kind === 'enum') return `${verb}枚举 · ${draft.name || '未命名'}`
    return readonly ? '查看类型' : '配置类型'
  }, [draft, readonly])

  const genericNames = (draft?.generics ?? [])
    .map((g) => g.name)
    .filter(Boolean)

  const excludeNamedIds = draft?.id ? [draft.id] : []

  function namedLookup(id: string): string {
    return namedOptions.find((o) => o.id === id)?.label || id
  }

  function genericSummary(g: TypeGenericParam): string {
    const parts: string[] = []
    if (g.constraint) {
      parts.push(`extends ${formatTypeExprPreview(g.constraint, namedLookup)}`)
    }
    if (g.default) {
      parts.push(`= ${formatTypeExprPreview(g.default, namedLookup)}`)
    }
    return parts.join(' ') || '无约束'
  }

  function close() {
    onOpenChange(false)
  }

  function fieldNameError(index: number): string {
    if (!draft || draft.kind !== 'interface') return ''
    const name = draft.fields[index]?.name.trim() ?? ''
    if (!name) return '必填'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return '不合法'
    const dup = draft.fields.some(
      (f, i) => i !== index && f.name.trim() === name,
    )
    if (dup) return '重复'
    return ''
  }

  function save() {
    if (!draft || readonly) return
    if (draft.kind === 'interface') {
      setShowFieldErrors(true)

      if (!draft.fields.length) {
        ElMessage.error('请至少添加一个字段')
        return
      }

      const genericNameSet = new Set<string>()
      for (const g of draft.generics) {
        const name = g.name.trim()
        if (!name) {
          ElMessage.error('泛型参数名不能为空')
          return
        }
        if (!isValidTypeName(name)) {
          ElMessage.error(`泛型参数名不合法：${name}`)
          return
        }
        if (genericNameSet.has(name)) {
          ElMessage.error(`泛型参数名重复：${name}`)
          return
        }
        genericNameSet.add(name)
      }

      const fieldNames = new Set<string>()
      const nextFields = draft.fields.map((f) => ({ ...f }))
      for (let i = 0; i < nextFields.length; i++) {
        const f = nextFields[i]!
        const name = f.name.trim()
        if (!name) {
          ElMessage.error(`第 ${i + 1} 个字段名不能为空`)
          return
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          ElMessage.error(`字段名不合法：${name}`)
          return
        }
        if (fieldNames.has(name)) {
          ElMessage.error(`字段名重复：${name}`)
          return
        }
        fieldNames.add(name)
        f.name = name
        if (isTypeExprCleared(f.type)) {
          ElMessage.error(`字段「${name}」的类型不能为空`)
          return
        }
      }
      draft.fields = nextFields
    }
    if (draft.kind === 'enum') {
      if (!draft.enumMembers.length) {
        ElMessage.error('请至少添加一个枚举成员')
        return
      }
      const memberNames = new Set<string>()
      const nextMembers = draft.enumMembers.map((m) => ({ ...m }))
      for (let i = 0; i < nextMembers.length; i++) {
        const m = nextMembers[i]!
        const name = m.name.trim()
        if (!name) {
          ElMessage.error(`第 ${i + 1} 个枚举成员名不能为空`)
          return
        }
        if (!isValidTypeName(name)) {
          ElMessage.error(`枚举成员名不合法：${name}`)
          return
        }
        if (memberNames.has(name)) {
          ElMessage.error(`枚举成员名重复：${name}`)
          return
        }
        memberNames.add(name)
        m.name = name
      }
      draft.enumMembers = nextMembers
    }
    setShowFieldErrors(false)
    onSave?.(cloneDataTypeDef(draft))
    close()
  }

  function fieldTypeError(index: number): boolean {
    if (!showFieldErrors || !draft) return false
    const field = draft.fields[index]
    return Boolean(field && isTypeExprCleared(field.type))
  }

  function handleFieldTypeChange(index: number, value: TypeExpr | null) {
    if (!draft) return
    const next = value ?? createEmptyClearedTypeExpr()
    setDraft({
      ...draft,
      fields: draft.fields.map((f, i) =>
        i === index ? { ...f, type: next } : f,
      ),
    })
  }

  function scrubStaleGenericRefs(source: DataTypeDef): DataTypeDef {
    const names = new Set(
      source.generics.map((g) => g.name.trim()).filter(Boolean),
    )

    function scrubExpr(expr: TypeExpr | null): TypeExpr | null {
      if (!expr) return null
      const atom = expr.intersections[0]?.alternatives[0]
      if (!atom) return expr
      if (atom.kind === 'array') {
        const itemScrubbed = scrubExpr({
          intersections: [{ alternatives: [atom.item ?? { kind: 'any' }] }],
        })
        if (!itemScrubbed) return null
        const item =
          itemScrubbed.intersections[0]?.alternatives[0] ?? {
            kind: 'any' as const,
          }
        return {
          intersections: [{ alternatives: [{ kind: 'array', item }] }],
        }
      }
      if (atom.kind === 'generic' && (!atom.ref || !names.has(atom.ref))) {
        return null
      }
      return expr
    }

    return {
      ...source,
      fields: source.fields.map((f) => {
        const scrubbed = scrubExpr(f.type)
        if (!scrubbed) {
          return { ...f, type: createEmptyClearedTypeExpr() }
        }
        return { ...f, type: scrubbed }
      }),
      generics: source.generics.map((g) => ({
        ...g,
        constraint: scrubExpr(g.constraint),
        default: scrubExpr(g.default),
      })),
    }
  }

  function removeGeneric(index: number) {
    if (!draft || readonly) return
    const next = {
      ...draft,
      generics: draft.generics.filter((_, i) => i !== index),
    }
    setDraft(scrubStaleGenericRefs(next))
  }

  function openGenericConfig(index: number) {
    const g = draft?.generics[index]
    if (!g) return
    setGenericIndex(index)
    setGenericDraft(JSON.parse(JSON.stringify(g)) as TypeGenericParam)
    setGenericDialogVisible(true)
  }

  function saveGenericConfig() {
    if (readonly) return
    if (!draft || !genericDraft || genericIndex < 0) return
    const name = genericDraft.name.trim()
    if (!isValidTypeName(name)) {
      ElMessage.error('泛型参数名不合法')
      return
    }
    const prevName = draft.generics[genericIndex]?.name.trim() ?? ''
    let next: DataTypeDef = {
      ...draft,
      generics: draft.generics.map((g, i) =>
        i === genericIndex ? { ...genericDraft, name } : g,
      ),
    }
    if (prevName && prevName !== name) {
      function renameGenericInAtom(atom: TypeAtom): TypeAtom {
        if (atom.kind === 'array') {
          return {
            kind: 'array',
            item: renameGenericInAtom(atom.item ?? { kind: 'any' }),
          }
        }
        if (atom.kind === 'generic' && atom.ref === prevName) {
          return { kind: 'generic', ref: name }
        }
        return atom
      }
      next = {
        ...next,
        fields: next.fields.map((f) => {
          const atom = f.type.intersections[0]?.alternatives[0]
          if (!atom) return f
          return {
            ...f,
            type: {
              intersections: [{ alternatives: [renameGenericInAtom(atom)] }],
            },
          }
        }),
      }
    }
    setDraft(scrubStaleGenericRefs(next))
    setGenericDialogVisible(false)
    setGenericIndex(-1)
    setGenericDraft(null)
  }

  return (
    <>
      <Modal
        open={open}
        title={title}
        width={920}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={close}
        footer={
          readonly ? (
            <Button onClick={close}>关闭</Button>
          ) : (
            <Button type="primary" onClick={save}>
              保存
            </Button>
          )
        }
      >
        <fieldset className="readonly-fieldset" disabled={readonly}>
          {draft?.kind === 'interface' ? (
            <>
              <div className="section">
                <div className="section-head">
                  <span className="section-title">泛型参数</span>
                  {!readonly ? (
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          generics: [
                            ...draft.generics,
                            createEmptyGenericParam(),
                          ],
                        })
                      }
                    >
                      添加
                    </Button>
                  ) : null}
                </div>
                {!draft.generics.length ? (
                  <p className="section-hint">
                    无泛型（例如 List&lt;T&gt; 可添加 T）
                  </p>
                ) : null}
                {draft.generics.map((g, gi) => (
                  <div key={g.id} className="generic-row">
                    <Input
                      value={g.name}
                      placeholder="参数名，如 T"
                      style={{ width: 120 }}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          generics: draft.generics.map((item, i) =>
                            i === gi ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <span className="generic-summary" title={genericSummary(g)}>
                      {genericSummary(g)}
                    </span>
                    <Button
                      type="link"
                      icon={<SettingOutlined />}
                      onClick={() => openGenericConfig(gi)}
                    >
                      {readonly ? '查看' : '配置'}
                    </Button>
                    {!readonly ? (
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeGeneric(gi)}
                      />
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="section">
                <div className="section-head">
                  <span className="section-title">字段</span>
                  {!readonly ? (
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          fields: [
                            ...draft.fields,
                            createEmptyInterfaceField(),
                          ],
                        })
                      }
                    >
                      添加
                    </Button>
                  ) : null}
                </div>

                {draft.fields.map((field, fi) => (
                  <div key={field.id} className="field-row">
                    <Input
                      value={field.name}
                      placeholder="字段名"
                      status={
                        showFieldErrors && fieldNameError(fi) ? 'error' : ''
                      }
                      style={{ width: 120 }}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          fields: draft.fields.map((item, i) =>
                            i === fi ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <div className="optional-box">
                      <span className="optional-label">可选</span>
                      <Switch
                        size="small"
                        checked={field.optional}
                        onChange={(checked) =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.map((item, i) =>
                              i === fi ? { ...item, optional: checked } : item,
                            ),
                          })
                        }
                      />
                    </div>
                    <Input
                      value={field.remark}
                      placeholder="备注"
                      style={{ flex: 1, minWidth: 80 }}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          fields: draft.fields.map((item, i) =>
                            i === fi
                              ? { ...item, remark: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    <div
                      className={`field-type-cell${fieldTypeError(fi) ? ' is-error' : ''}`}
                    >
                      <TypeExprEditor
                        value={field.type}
                        library={library}
                        genericNames={genericNames}
                        excludeNamedIds={excludeNamedIds}
                        onChange={(v) => handleFieldTypeChange(fi, v)}
                      />
                    </div>
                    {!readonly ? (
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.filter((_, i) => i !== fi),
                          })
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {draft?.kind === 'enum' ? (
            <div className="section">
              <div className="section-head">
                <span className="section-title">枚举成员</span>
                {!readonly ? (
                  <Button
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        enumMembers: [
                          ...draft.enumMembers,
                          createEmptyEnumMember(),
                        ],
                      })
                    }
                  >
                    添加
                  </Button>
                ) : null}
              </div>
              <Table
                dataSource={draft.enumMembers}
                rowKey="id"
                bordered
                size="small"
                pagination={false}
                columns={[
                  {
                    title: '成员名',
                    minWidth: 140,
                    render: (_: unknown, row, index) => (
                      <Input
                        value={row.name}
                        placeholder="如 Active"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            enumMembers: draft.enumMembers.map((item, i) =>
                              i === index
                                ? { ...item, name: e.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    ),
                  },
                  {
                    title: '值（可选）',
                    minWidth: 140,
                    render: (_: unknown, row, index) => (
                      <Input
                        value={row.value}
                        placeholder="留空则自动"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            enumMembers: draft.enumMembers.map((item, i) =>
                              i === index
                                ? { ...item, value: e.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    ),
                  },
                  ...(!readonly
                    ? [
                        {
                          title: '操作',
                          width: 72,
                          align: 'center' as const,
                          render: (_: unknown, __: unknown, index: number) => (
                            <Button
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  enumMembers: draft.enumMembers.filter(
                                    (_, i) => i !== index,
                                  ),
                                })
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          ) : null}
        </fieldset>
      </Modal>

      <Modal
        open={genericDialogVisible}
        title={`配置泛型 · ${genericDraft?.name || 'T'}`}
        width={680}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setGenericDialogVisible(false)}
        footer={
          readonly ? (
            <Button onClick={() => setGenericDialogVisible(false)}>关闭</Button>
          ) : (
            <Button type="primary" onClick={saveGenericConfig}>
              确定
            </Button>
          )
        }
      >
        {genericDraft ? (
          <div className="generic-form">
            <div className="generic-form-item">
              <div className="cfg-label">参数名</div>
              <div className="cfg-content">
                <Input
                  value={genericDraft.name}
                  placeholder="如 T"
                  style={{ width: 160 }}
                  onChange={(e) =>
                    setGenericDraft({ ...genericDraft, name: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="generic-form-item">
              <div className="cfg-label">约束 extends</div>
              <div className="cfg-content">
                <TypeExprEditor
                  className="cfg-editor"
                  value={genericDraft.constraint}
                  library={library}
                  genericNames={genericNames}
                  excludeNamedIds={excludeNamedIds}
                  allowNone
                  onChange={(v) =>
                    setGenericDraft({ ...genericDraft, constraint: v })
                  }
                />
              </div>
            </div>

            <div className="generic-form-item">
              <div className="cfg-label">默认类型</div>
              <div className="cfg-content">
                <TypeExprEditor
                  className="cfg-editor"
                  value={genericDraft.default}
                  library={library}
                  genericNames={genericNames}
                  excludeNamedIds={excludeNamedIds}
                  allowNone
                  onChange={(v) =>
                    setGenericDraft({ ...genericDraft, default: v })
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
