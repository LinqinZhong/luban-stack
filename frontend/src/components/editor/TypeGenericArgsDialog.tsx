import { useEffect, useState } from 'react'
import { Button, Form, Modal, Select } from 'antd'
import './TypeGenericArgsDialog.css'

export default function TypeGenericArgsDialog({
  open,
  onOpenChange,
  typeName,
  genericNames,
  args,
  typeOptions,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  typeName: string
  genericNames: string[]
  args: Record<string, string>
  typeOptions: Array<{ id: string; label: string }>
  onSave?: (args: Record<string, string>) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    const next: Record<string, string> = {}
    for (const name of genericNames) {
      next[name] = args[name] ?? ''
    }
    setDraft(next)
  }, [open, genericNames, args])

  function handleSave() {
    const next: Record<string, string> = {}
    for (const name of genericNames) {
      next[name] = (draft[name] ?? '').trim()
    }
    onSave?.(next)
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={`配置泛型 · ${typeName || '类型'}`}
      width={440}
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
      <p className="hint">
        未选择时按 <code>any</code> 处理。
      </p>
      <Form
        labelCol={{ style: { width: 48 } }}
        onFinish={handleSave}
      >
        {genericNames.map((name) => (
          <Form.Item key={name} label={name}>
            <Select
              value={draft[name] || undefined}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="any"
              style={{ width: '100%' }}
              options={typeOptions.map((opt) => ({
                value: opt.id,
                label: opt.label,
              }))}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, [name]: value ?? '' }))
              }
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}
