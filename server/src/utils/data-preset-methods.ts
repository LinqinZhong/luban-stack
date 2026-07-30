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
} from '../types/backend-services.js'
import type { DataTypeDef } from '../types/data-types.js'
import type { MysqlColumnDef, MysqlIndexDef } from '../types/mysql.js'
import { snakeToCamel } from './sql-naming.js'

function isMysqlNumericColumnType(mysqlType: string): boolean {
  const t = mysqlType.trim().toLowerCase()
  if (!t) return false
  return (
    /^(tiny|small|medium|big)?int\b/.test(t) ||
    /^integer\b/.test(t) ||
    /^bigint\b/.test(t) ||
    /^float\b/.test(t) ||
    /^double\b/.test(t) ||
    /^real\b/.test(t) ||
    /^decimal\b/.test(t) ||
    /^numeric\b/.test(t) ||
    /^dec\b/.test(t) ||
    /^bit\b/.test(t) ||
    /^year\b/.test(t) ||
    t === 'bool' ||
    t === 'boolean'
  )
}

export const PRESET_METHOD_ID_PREFIX = 'preset_'

/** ?????????????????? ByXxx? */
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

/** ????? ByXxx ???? UserIdAndStatus */
export function indexBySuffix(
  index: MysqlIndexDef,
  columns: MysqlColumnDef[],
): string {
  const parts: string[] = []
  for (const colName of index.columns) {
    const col = columns.find((c) => c.name === colName)
    if (!col || col.primaryKey) continue
    parts.push(capitalize(snakeToCamel(col.name)))
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

/** ???????????????? countByXxx / pageByXxx? */
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
  const field = snakeToCamel(logicDeleteCol.name)
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
      const field = snakeToCamel(col.name)
      return `\`${col.name.replace(/`/g, '')}\` = #{${field}}`
    })
    .join(' AND ')
}

/**
 * ???? + ?? / ????????????????
 * ????????????????
 */
export function buildPresetMethods(options: {
  entity: DataTypeDef | null | undefined
  columns: MysqlColumnDef[]
  indexes?: MysqlIndexDef[]
}): ProcessorMethod[] {
  const { entity, columns, indexes = [] } = options
  if (!entity?.id) return []

  const entityId = entity.id
  const logicDeleteCol = columns.find((c) => c.logicDelete)
  const pkCol =
    columns.find((c) => c.primaryKey) ||
    columns.find((c) => c.name.toLowerCase() === 'id')
  const pkField = pkCol ? snakeToCamel(pkCol.name) : 'id'

  const entityFieldNames =
    entity.kind === 'interface'
      ? entity.fields.map((f) => f.name).filter(Boolean)
      : columns.map((c) => snakeToCamel(c.name))

  const queryFields = entityFieldNames.length
    ? entityFieldNames
    : columns.map((c) => snakeToCamel(c.name))

  const insertableCols = columns.filter((c) => !(c.primaryKey && c.autoIncrement))
  const insertMappings = insertableCols.map((c) => {
    const field = snakeToCamel(c.name)
    return { field, column: `data.${field}` }
  })
  const batchMappings = insertableCols.map((c) => {
    const field = snakeToCamel(c.name)
    return { field, column: `items.${field}` }
  })
  const updateMappings = columns
    .filter((c) => !c.primaryKey && !c.logicDelete)
    .map((c) => {
      const field = snakeToCamel(c.name)
      return { field, column: `data.${field}` }
    })

  const softCond = softDeleteCondition(logicDeleteCol)
  const methods: ProcessorMethod[] = []

  methods.push(
    baseMethod(
      'preset_count',
      'count',
      '?????',
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
    const fieldLabels = idxCols.map((c) => snakeToCamel(c.name)).join(', ')
    methods.push(
      baseMethod(
        `preset_countBy_${idx.name}`,
        `countBy${by}`,
        idx.remark?.trim() || `? ${fieldLabels} ?????`,
        idxCols.map((col) => {
          const field = snakeToCamel(col.name)
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
      '????',
      [param('pageDto', pageDtoType(), '????')],
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
    const fieldLabels = idxCols.map((c) => snakeToCamel(c.name)).join(', ')
    methods.push(
      baseMethod(
        `preset_pageBy_${idx.name}`,
        `pageBy${by}`,
        idx.remark?.trim() || `? ${fieldLabels} ????`,
        [
          param('pageDto', pageDtoType(), '????'),
          ...idxCols.map((col) => {
            const field = snakeToCamel(col.name)
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
              const field = snakeToCamel(col.name)
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
      '?? ID ????',
      [param(pkField, pkCol ? fieldValueType(pkCol) : numberType(), '??')],
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
      '????',
      [param('data', entityType(entityId), '??')],
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
      '????',
      [param('items', entityArrayType(entityId), '????')],
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
      '?? ID ??',
      [
        param(pkField, numberType(), '??'),
        param('data', entityType(entityId), '??????'),
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
        ? '?? ID ????'
        : '?? ID ???????????????',
      [param(pkField, numberType(), '??')],
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
      '?? ID ????',
      [param(pkField, numberType(), '??')],
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

/** ???????????????????????????? */
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
