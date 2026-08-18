import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Modal, Skeleton } from 'antd'
import {
  findDataMethodUsage,
  formatDataMethodUsagePath,
  type DataMethodUsageRef,
} from '../../utils/data-method-usage'
import './DataMethodUsageDialog.css'

export default function DataMethodUsageDialog({
  open,
  onOpenChange,
  projectPath,
  serviceId,
  dataProcessorId,
  dataMethodId,
  dataMethodName,
  onJump,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  projectPath: string
  serviceId: string
  dataProcessorId: string
  dataMethodId: string
  dataMethodName: string
  onJump?: (ref: DataMethodUsageRef) => void
}) {
  const [loading, setLoading] = useState(false)
  const [refs, setRefs] = useState<DataMethodUsageRef[]>([])
  const [errorText, setErrorText] = useState('')

  const title = `使用「${dataMethodName || dataMethodId}」的位置`

  async function load() {
    setLoading(true)
    setErrorText('')
    setRefs([])
    try {
      const next = await findDataMethodUsage({
        projectPath,
        serviceId,
        dataProcessorId,
        dataMethodId,
      })
      setRefs(next)
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleJump(row: DataMethodUsageRef) {
    onJump?.(row)
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={title}
      width={640}
      destroyOnHidden
      maskClosable={false}
      onCancel={() => onOpenChange?.(false)}
      footer={null}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : errorText ? (
        <Alert type="error" message={errorText} showIcon />
      ) : !refs.length ? (
        <Empty
          description="暂无引用（业务流 / 控制器流）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <ul className="usage-list">
          {refs.map((row, i) => (
            <li
              key={`${row.serviceId}:${row.layer}:${row.ownerId}:${row.methodId}:${row.nodeId}:${i}`}
              className="usage-item"
              onClick={() => handleJump(row)}
            >
              <span className="path">{formatDataMethodUsagePath(row)}</span>
              <Button type="link">跳转</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
