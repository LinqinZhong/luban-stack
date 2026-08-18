import { useMemo, useState } from 'react'
import { Button, DatePicker, Input, InputNumber, Select, Switch } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  CUSTOM_CONDITION_FIELD,
  DATA_METHOD_CONDITION_OP_OPTIONS,
  createEmptyDataMethodCondition,
  createEmptyDataMethodConditionGroup,
  createEmptyProcessorTypeExpr,
  type DataMethodCondition,
  type DataMethodConditionGroup,
  type DataMethodConditionOp,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import type { MethodParam } from '../../types/page-method'
import { typeExprToDataFieldType } from '../../utils/named-type-fields'
import type {
  ConditionFieldOption,
  ConditionValueUi,
} from '../../utils/data-method-conditions'
import TypedBindingCascader from './method-flow/TypedBindingCascader'
import EnableConditionDialog from './EnableConditionDialog'
import { DM } from './edit-data-method-copy'
import './DataMethodConditionsEditor.css'

export type { ConditionFieldOption, ConditionValueUi }

export default function DataMethodConditionsEditor({
  value,
  onChange,
  fieldOptions,
  ambientVars,
  typeLibrary = null,
  paramLabel = '',
  pickParamLabel = '',
  pickParamToLabel = '',
  ambientHint = '',
}: {
  value: DataMethodConditionGroup[]
  onChange?: (value: DataMethodConditionGroup[]) => void
  fieldOptions: ConditionFieldOption[]
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  paramLabel?: string
  pickParamLabel?: string
  pickParamToLabel?: string
  ambientHint?: string
}) {
  const groups = value
  const literalLabel = DM.literal
  const paramKindLabel = paramLabel || DM.param
  const pickParam = pickParamLabel || DM.pickParam
  const pickParamTo = pickParamToLabel || DM.pickParamTo

  const [enableDialogVisible, setEnableDialogVisible] = useState(false)
  const [enableDialogExpr, setEnableDialogExpr] = useState('')
  const [enableTarget, setEnableTarget] = useState<
    | { kind: 'group'; groupId: string }
    | { kind: 'cond'; groupId: string; condId: string }
    | null
  >(null)

  function setGroups(next: DataMethodConditionGroup[]) {
    onChange?.(next)
  }

  function addConditionGroup() {
    setGroups([...groups, createEmptyDataMethodConditionGroup()])
  }

  function removeConditionGroup(groupId: string) {
    setGroups(groups.filter((g) => g.id !== groupId))
  }

  function addCondition(groupId: string) {
    setGroups(
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: [...g.conditions, createEmptyDataMethodCondition()],
            }
          : g,
      ),
    )
  }

  function removeCondition(groupId: string, condId: string) {
    setGroups(
      groups.map((g) => {
        if (g.id !== groupId) return g
        const next = g.conditions.filter((c) => c.id !== condId)
        return {
          ...g,
          conditions: next.length ? next : [createEmptyDataMethodCondition()],
        }
      }),
    )
  }

  function patchGroup(
    groupId: string,
    patch: Partial<DataMethodConditionGroup>,
  ) {
    setGroups(groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)))
  }

  function patchCondition(
    groupId: string,
    condId: string,
    patch: Partial<DataMethodCondition>,
  ) {
    setGroups(
      groups.map((g) => {
        if (g.id !== groupId) return g
        return {
          ...g,
          conditions: g.conditions.map((c) =>
            c.id === condId ? { ...c, ...patch } : c,
          ),
        }
      }),
    )
  }

  function conditionOpMeta(op: DataMethodConditionOp) {
    return (
      DATA_METHOD_CONDITION_OP_OPTIONS.find((o) => o.value === op) ??
      DATA_METHOD_CONDITION_OP_OPTIONS[0]!
    )
  }

  function conditionValueUi(cond: DataMethodCondition): ConditionValueUi {
    if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) return 'string'
    return fieldOptions.find((o) => o.value === cond.field)?.valueUi ?? 'string'
  }

  function conditionFieldTypeExpr(
    cond: DataMethodCondition,
  ): ProcessorTypeExpr | null {
    if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) return null
    const opt = fieldOptions.find((o) => o.value === cond.field)
    if (!opt) return null
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (t.kind !== 'interface') continue
        const field = t.fields.find((f) => f.name.trim() === cond.field)
        if (!field) continue
        const mapped = typeExprToDataFieldType(field.type, typeLibrary)
        if (mapped.typeRef) {
          return {
            ...createEmptyProcessorTypeExpr(
              mapped.type === 'array' ? 'array' : 'json',
            ),
            typeRef: mapped.type === 'array' ? '' : mapped.typeRef,
            itemType: mapped.itemType || '',
            itemTypeRef: mapped.itemTypeRef || '',
          }
        }
        if (
          mapped.type === 'number' ||
          mapped.type === 'boolean' ||
          mapped.type === 'string'
        ) {
          return createEmptyProcessorTypeExpr(mapped.type)
        }
        return createEmptyProcessorTypeExpr('string')
      }
    }
    if (opt.valueUi === 'number') return createEmptyProcessorTypeExpr('number')
    if (opt.valueUi === 'boolean') return createEmptyProcessorTypeExpr('boolean')
    return createEmptyProcessorTypeExpr('string')
  }

  function conditionTargetType(cond: DataMethodCondition): ProcessorTypeExpr {
    const fromField = conditionFieldTypeExpr(cond)
    const ui = conditionValueUi(cond)
    const leaf =
      fromField ??
      (ui === 'number'
        ? createEmptyProcessorTypeExpr('number')
        : ui === 'boolean'
          ? createEmptyProcessorTypeExpr('boolean')
          : createEmptyProcessorTypeExpr('string'))
    if (cond.op === 'in' || cond.op === 'notIn') {
      const itemType = leaf.typeRef
        ? 'json'
        : leaf.type === 'number' ||
            leaf.type === 'boolean' ||
            leaf.type === 'string'
          ? leaf.type
          : 'string'
      return {
        ...createEmptyProcessorTypeExpr('array'),
        itemType,
        itemTypeRef: leaf.typeRef || '',
      }
    }
    return leaf
  }

  function openEnableForGroup(group: DataMethodConditionGroup) {
    setEnableTarget({ kind: 'group', groupId: group.id })
    setEnableDialogExpr(group.enableCondition ?? '')
    setEnableDialogVisible(true)
  }

  function openEnableForCond(groupId: string, cond: DataMethodCondition) {
    setEnableTarget({ kind: 'cond', groupId, condId: cond.id })
    setEnableDialogExpr(cond.enableCondition ?? '')
    setEnableDialogVisible(true)
  }

  function onEnableSave(expr: string) {
    const target = enableTarget
    if (!target) return
    if (target.kind === 'group') {
      patchGroup(target.groupId, { enableCondition: expr })
    } else {
      patchCondition(target.groupId, target.condId, { enableCondition: expr })
    }
    setEnableTarget(null)
  }

  function enableLabel(expr: string | undefined): string {
    return (expr ?? '').trim() ? DM.enableCondSet : DM.enableCond
  }

  const fieldSelectOptions = useMemo(
    () => fieldOptions.map((opt) => ({ value: opt.value, label: opt.label })),
    [fieldOptions],
  )

  return (
    <div className="data-method-conditions">
      <div className="cond-toolbar">
        <div className="cond-tabs">
          {groups.map((g, gi) => (
            <span key={g.id} className="cond-tab">
              {DM.group}
              {gi + 1}
            </span>
          ))}
          {!groups.length ? (
            <span className="cond-hint">{DM.groupHint}</span>
          ) : null}
        </div>
        <Button type="link" icon={<PlusOutlined />} onClick={addConditionGroup}>
          {DM.addGroup}
        </Button>
      </div>

      {!groups.length ? (
        <div className="empty-box">{DM.conditionsEmpty}</div>
      ) : null}

      {groups.map((group, gi) => (
        <div key={group.id} className="cond-group">
          <div className="cond-group-head">
            <span className="cond-group-title">
              {DM.group}
              {gi + 1}
            </span>
            <span className="cond-group-logic">{DM.groupAnd}</span>
            <div className="cond-group-actions">
              <Button type="link" onClick={() => openEnableForGroup(group)}>
                {enableLabel(group.enableCondition)}
              </Button>
              <Button
                type="link"
                icon={<PlusOutlined />}
                onClick={() => addCondition(group.id)}
              >
                {DM.add}
              </Button>
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeConditionGroup(group.id)}
              />
            </div>
          </div>

          {group.conditions.map((cond) => (
            <div key={cond.id} className="cond-row">
              <Select
                value={cond.field || CUSTOM_CONDITION_FIELD}
                showSearch
                optionFilterProp="label"
                placeholder={DM.field}
                className="cond-field"
                options={fieldSelectOptions}
                onChange={(next) =>
                  patchCondition(group.id, cond.id, {
                    field: String(next ?? ''),
                  })
                }
              />

              {cond.field === CUSTOM_CONDITION_FIELD ? (
                <Input
                  value={cond.customField}
                  placeholder={DM.customField}
                  className="cond-custom"
                  onChange={(e) =>
                    patchCondition(group.id, cond.id, {
                      customField: e.target.value,
                    })
                  }
                />
              ) : null}

              <Select
                value={cond.op}
                placeholder={DM.cond}
                className="cond-op"
                options={DATA_METHOD_CONDITION_OP_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={(next) =>
                  patchCondition(group.id, cond.id, {
                    op: (next as DataMethodConditionOp) || 'eq',
                  })
                }
              />

              {conditionOpMeta(cond.op).needsValue ? (
                <>
                  <Select
                    value={cond.valueKind}
                    className="cond-kind"
                    options={[
                      { label: literalLabel, value: 'literal' },
                      { label: paramKindLabel, value: 'param' },
                    ]}
                    onChange={(next) =>
                      patchCondition(group.id, cond.id, {
                        valueKind: next === 'param' ? 'param' : 'literal',
                        value: '',
                        valueTo: '',
                      })
                    }
                  />

                  {cond.valueKind === 'param' ? (
                    <>
                      <TypedBindingCascader
                        value={cond.value}
                        className="cond-value"
                        ambientVars={ambientVars}
                        targetType={conditionTargetType(cond)}
                        typeLibrary={typeLibrary}
                        compatibility="scalar-loose"
                        placeholder={pickParam}
                        onChange={(next) =>
                          patchCondition(group.id, cond.id, {
                            value: String(next ?? ''),
                          })
                        }
                      />
                      {conditionOpMeta(cond.op).needsValueTo ? (
                        <TypedBindingCascader
                          value={cond.valueTo}
                          className="cond-value"
                          ambientVars={ambientVars}
                          targetType={conditionTargetType(cond)}
                          typeLibrary={typeLibrary}
                          compatibility="scalar-loose"
                          placeholder={pickParamTo}
                          onChange={(next) =>
                            patchCondition(group.id, cond.id, {
                              valueTo: String(next ?? ''),
                            })
                          }
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      {conditionValueUi(cond) === 'number' ? (
                        <InputNumber
                          value={Number(cond.value || 0)}
                          className="cond-value"
                          onChange={(next) =>
                            patchCondition(group.id, cond.id, {
                              value: String(next ?? 0),
                            })
                          }
                        />
                      ) : conditionValueUi(cond) === 'boolean' ? (
                        <Switch
                          checked={cond.value === 'true'}
                          onChange={(checked) =>
                            patchCondition(group.id, cond.id, {
                              value: checked ? 'true' : 'false',
                            })
                          }
                        />
                      ) : conditionValueUi(cond) === 'datetime' ? (
                        <DatePicker
                          showTime
                          value={
                            cond.value
                              ? dayjs(cond.value, 'YYYY-MM-DD HH:mm:ss')
                              : undefined
                          }
                          format="YYYY-MM-DD HH:mm:ss"
                          placeholder={DM.pickTime}
                          className="cond-value"
                          onChange={(_, dateString) =>
                            patchCondition(group.id, cond.id, {
                              value: String(dateString ?? ''),
                            })
                          }
                        />
                      ) : (
                        <Input
                          value={cond.value}
                          placeholder={DM.value}
                          className="cond-value"
                          onChange={(e) =>
                            patchCondition(group.id, cond.id, {
                              value: e.target.value,
                            })
                          }
                        />
                      )}

                      {conditionOpMeta(cond.op).needsValueTo ? (
                        conditionValueUi(cond) === 'number' ? (
                          <InputNumber
                            value={Number(cond.valueTo || 0)}
                            className="cond-value"
                            onChange={(next) =>
                              patchCondition(group.id, cond.id, {
                                valueTo: String(next ?? 0),
                              })
                            }
                          />
                        ) : conditionValueUi(cond) === 'datetime' ? (
                          <DatePicker
                            showTime
                            value={
                              cond.valueTo
                                ? dayjs(cond.valueTo, 'YYYY-MM-DD HH:mm:ss')
                                : undefined
                            }
                            format="YYYY-MM-DD HH:mm:ss"
                            placeholder={DM.pickTimeTo}
                            className="cond-value"
                            onChange={(_, dateString) =>
                              patchCondition(group.id, cond.id, {
                                valueTo: String(dateString ?? ''),
                              })
                            }
                          />
                        ) : (
                          <Input
                            value={cond.valueTo}
                            placeholder={DM.valueTo}
                            className="cond-value"
                            onChange={(e) =>
                              patchCondition(group.id, cond.id, {
                                valueTo: e.target.value,
                              })
                            }
                          />
                        )
                      ) : null}
                    </>
                  )}
                </>
              ) : null}

              <Button
                type="link"
                className="cond-enable"
                onClick={() => openEnableForCond(group.id, cond)}
              >
                {enableLabel(cond.enableCondition)}
              </Button>

              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                className="cond-del"
                onClick={() => removeCondition(group.id, cond.id)}
              />
            </div>
          ))}

          {gi < groups.length - 1 ? <div className="cond-or">OR</div> : null}
        </div>
      ))}

      <EnableConditionDialog
        open={enableDialogVisible}
        onOpenChange={setEnableDialogVisible}
        expression={enableDialogExpr}
        ambientVars={ambientVars}
        ambientHint={ambientHint}
        onSave={onEnableSave}
      />
    </div>
  )
}
