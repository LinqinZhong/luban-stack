import ts from 'typescript'
import { validateTypeScriptSyntax } from './data-type-ts'

export type SingleLetDeclOk = {
  ok: true
  varName: string
  /** 初始值表达式源码（不含 let / 变量名） */
  initExpr: string
  /** 类型注解源码（若有），如 QueryPageVo<GoodsItem> */
  typeText?: string
}

export type SingleLetDeclFail = {
  ok: false
  errors: string[]
}

export type SingleLetDeclResult = SingleLetDeclOk | SingleLetDeclFail

/**
 * 校验并解析「仅一条 let 声明」：
 * `let name = expr` 或 `let name: Type = expr`
 * 不允许解构、const/var、多语句、其它语法。
 */
export function parseSingleLetDeclaration(source: string): SingleLetDeclResult {
  const text = source.replace(/^\uFEFF/, '').trim()
  if (!text) {
    return { ok: false, errors: ['请填写变量定义'] }
  }

  const syntaxErrors = validateTypeScriptSyntax(text)
  if (syntaxErrors.length) {
    return { ok: false, errors: syntaxErrors }
  }

  const sf = ts.createSourceFile(
    'single-let.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  if (sf.statements.length !== 1) {
    return {
      ok: false,
      errors: ['只允许一条 let 变量声明，不能包含其它语句或语法'],
    }
  }

  const stmt = sf.statements[0]!
  if (!ts.isVariableStatement(stmt)) {
    return { ok: false, errors: ['只允许 let 变量声明'] }
  }

  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return { ok: false, errors: ['不允许 export'] }
  }

  const list = stmt.declarationList
  if (list.flags & ts.NodeFlags.Const) {
    return { ok: false, errors: ['请使用 let，不要使用 const'] }
  }
  if (!(list.flags & ts.NodeFlags.Let)) {
    return { ok: false, errors: ['请使用 let 声明变量（不要使用 var）'] }
  }

  if (list.declarations.length !== 1) {
    return { ok: false, errors: ['一次只允许定义一个变量'] }
  }

  const decl = list.declarations[0]!
  if (!ts.isIdentifier(decl.name)) {
    return { ok: false, errors: ['只支持简单变量名，不支持解构'] }
  }

  const varName = decl.name.text.trim()
  if (!varName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
    return { ok: false, errors: ['变量名须为合法标识符'] }
  }

  if (!decl.initializer) {
    return { ok: false, errors: ['必须提供初始值'] }
  }

  const initExpr = decl.initializer.getText(sf).trim()
  if (!initExpr) {
    return { ok: false, errors: ['初始值不能为空'] }
  }

  const typeText = decl.type ? decl.type.getText(sf).trim() : undefined
  return {
    ok: true,
    varName,
    initExpr,
    ...(typeText ? { typeText } : {}),
  }
}

/** 组装单条 let 声明源码（可带类型注解） */
export function composeSingleLetDeclaration(
  varName: string,
  initExpr: string,
  typeTs?: string,
): string {
  const name = varName.trim() || 'value'
  const init = (initExpr ?? '').trim() || 'null'
  const type = (typeTs ?? '').trim()
  if (type) return `let ${name}: ${type} = ${init}`
  return `let ${name} = ${init}`
}
