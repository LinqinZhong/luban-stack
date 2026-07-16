import ts from 'typescript'
import {
  createEmptyDataType,
  createEmptyTypeExpr,
  isValidTypeName,
  type DataTypeDef,
  type EnumMember,
  type InterfaceField,
  type TypeAtom,
  type TypeExpr,
  type TypeGenericParam,
  type TypeUnion,
} from '../types/data-types'

export interface DataTypeTsContext {
  /** 类型 id → 显示名 */
  idToName: Map<string, string>
  /** 类型名 → id（库内已有类型） */
  nameToId: Map<string, string>
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function resolveName(id: string | undefined, ctx: DataTypeTsContext): string {
  if (!id) return 'unknown'
  return ctx.idToName.get(id) || id
}

function atomToTs(atom: TypeAtom, ctx: DataTypeTsContext): string {
  if (atom.kind === 'named') return resolveName(atom.ref, ctx)
  if (atom.kind === 'generic') return atom.ref || 'T'
  return atom.kind
}

export function typeExprToTs(expr: TypeExpr, ctx: DataTypeTsContext): string {
  if (!expr.intersections.length) return 'unknown'
  const parts = expr.intersections.map((union) => {
    const alts = union.alternatives.map((a) => atomToTs(a, ctx))
    const joined = alts.join(' | ')
    return alts.length > 1 && expr.intersections.length > 1 ? `(${joined})` : joined
  })
  return parts.join(' & ')
}

function remarkComment(remark: string): string {
  const text = remark.trim()
  if (!text) return ''
  if (text.includes('\n')) {
    return `  /**\n${text
      .split('\n')
      .map((l) => `   * ${l}`)
      .join('\n')}\n   */\n`
  }
  return `  /** ${text} */\n`
}

function genericsToTs(generics: TypeGenericParam[], ctx: DataTypeTsContext): string {
  if (!generics.length) return ''
  const inner = generics
    .map((g) => {
      let s = g.name || 'T'
      if (g.constraint) s += ` extends ${typeExprToTs(g.constraint, ctx)}`
      if (g.default) s += ` = ${typeExprToTs(g.default, ctx)}`
      return s
    })
    .join(', ')
  return `<${inner}>`
}

/** 结构 → TypeScript 源码 */
export function dataTypeToTs(def: DataTypeDef, ctx: DataTypeTsContext): string {
  const name = def.name.trim() || 'Unnamed'
  const headRemark = def.remark.trim()
    ? `/** ${def.remark.trim().replace(/\*\//g, '* /')} */\n`
    : ''

  if (def.kind === 'number' || def.kind === 'string' || def.kind === 'boolean') {
    return `${headRemark}type ${name} = ${def.kind}\n`
  }

  if (def.kind === 'combination') {
    return `${headRemark}type ${name} = ${typeExprToTs(def.combination, ctx)}\n`
  }

  if (def.kind === 'enum') {
    const body = def.enumMembers
      .map((m) => {
        const n = m.name.trim() || '_'
        if (m.value.trim()) {
          const v = m.value.trim()
          const lit = /^-?\d+(\.\d+)?$/.test(v) ? v : JSON.stringify(v)
          return `  ${n} = ${lit},`
        }
        return `  ${n},`
      })
      .join('\n')
    return `${headRemark}enum ${name} {\n${body}\n}\n`
  }

  // interface
  const gens = genericsToTs(def.generics, ctx)
  const fields = def.fields
    .map((f) => {
      const fname = f.name.trim() || '_'
      const opt = f.optional ? '?' : ''
      const ty = typeExprToTs(f.type, ctx)
      return `${remarkComment(f.remark)}  ${fname}${opt}: ${ty}`
    })
    .join('\n')
  return `${headRemark}interface ${name}${gens} {\n${fields}\n}\n`
}

/** 可编辑区：interface/enum 大括号内；type 别名等号后 */
export function extractDataTypeEditableBody(
  def: DataTypeDef,
  ctx: DataTypeTsContext,
): string {
  if (def.kind === 'interface' || def.kind === 'enum') {
    const full = dataTypeToTs(def, ctx)
    const start = full.indexOf('{')
    const end = full.lastIndexOf('}')
    if (start < 0 || end < 0 || end <= start) return ''
    return full
      .slice(start + 1, end)
      .replace(/^\n/, '')
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
      .join('\n')
  }
  const full = dataTypeToTs(def, ctx).trim()
  const eq = full.indexOf('=')
  return eq >= 0 ? full.slice(eq + 1).trim().replace(/;?\s*$/, '') : full
}

export function buildDataTypeLockedHeader(
  def: DataTypeDef,
  ctx: DataTypeTsContext,
): string {
  const name = def.name.trim() || 'Unnamed'
  const headRemark = def.remark.trim()
    ? `/** ${def.remark.trim().replace(/\*\//g, '* /')} */\n`
    : ''
  if (def.kind === 'interface') {
    return `${headRemark}interface ${name}${genericsToTs(def.generics, ctx)} {`
  }
  if (def.kind === 'enum') {
    return `${headRemark}enum ${name} {`
  }
  return `${headRemark}type ${name} =`
}

export function composeDataTypeTs(
  def: DataTypeDef,
  body: string,
  ctx: DataTypeTsContext,
): string {
  const header = buildDataTypeLockedHeader(def, ctx)
  if (def.kind === 'interface' || def.kind === 'enum') {
    const indented = (body ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => (line.length ? `  ${line}` : ''))
      .join('\n')
    return `${header}\n${indented}\n}\n`
  }
  const expr = (body ?? '').trim() || 'unknown'
  return `${header} ${expr}\n`
}

/** 生成 ambient，供 Monaco / 编译器识别其它类型 */
export function buildAmbientDeclarations(
  names: string[],
  excludeName?: string,
): string {
  const lines: string[] = []
  for (const name of names) {
    if (!name || name === excludeName) continue
    if (!isValidTypeName(name)) continue
    lines.push(`declare type ${name} = any`)
  }
  return lines.length ? `${lines.join('\n')}\n\n` : ''
}

const BUILTIN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'void',
  'null',
  'undefined',
  'never',
  'object',
  'symbol',
  'bigint',
  'true',
  'false',
])

function tsTypeToAtom(
  node: ts.TypeNode,
  ctx: DataTypeTsContext,
  generics: Set<string>,
  errors: string[],
): TypeAtom | null {
  if (ts.isParenthesizedTypeNode(node)) {
    return tsTypeToAtom(node.type, ctx, generics, errors)
  }
  if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' }
  if (node.kind === ts.SyntaxKind.NumberKeyword) return { kind: 'number' }
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' }
  if (node.kind === ts.SyntaxKind.AnyKeyword) return { kind: 'any' }
  if (node.kind === ts.SyntaxKind.UnknownKeyword) return { kind: 'unknown' }

  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text
    if (generics.has(name)) return { kind: 'generic', ref: name }
    const id = ctx.nameToId.get(name)
    if (!id) {
      errors.push(`类型「${name}」不存在`)
      return null
    }
    if (node.typeArguments?.length) {
      errors.push(`暂不支持带泛型实参的引用：${name}<...>`)
      return null
    }
    return { kind: 'named', ref: id }
  }

  errors.push(`不支持的类型写法：${node.getText()}`)
  return null
}

function tsTypeToExpr(
  node: ts.TypeNode,
  ctx: DataTypeTsContext,
  generics: Set<string>,
  errors: string[],
): TypeExpr | null {
  if (ts.isParenthesizedTypeNode(node)) {
    return tsTypeToExpr(node.type, ctx, generics, errors)
  }

  if (ts.isIntersectionTypeNode(node)) {
    const intersections: TypeUnion[] = []
    for (const part of node.types) {
      let unionNode = part
      if (ts.isParenthesizedTypeNode(part)) unionNode = part.type
      if (ts.isUnionTypeNode(unionNode)) {
        const alternatives: TypeAtom[] = []
        for (const alt of unionNode.types) {
          const atom = tsTypeToAtom(alt, ctx, generics, errors)
          if (!atom) return null
          alternatives.push(atom)
        }
        intersections.push({ alternatives })
      } else {
        const atom = tsTypeToAtom(part, ctx, generics, errors)
        if (!atom) return null
        intersections.push({ alternatives: [atom] })
      }
    }
    return { intersections }
  }

  if (ts.isUnionTypeNode(node)) {
    const alternatives: TypeAtom[] = []
    for (const alt of node.types) {
      const atom = tsTypeToAtom(alt, ctx, generics, errors)
      if (!atom) return null
      alternatives.push(atom)
    }
    return { intersections: [{ alternatives }] }
  }

  const atom = tsTypeToAtom(node, ctx, generics, errors)
  if (!atom) return null
  return { intersections: [{ alternatives: [atom] }] }
}

function parseGenericParams(
  params: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
  ctx: DataTypeTsContext,
  errors: string[],
): TypeGenericParam[] {
  if (!params?.length) return []
  const names = new Set(params.map((p) => p.name.text))
  const result: TypeGenericParam[] = []
  for (const p of params) {
    const name = p.name.text
    if (!isValidTypeName(name)) {
      errors.push(`泛型参数名不合法：${name}`)
      continue
    }
    let constraint: TypeExpr | null = null
    let def: TypeExpr | null = null
    if (p.constraint) {
      constraint = tsTypeToExpr(p.constraint, ctx, names, errors)
    }
    if (p.default) {
      def = tsTypeToExpr(p.default, ctx, names, errors)
    }
    result.push({
      id: uid('gen'),
      name,
      constraint,
      default: def,
    })
  }
  return result
}

function getJsDocRemark(node: ts.Node): string {
  const docs = (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc
  if (!docs?.length) return ''
  const texts = docs
    .map((d) => {
      if (typeof d.comment === 'string') return d.comment.trim()
      if (Array.isArray(d.comment)) {
        return d.comment
          .map((c) => ('text' in c ? String(c.text) : ''))
          .join('')
          .trim()
      }
      return ''
    })
    .filter(Boolean)
  return texts.join('\n')
}

export type ParseDataTypeResult =
  | { ok: true; def: DataTypeDef }
  | { ok: false; errors: string[] }

/**
 * 将 TS 源码解析为 DataTypeDef。
 * existing：保留 id；nameToId 不含自身时，自引用需临时加入。
 */
export function parseDataTypeFromTs(
  source: string,
  options: {
    existing: DataTypeDef
    ctx: DataTypeTsContext
  },
): ParseDataTypeResult {
  const errors: string[] = []
  const trimmed = source.trim()
  if (!trimmed) {
    return { ok: false, errors: ['代码不能为空'] }
  }

  const sf = ts.createSourceFile(
    'edit.ts',
    trimmed,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  // 语法错误
  const syntDiags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics
  if (syntDiags?.length) {
    for (const d of syntDiags) {
      errors.push(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    }
    return { ok: false, errors }
  }

  const statements = sf.statements.filter(
    (s) =>
      !(
        ts.isEmptyStatement(s) ||
        (ts.isExpressionStatement(s) &&
          s.expression.kind === ts.SyntaxKind.StringLiteral)
      ),
  )

  if (!statements.length) {
    return { ok: false, errors: ['未找到类型声明（interface / type / enum）'] }
  }
  if (statements.length > 1) {
    return { ok: false, errors: ['请只声明一个类型（不要写多个 interface/type/enum）'] }
  }

  const stmt = statements[0]!
  const base = createEmptyDataType('string')
  base.id = options.existing.id
  base.remark = getJsDocRemark(stmt) || options.existing.remark

  // 解析时允许自引用
  const selfName =
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt)
      ? stmt.name.text
      : ''
  const ctx: DataTypeTsContext = {
    idToName: new Map(options.ctx.idToName),
    nameToId: new Map(options.ctx.nameToId),
  }
  if (selfName) {
    ctx.nameToId.set(selfName, options.existing.id)
    ctx.idToName.set(options.existing.id, selfName)
  }

  if (ts.isInterfaceDeclaration(stmt)) {
    const name = stmt.name.text
    if (!isValidTypeName(name)) {
      return { ok: false, errors: [`类型名不合法：${name}`] }
    }
    if (stmt.heritageClauses?.length) {
      return { ok: false, errors: ['暂不支持 extends / implements'] }
    }
    const generics = parseGenericParams(stmt.typeParameters, ctx, errors)
    const genericNames = new Set(generics.map((g) => g.name))
    const fields: InterfaceField[] = []
    for (const member of stmt.members) {
      if (!ts.isPropertySignature(member)) {
        errors.push(`暂不支持的接口成员：${member.getText(sf)}`)
        continue
      }
      const fname =
        member.name && ts.isIdentifier(member.name)
          ? member.name.text
          : member.name?.getText(sf) || ''
      if (!fname || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(fname)) {
        errors.push(`字段名不合法：${fname || '?'}`)
        continue
      }
      if (!member.type) {
        errors.push(`字段「${fname}」缺少类型`)
        continue
      }
      const typeExpr = tsTypeToExpr(member.type, ctx, genericNames, errors)
      if (!typeExpr) continue
      fields.push({
        id: uid('field'),
        name: fname,
        type: typeExpr,
        remark: getJsDocRemark(member),
        optional: Boolean(member.questionToken),
      })
    }
    if (errors.length) return { ok: false, errors }

    base.kind = 'interface'
    base.name = name
    base.generics = generics
    base.fields = fields
    base.enumMembers = []
    base.combination = createEmptyTypeExpr()
    return { ok: true, def: base }
  }

  if (ts.isEnumDeclaration(stmt)) {
    const name = stmt.name.text
    if (!isValidTypeName(name)) {
      return { ok: false, errors: [`类型名不合法：${name}`] }
    }
    const enumMembers: EnumMember[] = []
    for (const m of stmt.members) {
      const mname = m.name.getText(sf)
      if (!isValidTypeName(mname)) {
        errors.push(`枚举成员名不合法：${mname}`)
        continue
      }
      let value = ''
      if (m.initializer) {
        if (ts.isStringLiteral(m.initializer) || ts.isNoSubstitutionTemplateLiteral(m.initializer)) {
          value = m.initializer.text
        } else if (ts.isNumericLiteral(m.initializer)) {
          value = m.initializer.text
        } else if (
          ts.isPrefixUnaryExpression(m.initializer) &&
          m.initializer.operator === ts.SyntaxKind.MinusToken &&
          ts.isNumericLiteral(m.initializer.operand)
        ) {
          value = `-${m.initializer.operand.text}`
        } else {
          errors.push(`枚举成员「${mname}」的值仅支持字符串或数字字面量`)
          continue
        }
      }
      enumMembers.push({ id: uid('enum'), name: mname, value })
    }
    if (errors.length) return { ok: false, errors }
    base.kind = 'enum'
    base.name = name
    base.enumMembers = enumMembers
    base.fields = []
    base.generics = []
    base.combination = createEmptyTypeExpr()
    return { ok: true, def: base }
  }

  if (ts.isTypeAliasDeclaration(stmt)) {
    const name = stmt.name.text
    if (!isValidTypeName(name)) {
      return { ok: false, errors: [`类型名不合法：${name}`] }
    }
    if (stmt.typeParameters?.length) {
      return { ok: false, errors: ['type 别名暂不支持泛型，请改用 interface'] }
    }
    const typeNode = stmt.type
    // 简单原始类型
    if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
      base.kind = 'string'
      base.name = name
      return { ok: true, def: base }
    }
    if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
      base.kind = 'number'
      base.name = name
      return { ok: true, def: base }
    }
    if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
      base.kind = 'boolean'
      base.name = name
      return { ok: true, def: base }
    }

    const expr = tsTypeToExpr(typeNode, ctx, new Set(), errors)
    if (errors.length || !expr) return { ok: false, errors: errors.length ? errors : ['无法解析类型'] }

    base.kind = 'combination'
    base.name = name
    base.combination = expr
    base.fields = []
    base.generics = []
    base.enumMembers = []
    return { ok: true, def: base }
  }

  return {
    ok: false,
    errors: ['仅支持 interface / type / enum 声明'],
  }
}

/** 语法校验（transpile 诊断） */
export function validateTypeScriptSyntax(source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
    },
    reportDiagnostics: true,
  })
  const errors: string[] = []
  for (const d of result.diagnostics ?? []) {
    errors.push(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  }
  return errors
}

/** 收集源码中引用到的自定义类型名（排除内置与泛型） */
export function collectReferencedTypeNames(
  source: string,
  genericNames: string[] = [],
): string[] {
  const sf = ts.createSourceFile(
    'refs.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const gens = new Set(genericNames)
  const names = new Set<string>()

  const visit = (node: ts.Node) => {
    if (ts.isTypeParameterDeclaration(node)) {
      gens.add(node.name.text)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const n = node.typeName.text
      if (!BUILTIN_TYPES.has(n) && !gens.has(n)) names.add(n)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...names]
}

export function buildDataTypeTsContext(library: {
  groups: Array<{ types: Array<{ id: string; name: string }> }>
}): DataTypeTsContext {
  const idToName = new Map<string, string>()
  const nameToId = new Map<string, string>()
  for (const g of library.groups) {
    for (const t of g.types) {
      const name = t.name.trim()
      if (!name) continue
      idToName.set(t.id, name)
      nameToId.set(name, t.id)
    }
  }
  return { idToName, nameToId }
}
