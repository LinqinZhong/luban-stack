import { useMemo } from 'react'
import { Button, Modal } from 'antd'
import type { MysqlColumnDef } from '../../types/mysql'
import { formatMysqlColumnSummary } from '../../utils/mysql-schema'
import './MysqlSchemaConflictDialog.css'

export default function MysqlSchemaConflictDialog({
  open,
  onOpenChange,
  tableName,
  local,
  remote,
  resolving,
  onAdopt,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  tableName: string
  local: MysqlColumnDef[]
  remote: MysqlColumnDef[]
  resolving?: boolean
  onAdopt?: (side: 'local' | 'remote') => void
}) {
  const localLines = useMemo(
    () => local.map((c) => formatMysqlColumnSummary(c)),
    [local],
  )
  const remoteLines = useMemo(
    () => remote.map((c) => formatMysqlColumnSummary(c)),
    [remote],
  )

  return (
    <Modal
      open={open}
      title={`表结构不一致 · ${tableName}`}
      width={860}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <>
          <Button
            loading={resolving}
            onClick={() => onAdopt?.('remote')}
            style={{ color: '#e6a23c', borderColor: '#e6a23c' }}
          >
            采用数据库
          </Button>
          <Button
            type="primary"
            loading={resolving}
            onClick={() => onAdopt?.('local')}
          >
            采用本地并推送到数据库
          </Button>
        </>
      }
    >
      <p className="hint">
        数据库中的表结构与本地 <code>mysql/{tableName}.json</code> 不一致，请选择要采纳的一方。
      </p>
      <div className="compare">
        <section className="pane">
          <header className="pane-head">本地（mysql/{tableName}.json）</header>
          <ul className="col-list">
            {localLines.map((line, i) => (
              <li key={`l-${i}`}>{line}</li>
            ))}
            {!localLines.length ? <li className="empty">（无列）</li> : null}
          </ul>
        </section>
        <section className="pane">
          <header className="pane-head">数据库</header>
          <ul className="col-list">
            {remoteLines.map((line, i) => (
              <li key={`r-${i}`}>{line}</li>
            ))}
            {!remoteLines.length ? <li className="empty">（无列）</li> : null}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
