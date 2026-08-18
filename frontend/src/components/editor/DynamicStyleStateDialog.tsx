import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Radio, Select, Table } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import DataFieldPathSelect from './DataFieldPathSelect'
import StyleEditor from './StyleEditor'
import {
  STYLE_CONDITION_OP_OPTIONS,
  createEmptyCondition,
  createEmptyScenario,
  type DynamicStyleState,
  type StyleCondition,
  type StyleOverrides,
  type StyleScenario,
} from '../../types/dynamic-styles'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import { findNearestRepeatListName } from '../../utils/data-field-paths'
import './DynamicStyleStateDialog.css'

export default function DynamicStyleStateDialog({
  open,
  onOpenChange,
  state,
  nodeTag,
  dataFields,
  componentProps,
  routeParams,
  pageQueryParams,
  selectedNodeId,
  xml,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  state: DynamicStyleState | null
  nodeTag?: string
  dataFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  pageQueryParams?: PageQueryParamDef[] | null
  selectedNodeId?: string
  xml?: string
  onSave?: (state: DynamicStyleState) => void
}) {
  const [name, setName] = useState('')
  const [scenarios, setScenarios] = useState<StyleScenario[]>([])
  const [styles, setStyles] = useState<StyleOverrides>({})
  const [activeSceneId, setActiveSceneId] = useState('')

  const repeatListName = useMemo(() => {
    if (!xml || !selectedNodeId) return null
    return findNearestRepeatListName(xml, selectedNodeId)
  }, [xml, selectedNodeId])

  const activeScene = scenarios.find((item) => item.id === activeSceneId) ?? null

  const needsValue = (op: StyleCondition['op']) =>
    op !== 'empty' && op !== 'notEmpty'

  useEffect(() => {
    if (!open || !state) return
    setName(state.name)
    setScenarios(
      state.scenarios.map((scene) => ({
        ...scene,
        conditions: scene.conditions.map((cond) => ({ ...cond })),
      })),
    )
    setStyles({ ...state.styles })
    setActiveSceneId(state.scenarios[0]?.id ?? '')
  }, [open, state])

  function addScenario() {
    const scene = createEmptyScenario(scenarios.length + 1)
    setScenarios((prev) => [...prev, scene])
    setActiveSceneId(scene.id)
  }

  function removeScenario(sceneId: string) {
    if (scenarios.length <= 1) {
      ElMessage.warning('至少保留一个场景')
      return
    }
    const next = scenarios.filter((item) => item.id !== sceneId)
    setScenarios(next)
    if (activeSceneId === sceneId) {
      setActiveSceneId(next[0]?.id ?? '')
    }
  }

  function patchScene(sceneId: string, patch: Partial<StyleScenario>) {
    setScenarios((prev) =>
      prev.map((item) => (item.id === sceneId ? { ...item, ...patch } : item)),
    )
  }

  function patchCondition(
    sceneId: string,
    index: number,
    patch: Partial<StyleCondition>,
  ) {
    setScenarios((prev) =>
      prev.map((item) => {
        if (item.id !== sceneId) return item
        return {
          ...item,
          conditions: item.conditions.map((cond, i) =>
            i === index ? { ...cond, ...patch } : cond,
          ),
        }
      }),
    )
  }

  function addCondition() {
    if (!activeScene) return
    patchScene(activeScene.id, {
      conditions: [...activeScene.conditions, createEmptyCondition()],
    })
  }

  function removeCondition(index: number) {
    if (!activeScene) return
    if (activeScene.conditions.length <= 1) {
      patchScene(activeScene.id, { conditions: [createEmptyCondition()] })
      return
    }
    patchScene(activeScene.id, {
      conditions: activeScene.conditions.filter((_, i) => i !== index),
    })
  }

  function handleSave() {
    if (!state) return
    const nextName = name.trim() || state.name
    onSave?.({
      id: state.id,
      name: nextName,
      scenarios: scenarios.map((scene, index) => ({
        id: scene.id,
        name: scene.name.trim() || `场景${index + 1}`,
        conditions: scene.conditions.map((cond) => ({ ...cond })),
      })),
      styles: { ...styles },
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑状态"
      width={780}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" onClick={handleSave}>
          保存
        </Button>
      }
    >
      <Form layout="vertical">
        <Form.Item label="状态名称">
          <Input
            value={name}
            placeholder="例如：选中态"
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>
      </Form>

      <div className="block-title">触发条件</div>
      <p className="block-hint">
        同一场景内条件为「且」；多个场景为「或」。字段支持树形选择子字段；选中数组后可填下标。
        {repeatListName ? (
          <>
            {' '}
            当前在重复「{repeatListName}」内，可选 <code>index</code> /{' '}
            <code>item.xxx</code>。
          </>
        ) : null}
      </p>

      <div className="scene-tabs">
        <Radio.Group
          value={activeSceneId}
          size="small"
          optionType="button"
          onChange={(e) => setActiveSceneId(e.target.value)}
        >
          {scenarios.map((scene) => (
            <Radio.Button key={scene.id} value={scene.id}>
              {scene.name}
            </Radio.Button>
          ))}
        </Radio.Group>
        <Button type="link" icon={<PlusOutlined />} onClick={addScenario}>
          添加场景
        </Button>
      </div>

      {activeScene ? (
        <div className="scene-panel">
          <div className="scene-header">
            <Input
              value={activeScene.name}
              size="small"
              placeholder="场景名称"
              style={{ maxWidth: 200 }}
              onChange={(e) =>
                patchScene(activeScene.id, { name: e.target.value })
              }
            />
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              disabled={scenarios.length <= 1}
              onClick={() => removeScenario(activeScene.id)}
            >
              删除场景
            </Button>
          </div>

          <Table
            className="cond-table"
            dataSource={activeScene.conditions}
            rowKey={(row) =>
              `${activeScene.id}-${activeScene.conditions.indexOf(row)}`
            }
            pagination={false}
            bordered
            size="small"
            columns={[
              {
                title: '字段',
                minWidth: 240,
                render: (_, row, index) => (
                  <DataFieldPathSelect
                    value={row.field}
                    fields={dataFields}
                    componentProps={componentProps}
                    routeParams={routeParams}
                    repeatListName={repeatListName}
                    onChange={(next) =>
                      patchCondition(activeScene.id, index, { field: next })
                    }
                  />
                ),
              },
              {
                title: '条件',
                width: 130,
                render: (_, row, index) => (
                  <Select
                    value={row.op}
                    style={{ width: '100%' }}
                    options={STYLE_CONDITION_OP_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    onChange={(next) =>
                      patchCondition(activeScene.id, index, { op: next })
                    }
                  />
                ),
              },
              {
                title: '值',
                minWidth: 120,
                render: (_, row, index) => (
                  <Input
                    value={row.value}
                    disabled={!needsValue(row.op)}
                    placeholder="比较值"
                    onChange={(e) =>
                      patchCondition(activeScene.id, index, {
                        value: e.target.value,
                      })
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
                    icon={<DeleteOutlined />}
                    onClick={() => removeCondition(index)}
                  />
                ),
              },
            ]}
          />
          <Button
            className="add-cond"
            type="link"
            icon={<PlusOutlined />}
            onClick={addCondition}
          >
            添加条件
          </Button>
        </div>
      ) : null}

      <div className="block-title">样式</div>
      <p className="block-hint">仅填写需要覆盖的属性；留空表示沿用基础样式。</p>
      <div className="style-box">
        <StyleEditor
          value={styles}
          onChange={setStyles}
          tag={nodeTag}
          showBorder
          dataFields={dataFields}
          componentProps={componentProps}
          routeParams={routeParams}
          pageQueryParams={pageQueryParams}
          repeatListName={repeatListName}
        />
      </div>
    </Modal>
  )
}
