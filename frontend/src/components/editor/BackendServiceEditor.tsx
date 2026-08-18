import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import type { BackendService } from '../../types/backend-services'
import { createEmptyBackendService } from '../../types/backend-services'
import type { MysqlDatabaseConfig, MysqlLibrary } from '../../types/mysql'
import './BackendServiceEditor.css'

export default function BackendServiceEditor({
  open,
  onOpenChange,
  service,
  mysqlLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  service: BackendService | null
  mysqlLibrary: MysqlLibrary | null
  onSave?: (service: BackendService) => void
}) {
  const [draft, setDraft] = useState<BackendService>(createEmptyBackendService())

  const mysqlOptions = useMemo(
    () => mysqlLibrary?.databases ?? [],
    [mysqlLibrary],
  )

  useEffect(() => {
    if (!open || !service) return
    setDraft({
      id: service.id,
      name: service.name,
      testMysqlId: service.testMysqlId,
      productionMysqlId: service.productionMysqlId,
    })
  }, [open, service])

  function mysqlLabel(db: MysqlDatabaseConfig): string {
    const schema = db.database?.trim()
    const endpoint = `${db.host}:${db.port}`
    if (schema) return `${db.name}（${endpoint} / ${schema}）`
    return `${db.name}（${endpoint}）`
  }

  function handleSave() {
    if (!service) return
    onSave?.({
      id: draft.id,
      name: draft.name.trim() || service.name,
      testMysqlId: draft.testMysqlId,
      productionMysqlId: draft.productionMysqlId,
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={`配置模块${draft.name ? ` · ${draft.name}` : ''}`}
      width={520}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      footer={
        <Button type="primary" onClick={handleSave}>
          保存
        </Button>
      }
      onCancel={() => onOpenChange?.(false)}
    >
      <div className="service-dialog-body">
        <section className="block">
          <div className="block-title">基本信息</div>
          <Form
            labelCol={{ style: { width: 100 } }}
            onSubmitCapture={(e) => e.preventDefault()}
          >
            <Form.Item label="名称">
              <Input
                value={draft.name}
                placeholder="显示名，如 shop"
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </Form.Item>
            <Form.Item label="ID">
              <Input value={draft.id} disabled />
            </Form.Item>
          </Form>
        </section>

        <section className="block">
          <div className="block-title">数据库</div>
          <p className="hint">
            从左侧「MySQL」中已配置的数据库里选择。构建时写入对应环境的 .env。
          </p>
          <Form
            labelCol={{ style: { width: 100 } }}
            onSubmitCapture={(e) => e.preventDefault()}
          >
            <Form.Item label="测试环境">
              <Select
                value={draft.testMysqlId || undefined}
                allowClear
                showSearch
                placeholder="选择数据库"
                style={{ width: '100%' }}
                optionFilterProp="label"
                options={mysqlOptions.map((db) => ({
                  value: db.id,
                  label: mysqlLabel(db),
                }))}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, testMysqlId: v ?? '' }))
                }
              />
            </Form.Item>
            <Form.Item label="生产环境">
              <Select
                value={draft.productionMysqlId || undefined}
                allowClear
                showSearch
                placeholder="选择数据库"
                style={{ width: '100%' }}
                optionFilterProp="label"
                options={mysqlOptions.map((db) => ({
                  value: db.id,
                  label: mysqlLabel(db),
                }))}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, productionMysqlId: v ?? '' }))
                }
              />
            </Form.Item>
          </Form>
        </section>
      </div>
    </Modal>
  )
}
