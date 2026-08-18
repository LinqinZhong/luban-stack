import {
  createDefaultMethodFlow,
  createEmptyDataMethodConfig,
  createEmptyProcessorTypeExpr,
  type DataMethodCondition,
  type DataMethodConditionGroup,
  type DataMethodConfig,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
} from '../types/backend-services'
import type { DataTypeDef } from '../types/data-types'
import type { MysqlColumnDef, MysqlIndexDef } from '../types/mysql'
import { columnNameToFieldName } from './mysql-to-type'
import { isMysqlNumericColumnType } from './mysql-schema'

export const PRESET_METHOD_ID_PREFIX = 'preset_'

/** 固定预置方法名（不含按索引字段生成的 ByXxx） */
export const STATIC_PRESET_METHOD_NAMES = [
  'count',
  'page',
  'oneById',
  'save',
  'saveBatch',
  'updateById',
  'deleteById',
  'hardDeleteById',
] as const

export function isPresetMethodId(id: string): boolean {
  return id.startsWith(PRESET_METHOD_ID_PREFIX)
}

function capitalize(name: string): string {
  if (!name) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** 索引对应的 ByXxx 后缀，如 UserIdAndStatus */
export function indexBySuffix(
  index: MysqlIndexDef,
  columns: MysqlColumnDef[],
): string {
  const parts: string[] = []
  for (const colName of index.columns) {
    const col = columns.find((c) => c.name === colName)
    if (!col || col.primaryKey) continue
    parts.push(capitalize(columnNameToFieldName(col.name)))
  }
  return parts.join('And')
}

function resolveIndexColumns(
  index: MysqlIndexDef,
  columns: MysqlColumnDef[],
): MysqlColumnDef[] {
  const result: MysqlColumnDef[] = []
  for (const colName of index.columns) {
    const col = columns.find((c) => c.name === colName)
    if (!col || col.primaryKey) continue
    result.push(col)
  }
  return result
}

/** 当前表会占用的全部预置方法名（含 countByXxx / pageByXxx） */
export function listPresetMethodNames(
  columns: MysqlColumnDef[],
  indexes: MysqlIndexDef[] = [],
): string[] {
  const names = new Set<string>(STATIC_PRESET_METHOD_NAMES)
  for (const idx of indexes) {
    const by = indexBySuffix(idx, columns)
    if (!by) continue
    names.add(`countBy${by}`)
    names.add(`pageBy${by}`)
  }
  return [...names]
}

function param(
  name: string,
  typeExpr: ProcessorTypeExpr,
  remark = '',
): ProcessorMethodParam {
  return {
    id: `param_preset_${name}`,
    name,
    remark,
    typeExpr,
    required: true,
  }
}

function numberType(): ProcessorTypeExpr {
  return createEmptyProcessorTypeExpr('number')
}

function stringType(): ProcessorTypeExpr {
  return createEmptyProcessorTypeExpr('string')
}

function fieldValueType(col: MysqlColumnDef): ProcessorTypeExpr {
  return isMysqlNumericColumnType(col.type) ? numberType() : stringType()
}

function entityType(entityId: string): ProcessorTypeExpr {
  return {
    ...createEmptyProcessorTypeExpr('json'),
    typeRef: entityId,
  }
}

function entityArrayType(entityId: string): ProcessorTypeExpr {
  return {
    ...createEmptyProcessorTypeExpr('array'),
    itemType: 'json',
    itemTypeRef: entityId,
  }
}

function numberArrayType(): ProcessorTypeExpr {
  return {
    ...createEmptyProcessorTypeExpr('array'),
    itemType: 'number',
  }
}

function pageDtoType(): ProcessorTypeExpr {
  return {
    ...createEmptyProcessorTypeExpr('json'),
    typeRef: 'type_common_QueryPageDto',
  }
}

function softDeleteCondition(
  logicDeleteCol: MysqlColumnDef | undefined,
): DataMethodCondition | null {
  if (!logicDeleteCol) return null
  const field = columnNameToFieldName(logicDeleteCol.name)
  return {
    id: `cond_preset_softdelete_${logicDeleteCol.name}`,
    field,
    customField: '',
    op: 'eq',
    valueKind: 'literal',
    value: '0',
    valueTo: '',
  }
}

function eqParamCondition(
  fieldName: string,
  paramName: string,
  idSuffix: string,
): DataMethodCondition {
  return {
    id: `cond_preset_${idSuffix}`,
    field: fieldName,
    customField: '',
    op: 'eq',
    valueKind: 'param',
    value: paramName,
    valueTo: '',
  }
}

function condGroup(
  ...conditions: Array<DataMethodCondition | null>
): DataMethodConditionGroup[] {
  const list = conditions.filter((c): c is DataMethodCondition => Boolean(c))
  if (!list.length) return []
  return [{ id: `cg_preset_${list[0]!.id}`, conditions: list }]
}

function baseMethod(
  id: string,
  name: string,
  remark: string,
  params: ProcessorMethodParam[],
  output: ProcessorTypeExpr,
  dataConfig: DataMethodConfig,
  disabled = false,
): ProcessorMethod {
  return {
    id,
    name,
    remark,
    scope: 'public',
    params,
    output,
    dataConfig,
    debugParams: {},
    flow: createDefaultMethodFlow(),
    preset: true,
    disabled,
  }
}

function softDeleteWhereSql(logicDeleteCol: MysqlColumnDef | undefined): string {
  if (!logicDeleteCol) return ''
  return ` WHERE \`${logicDeleteCol.name.replace(/`/g, '')}\` = 0`
}

function andSoftDeleteSql(logicDeleteCol: MysqlColumnDef | undefined): string {
  if (!logicDeleteCol) return ''
  return ` AND \`${logicDeleteCol.name.replace(/`/g, '')}\` = 0`
}

function indexWhereSql(cols: MysqlColumnDef[]): string {
  return cols
    .map((col) => {
      const field = columnNameToFieldName(col.name)
      return `\`${col.name.replace(/`/g, '')}\` = #{${field}}`
    })
    .join(' AND ')
}

/**
 * 根据实体 + 表列 / 索引生成虚拟预置方法（不落盘）。
 * 同名自定义方法由调用方覆盖显示。
 */
export function buildPresetMethods(options: {
  entity: DataTypeDef | null | undefined
  columns: MysqlColumnDef[]
  indexes?: MysqlIndexDef[]
}): ProcessorMethod[] {
  const { entity, columns, indexes = [] } = options
  // 未绑定表名时不生成数据库预置方法
  if (!entity?.id || !entity.tableName?.trim()) return []

  const entityId = entity.id
  const logicDeleteCol = columns.find((c) => c.logicDelete)
  const pkCol =
    columns.find((c) => c.primaryKey) ||
    columns.find((c) => c.name.toLowerCase() === 'id')
  const pkField = pkCol ? columnNameToFieldName(pkCol.name) : 'id'

  const entityFieldNames =
    entity.kind === 'interface'
      ? entity.fields.map((f) => f.name).filter(Boolean)
      : columns.map((c) => columnNameToFieldName(c.name))

  const queryFields = entityFieldNames.length
    ? entityFieldNames
    : columns.map((c) => columnNameToFieldName(c.name))

  const insertableCols = columns.filter((c) => !(c.primaryKey && c.autoIncrement))
  const insertMappings = insertableCols.map((c) => {
    const field = columnNameToFieldName(c.name)
    return { field, column: `data.${field}` }
  })
  const batchMappings = insertableCols.map((c) => {
    const field = columnNameToFieldName(c.name)
    return { field, column: `items.${field}` }
  })
  const updateMappings = columns
    .filter((c) => !c.primaryKey && !c.logicDelete)
    .map((c) => {
      const field = columnNameToFieldName(c.name)
      return { field, column: `data.${field}` }
    })

  const softCond = softDeleteCondition(logicDeleteCol)
  const methods: ProcessorMethod[] = []

  methods.push(
    baseMethod(
      'preset_count',
      'count',
      '查询总条数',
      [],
      numberType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'custom',
        sql: `SELECT COUNT(*) AS cnt FROM \${TABLE_NAME}${softDeleteWhereSql(logicDeleteCol)}`,
      },
    ),
  )

  for (const idx of indexes) {
    const idxCols = resolveIndexColumns(idx, columns)
    const by = indexBySuffix(idx, columns)
    if (!idxCols.length || !by) continue
    const fieldLabels = idxCols.map((c) => columnNameToFieldName(c.name)).join(', ')
    methods.push(
      baseMethod(
        `preset_countBy_${idx.name}`,
        `countBy${by}`,
        idx.remark?.trim() || `按 ${fieldLabels} 查询总条数`,
        idxCols.map((col) => {
          const field = columnNameToFieldName(col.name)
          return param(field, fieldValueType(col), field)
        }),
        numberType(),
        {
          ...createEmptyDataMethodConfig(),
          operation: 'custom',
          sql: `SELECT COUNT(*) AS cnt FROM \${TABLE_NAME} WHERE ${indexWhereSql(idxCols)}${andSoftDeleteSql(logicDeleteCol)}`,
        },
      ),
    )
  }

  methods.push(
    baseMethod(
      'preset_page',
      'page',
      '分页查询',
      [param('pageDto', pageDtoType(), '分页参数')],
      entityArrayType(entityId),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'query',
        queryFields,
        pageParam: 'pageDto',
        conditionGroups: condGroup(softCond),
      },
    ),
  )

  for (const idx of indexes) {
    const idxCols = resolveIndexColumns(idx, columns)
    const by = indexBySuffix(idx, columns)
    if (!idxCols.length || !by) continue
    const fieldLabels = idxCols.map((c) => columnNameToFieldName(c.name)).join(', ')
    methods.push(
      baseMethod(
        `preset_pageBy_${idx.name}`,
        `pageBy${by}`,
        idx.remark?.trim() || `按 ${fieldLabels} 分页查询`,
        [
          param('pageDto', pageDtoType(), '分页参数'),
          ...idxCols.map((col) => {
            const field = columnNameToFieldName(col.name)
            return param(field, fieldValueType(col), field)
          }),
        ],
        entityArrayType(entityId),
        {
          ...createEmptyDataMethodConfig(),
          operation: 'query',
          queryFields,
          pageParam: 'pageDto',
          conditionGroups: condGroup(
            ...idxCols.map((col) => {
              const field = columnNameToFieldName(col.name)
              return eqParamCondition(field, field, `pageBy_${idx.name}_${col.name}`)
            }),
            softCond,
          ),
        },
      ),
    )
  }

  methods.push(
    baseMethod(
      'preset_oneById',
      'oneById',
      '根据 ID 查询单条',
      [param(pkField, pkCol ? fieldValueType(pkCol) : numberType(), '主键')],
      entityType(entityId),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'query',
        queryFields,
        conditionGroups: condGroup(
          eqParamCondition(pkField, pkField, 'oneById'),
          softCond,
        ),
      },
    ),
  )

  methods.push(
    baseMethod(
      'preset_save',
      'save',
      '插入一条',
      [param('data', entityType(entityId), '实体')],
      numberType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'insert',
        fieldMappings: insertMappings,
      },
    ),
  )

  methods.push(
    baseMethod(
      'preset_saveBatch',
      'saveBatch',
      '插入多条',
      [param('items', entityArrayType(entityId), '实体列表')],
      numberArrayType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'batchInsert',
        batchSourceParam: 'items',
        fieldMappings: batchMappings,
      },
    ),
  )

  methods.push(
    baseMethod(
      'preset_updateById',
      'updateById',
      '根据 ID 修改',
      [
        param(pkField, numberType(), '主键'),
        param('data', entityType(entityId), '要更新的字段'),
      ],
      numberType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'update',
        fieldMappings: updateMappings,
        conditionGroups: condGroup(
          eqParamCondition(pkField, pkField, 'updateById'),
        ),
      },
    ),
  )

  const deleteDisabled = !logicDeleteCol
  const softDeleteSql = logicDeleteCol
    ? `UPDATE \${TABLE_NAME} SET \`${logicDeleteCol.name.replace(/`/g, '')}\` = 1 WHERE \`${(pkCol?.name || 'id').replace(/`/g, '')}\` = #{${pkField}}`
    : ''
  methods.push(
    baseMethod(
      'preset_deleteById',
      'deleteById',
      logicDeleteCol
        ? '根据 ID 逻辑删除'
        : '根据 ID 逻辑删除（未配置逻辑删除字段）',
      [param(pkField, numberType(), '主键')],
      numberType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'custom',
        sql: softDeleteSql,
      },
      deleteDisabled,
    ),
  )

  methods.push(
    baseMethod(
      'preset_hardDeleteById',
      'hardDeleteById',
      '根据 ID 彻底删除',
      [param(pkField, numberType(), '主键')],
      numberType(),
      {
        ...createEmptyDataMethodConfig(),
        operation: 'delete',
        conditionGroups: condGroup(
          eqParamCondition(pkField, pkField, 'hardDeleteById'),
        ),
      },
    ),
  )

  return methods
}

/** 合并预置与自定义方法：同名自定义覆盖预置；预置排在最下面 */
export function mergePresetAndCustomMethods(
  presets: ProcessorMethod[],
  custom: ProcessorMethod[],
): ProcessorMethod[] {
  const customNames = new Set(
    custom.map((m) => m.name.trim()).filter(Boolean),
  )
  const visiblePresets = presets.filter(
    (m) => !customNames.has(m.name.trim()),
  )
  return [...custom, ...visiblePresets]
}

export function findMethodIncludingPresets(
  customMethods: ProcessorMethod[],
  methodId: string,
  presets: ProcessorMethod[],
): ProcessorMethod | null {
  const fromCustom = customMethods.find((m) => m.id === methodId)
  if (fromCustom) return fromCustom
  return presets.find((m) => m.id === methodId && !m.disabled) ?? null
}
