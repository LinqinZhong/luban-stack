import { Button, Empty } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import './PreviewRuntimeLog.css'

export type PreviewRuntimeLogLevel = 'error' | 'warn' | 'info'

export type PreviewRuntimeLogEntry = {
  id: number
  time: string
  level: PreviewRuntimeLogLevel
  message: string
  /** 出错位置，如「组件 Pager · setData」 */
  location?: string
}

export default function PreviewRuntimeLog({
  logs,
  onClear,
}: {
  logs?: PreviewRuntimeLogEntry[]
  onClear?: () => void
}) {
  const entries = logs ?? []

  function levelLabel(level: PreviewRuntimeLogLevel): string {
    if (level === 'error') return '错误'
    if (level === 'warn') return '警告'
    return '信息'
  }

  return (
    <div className="runtime-log">
      <div className="log-header">
        <span>运行日志</span>
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          disabled={!entries.length}
          onClick={() => onClear?.()}
        >
          清空
        </Button>
      </div>
      <div className="log-body">
        {!entries.length ? (
          <Empty description="暂无日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <ul className="log-list">
            {entries.map((item) => (
              <li key={item.id} className={`log-item is-${item.level}`}>
                <div className="log-meta">
                  <span className="log-level">{levelLabel(item.level)}</span>
                  <span className="log-time">{item.time}</span>
                </div>
                {item.location ? (
                  <div className="log-location">{item.location}</div>
                ) : null}
                <div className="log-message">{item.message}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
