import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Switch,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  createEmptyPageQueryParam,
  type PageQueryParamDef,
} from '../../types/page-query'
import './PageQueryParamsPanel.css'

export default function PageQueryParamsPanel({
  queryParams,
  debugQuery,
  onQueryParamsChange,
  onDebugQueryChange,
}: {
  queryParams: PageQueryParamDef[]
  debugQuery: Record<string, unknown>
  onQueryParamsChange?: (value: PageQueryParamDef[]) => void
  onDebugQueryChange?: (value: Record<string, unknown>) => void
}) {
  const [dialogVisible, setDialogVisible] = useState(false)
  const [editingIndex, setEditingIndex] = useState(-1)
  const [draft, setDraft] = useState<PageQueryParamDef>(
    createEmptyPageQueryParam(),
  )

  const existingNames = useMemo(
    () =>
      queryParams
        .map((p, i) => (i === editingIndex ? '' : p.name.trim()))
        .filter(Boolean),
    [queryParams, editingIndex],
  )

  useEffect(() => {
    if (!dialogVisible) {
      setEditingIndex(-1)
      setDraft(createEmptyPageQueryParam())
    }
  }, [dialogVisible])

  function openAdd() {
    setEditingIndex(-1)
    setDraft(createEmptyPageQueryParam())
    setDialogVisible(true)
  }

  function openEdit(index: number) {
    const row = queryParams[index]
    if (!row) return
    setEditingIndex(index)
    setDraft({ ...row })
    setDialogVisible(true)
  }

  function removeAt(index: number) {
    const next = queryParams.filter((_, i) => i !== index)
    onQueryParamsChange?.(next)
    const removed = queryParams[index]?.name?.trim()
    if (
      removed &&
      Object.prototype.hasOwnProperty.call(debugQuery, removed)
    ) {
      const dq = { ...debugQuery }
      delete dq[removed]
      onDebugQueryChange?.(dq)
    }
  }

  function saveDraft() {
    const name = draft.name.trim()
    if (!name) return
    if (existingNames.includes(name)) return
    const row: PageQueryParamDef = {
      name,
      type: draft.type,
      remark: draft.remark?.trim() || '',
      required: Boolean(draft.required),
      defaultValue:
        draft.type === 'number'
          ? Number(draft.defaultValue ?? 0) || 0
          : draft.type === 'boolean'
            ? Boolean(draft.defaultValue)
            : String(draft.defaultValue ?? ''),
    }
    const next = [...queryParams]
    if (editingIndex >= 0) {
      const prevName = next[editingIndex]?.name
      next[editingIndex] = row
      if (prevName && prevName !== name) {
        const dq = { ...debugQuery }
        if (Object.prototype.hasOwnProperty.call(dq, prevName)) {
          dq[name] = dq[prevName]
          delete dq[prevName]
          onDebugQueryChange?.(dq)
        }
      }
    } else {
      next.push(row)
    }
    onQueryParamsChange?.(next)
    setDialogVisible(false)
  }

  function debugValue(name: string): string {
    const v = debugQuery[name]
    if (v == null) return ''
    return String(v)
  }

  function setDebugValue(
    name: string,
    raw: string,
    type: PageQueryParamDef['type'],
  ) {
    const dq = { ...debugQuery }
    if (type === 'number') {
      const n = Number(raw)
      dq[name] = Number.isFinite(n) ? n : 0
    } else if (type === 'boolean') {
      dq[name] = raw === 'true' || raw === '1'
    } else {
      dq[name] = raw
    }
    onDebugQueryChange?.(dq)
  }

  function typeLabel(t: PageQueryParamDef['type']) {
    if (t === 'number') return '数字'
    if (t === 'boolean') return '布尔'
    return '字符串'
  }

  return (
    <div className="query-params-panel">
      <div className="section-title">
        <span>查询参数</span>
        <Button type="link" icon={<PlusOutlined />} onClick={openAdd}>
          添加
        </Button>
      </div>

      {!queryParams.length ? (
        <Empty
          description="暂无查询参数，点击添加"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="param-list">
          {queryParams.map((row, index) => (
            <div key={row.name} className="param-card">
              <div className="param-main">
                <div className="param-name">
                  {row.name}
                  {row.required ? <span className="req">*</span> : null}
                  <span className="param-type">{typeLabel(row.type)}</span>
                </div>
                {row.remark ? (
                  <div className="param-remark">{row.remark}</div>
                ) : null}
                <Input
                  size="small"
                  value={debugValue(row.name)}
                  placeholder={`调试值，默认 ${row.defaultValue ?? ''}`}
                  onChange={(e) =>
                    setDebugValue(row.name, String(e.target.value ?? ''), row.type)
                  }
                />
              </div>
              <div className="param-actions">
                <Button type="link" onClick={() => openEdit(index)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeAt(index)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={dialogVisible}
        title={editingIndex >= 0 ? '编辑 Query 入参' : '添加 Query 入参'}
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        footer={
          <Button
            type="primary"
            disabled={
              !draft.name.trim() || existingNames.includes(draft.name.trim())
            }
            onClick={saveDraft}
          >
            确定
          </Button>
        }
        onCancel={() => setDialogVisible(false)}
      >
        <Form
          labelCol={{ style: { width: 72 } }}
          onSubmitCapture={(e) => e.preventDefault()}
        >
          <Form.Item label="名称" required>
            <Input
              value={draft.name}
              placeholder="如 id"
              maxLength={64}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="类型">
            <Radio.Group
              value={draft.type}
              optionType="button"
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, type: e.target.value }))
              }
            >
              <Radio.Button value="string">字符串</Radio.Button>
              <Radio.Button value="number">数字</Radio.Button>
              <Radio.Button value="boolean">布尔</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="默认值">
            {draft.type === 'boolean' ? (
              <Switch
                checked={Boolean(draft.defaultValue)}
                onChange={(checked) =>
                  setDraft((prev) => ({ ...prev, defaultValue: checked }))
                }
              />
            ) : draft.type === 'number' ? (
              <InputNumber
                value={Number(draft.defaultValue ?? 0)}
                style={{ width: '100%' }}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, defaultValue: Number(v ?? 0) }))
                }
              />
            ) : (
              <Input
                value={String(draft.defaultValue ?? '')}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultValue: e.target.value }))
                }
              />
            )}
          </Form.Item>
          <Form.Item label="必传">
            <Switch
              checked={Boolean(draft.required)}
              onChange={(checked) =>
                setDraft((prev) => ({ ...prev, required: checked }))
              }
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input
              value={draft.remark}
              placeholder="可选"
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, remark: e.target.value }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
