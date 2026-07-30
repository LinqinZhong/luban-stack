/** 表结构（含索引）变更后通知数据层刷新预置方法 */

type MysqlSchemaChangeListener = (tableName: string) => void

const listeners = new Set<MysqlSchemaChangeListener>()

export function onMysqlSchemaChanged(
  listener: MysqlSchemaChangeListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitMysqlSchemaChanged(tableName: string): void {
  const name = tableName.trim()
  if (!name) return
  for (const listener of listeners) {
    try {
      listener(name)
    } catch {
      // ignore listener errors
    }
  }
}
