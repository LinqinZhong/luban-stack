import { useMemo, useState } from 'react'
import { Button, Empty } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  RightOutlined,
} from '@ant-design/icons'
import type { PageMethod } from '../../types/page-method'
import './MethodsPanel.css'

export default function MethodsPanel({
  methods,
  onEdit,
  onRemove,
}: {
  methods: PageMethod[]
  onEdit?: (method: PageMethod) => void
  onRemove?: (method: PageMethod) => void
}) {
  const customMethods = useMemo(
    () => methods.filter((item) => !item.builtin),
    [methods],
  )
  const builtinMethods = useMemo(
    () => methods.filter((item) => item.builtin),
    [methods],
  )

  const [builtinsExpanded, setBuiltinsExpanded] = useState(false)

  function formatSignature(method: PageMethod): string {
    const params = method.params.length
      ? method.params.map((p) => `${p.name}: ${p.type}`).join(', ')
      : '无参'
    return `( ${params} )`
  }

  return (
    <div className="methods-panel">
      {!customMethods.length && !builtinMethods.length ? (
        <Empty description="暂无方法" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="method-list">
          {customMethods.map((method) => (
            <div
              key={method.name}
              className="method-card"
              onClick={() => onEdit?.(method)}
            >
              <div className="method-main">
                <div className="method-name">{method.name}</div>
                <div className="method-sig">{formatSignature(method)}</div>
              </div>
              <div
                className="method-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => onEdit?.(method)}
                >
                  编辑
                </Button>
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onRemove?.(method)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}

          {builtinMethods.length ? (
            <div className="builtins-block">
              <button
                type="button"
                className="builtins-toggle"
                onClick={() => setBuiltinsExpanded((v) => !v)}
              >
                <RightOutlined
                  className={`builtins-arrow${builtinsExpanded ? ' open' : ''}`}
                />
                <span>预置方法</span>
                <span className="builtins-count">{builtinMethods.length}</span>
              </button>

              <div
                className="builtins-list"
                style={{ display: builtinsExpanded ? undefined : 'none' }}
              >
                {builtinMethods.map((method) => (
                  <div key={method.name} className="method-card is-builtin">
                    <div className="method-main">
                      <div className="method-name">{method.name}</div>
                      {method.summary ? (
                        <div className="method-summary">{method.summary}</div>
                      ) : null}
                      <div className="method-sig">{formatSignature(method)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
