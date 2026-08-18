import type {
  DataTypeDef,
  DataTypeLibrary,
  TypeAtom,
  TypeExpr,
} from '../types/data-types.js'

function findTypeDef(
  library: DataTypeLibrary | null | undefined,
  id: string,
): DataTypeDef | null {
  const key = id.trim()
  if (!key || !library) return null
  for (const group of library.groups ?? []) {
    const hit = group.types.find((t) => t.id === key || t.name === key)
    if (hit) return hit
  }
  return null
}

function primaryAtom(expr: TypeExpr | undefined | null): TypeAtom {
  return expr?.intersections?.[0]?.alternatives?.[0] ?? { kind: 'any' }
}

export type HttpResponseAny = {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** 松解析响应正文：能 JSON 则 JSON，否则原文；空为 null */
export function looseParseHttpBodyText(bodyText: string): unknown {
  const raw = bodyText ?? ''
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * 按 interface 定义把字段全部列出来：有值取响应里的，缺省为 null。
 * 数组则对每个元素投影；嵌套 interface / interface[] 递归。
 */
export function projectInterfaceBody(
  body: unknown,
  def: DataTypeDef,
  library?: DataTypeLibrary | null,
  depth = 0,
): unknown {
  if (depth > 8) return body === undefined ? null : body

  if (Array.isArray(body)) {
    return body.map((item) =>
      projectInterfaceBody(item, def, library, depth + 1),
    )
  }

  const src =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null

  const out: Record<string, unknown> = {}
  for (const f of def.fields ?? []) {
    const name = (f.name ?? '').trim()
    if (!name) continue
    const raw =
      src && Object.prototype.hasOwnProperty.call(src, name)
        ? src[name]
        : undefined
    const atom = primaryAtom(f.type)

    if (atom.kind === 'named' && atom.ref) {
      const nested = findTypeDef(library, atom.ref)
      if (nested?.kind === 'interface') {
        out[name] = projectInterfaceBody(
          raw === undefined ? null : raw,
          nested,
          library,
          depth + 1,
        )
        continue
      }
    }

    if (atom.kind === 'array' && atom.item?.kind === 'named' && atom.item.ref) {
      const nested = findTypeDef(library, atom.item.ref)
      if (nested?.kind === 'interface') {
        if (raw == null) {
          out[name] = []
        } else if (Array.isArray(raw)) {
          out[name] = raw.map((item) =>
            projectInterfaceBody(item, nested, library, depth + 1),
          )
        } else {
          out[name] = null
        }
        continue
      }
    }

    out[name] = raw === undefined ? null : raw
  }
  return out
}

/**
 * 将 body 映射到出参泛型 T。
 * - interface：按类型字段全部列出（缺失为 null），不再整包打成 null
 * - T 为空 / any：保留原值（undefined → null）
 */
export function mapHttpBodyToGeneric(
  body: unknown,
  genericT: string,
  library?: DataTypeLibrary | null,
): unknown {
  const t = genericT.trim()
  if (!t || t === 'any') {
    return body === undefined ? null : body
  }
  if (t === 'string') {
    return typeof body === 'string' ? body : null
  }
  if (t === 'number') {
    return typeof body === 'number' && Number.isFinite(body) ? body : null
  }
  if (t === 'boolean') {
    return typeof body === 'boolean' ? body : null
  }

  const def = findTypeDef(library, t)
  if (!def) {
    if (body == null) return null
    if (typeof body === 'object') return body
    return null
  }

  if (def.kind === 'enum') {
    if (body == null) return null
    const asStr = String(body)
    const hit = (def.enumMembers ?? []).some(
      (m) => m.name === asStr || m.value === asStr || m.value === String(body),
    )
    return hit ? body : null
  }

  if (def.kind === 'interface') {
    return projectInterfaceBody(body, def, library)
  }

  return body == null ? null : body
}

/** 执行用户配置的 parse 方法体 */
export function runHttpResponseParse(
  parseCode: string,
  response: HttpResponseAny,
): HttpResponseAny {
  const body = parseCode.trim()
  if (!body) return response
  try {
    const hasReturn = /\breturn\b/.test(body)
    const inner = hasReturn ? body : `return (${body});`
    const code = `"use strict";\nfunction parse(response) {\n${inner}\n}\nreturn parse(response);`
    // eslint-disable-next-line no-new-func
    const fn = new Function('response', code)
    const result = fn(response)
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return response
    }
    const row = result as Record<string, unknown>
    const status = Number(row.status)
    const headersRaw = row.headers
    const headers: Record<string, string> = {}
    if (headersRaw instanceof Map) {
      headersRaw.forEach((v, k) => {
        headers[String(k)] = v == null ? '' : String(v)
      })
    } else if (headersRaw && typeof headersRaw === 'object') {
      for (const [k, v] of Object.entries(headersRaw as Record<string, unknown>)) {
        headers[k] = v == null ? '' : String(v)
      }
    } else {
      Object.assign(headers, response.headers)
    }
    return {
      status: Number.isFinite(status) ? status : response.status,
      headers,
      body: Object.prototype.hasOwnProperty.call(row, 'body')
        ? row.body
        : response.body,
    }
  } catch (err) {
    throw new Error(
      `外部接口响应解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export function buildHttpMethodOutput(options: {
  status: number
  headers: Record<string, string>
  bodyText: string
  parseCode?: string
  bodyGenericT?: string
  typeLibrary?: DataTypeLibrary | null
}): HttpResponseAny {
  const raw: HttpResponseAny = {
    status: options.status,
    headers: { ...options.headers },
    body: looseParseHttpBodyText(options.bodyText),
  }
  const parsed = runHttpResponseParse(options.parseCode ?? '', raw)
  return {
    status: parsed.status,
    headers: parsed.headers,
    body: mapHttpBodyToGeneric(
      parsed.body,
      options.bodyGenericT ?? '',
      options.typeLibrary,
    ),
  }
}
