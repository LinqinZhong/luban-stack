/** MySQL 常用列类型预设（设计表 / 建表共用） */

/** 资源外链列的默认物理类型（资源标记存在 mysql/{table}.json，不靠类型字符串识别） */
export const MYSQL_RESOURCE_DEFAULT_TYPE = 'varchar(255)'

export const MYSQL_COMMON_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'bigint', value: 'bigint' },
  { label: 'int', value: 'int' },
  { label: 'varchar(255)', value: 'varchar(255)' },
  { label: 'varchar(64)', value: 'varchar(64)' },
  { label: 'text', value: 'text' },
  { label: 'datetime', value: 'datetime' },
  { label: 'timestamp', value: 'timestamp' },
  { label: 'decimal(10,2)', value: 'decimal(10,2)' },
  { label: 'tinyint(1)', value: 'tinyint(1)' },
  { label: 'json', value: 'json' },
]

/** 是否资源外链列（以本地 schema 的 resource 标记为准） */
export function isMysqlResourceColumn(
  col: { resource?: boolean } | null | undefined,
): boolean {
  return Boolean(col?.resource)
}
