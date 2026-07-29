import type { ServiceApi } from '../../../types/backend-services.js'
import { safeIdent } from './names.js'

export interface RouteEmitInput {
  httpMethod: string
  httpPath: string
  moduleSlug: string
  resourceSlug: string
  controllerExport: string
  apiMethodName: string
  api: ServiceApi
}

/** /goods/page → src/app/goods/page/route.ts */
export function httpPathToAppRouteFile(httpPath: string): string {
  const parts = httpPath
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return 'src/app/route.ts'
  return `src/app/${parts.join('/')}/route.ts`
}

function parseInputExpr(inp: {
  varName: string
  location: string
  type: string
  required: boolean
}): string {
  const loc = (inp.location || 'query').toLowerCase()
  const from =
    loc === 'body'
      ? `body[${JSON.stringify(inp.varName)}]`
      : `query[${JSON.stringify(inp.varName)}]`

  if (inp.type === 'number') {
    return `Number(${from})`
  }
  if (inp.type === 'boolean') {
    return `String(${from}) === 'true' || ${from} === true`
  }
  if (inp.type === 'json') {
    return `parseMaybeJson(${from}) as never`
  }
  // optional string defaults to ''
  if (!inp.required) {
    return `((parseMaybeJson(${from}) as string | undefined) ?? '')`
  }
  return `(parseMaybeJson(${from}) as string)`
}

export function emitRouteFile(route: RouteEmitInput): string {
  const method = route.httpMethod.toUpperCase()
  const exportName = method === 'DELETE' ? 'DELETE' : method

  const inputs = route.api.inputs ?? []
  const argLines = inputs.map((inp) => {
    const name = safeIdent(inp.varName, 'input')
    const expr = parseInputExpr(inp)
    if (inp.required) {
      return `    const ${name} = ${expr}
    if (${name} === undefined || ${name} === null || ${name} === '') {
      throw new HttpError(400, ${JSON.stringify(`${inp.varName}不能为空`)})
    }`
    }
    return `    const ${name} = ${expr}`
  })

  const callArgs = inputs
    .map((inp) => safeIdent(inp.varName, 'input'))
    .join(', ')

  return `import { NextResponse } from 'next/server'
import { ${route.controllerExport} } from '@/modules/${route.moduleSlug}/${route.resourceSlug}/${route.resourceSlug}.controller'
import { success, fail } from '@/common/result'
import { HttpError, parseMaybeJson, readBody, readQuery } from '@/common/http'

export const runtime = 'nodejs'

export async function ${exportName}(req: Request) {
  try {
    const query = readQuery(req)
    const body = await readBody(req)
${argLines.join('\n')}
    const data = await ${route.controllerExport}.${route.apiMethodName}(${callArgs})
    return NextResponse.json(success(data))
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(fail(err.message, err.status), { status: err.status })
    }
    console.error(${JSON.stringify(`[${method} ${route.httpPath}]`)}, err)
    return NextResponse.json(
      fail(err instanceof Error ? err.message : '内部错误'),
      { status: 500 },
    )
  }
}
`
}

/** 合并同一 path 上多个 method 到一个 route.ts */
export function emitMergedRouteFiles(
  routes: RouteEmitInput[],
): Record<string, string> {
  const byFile = new Map<string, RouteEmitInput[]>()
  for (const r of routes) {
    const file = httpPathToAppRouteFile(r.httpPath)
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file)!.push(r)
  }

  const files: Record<string, string> = {}
  for (const [file, list] of byFile) {
    if (list.length === 1) {
      files[file] = emitRouteFile(list[0]!)
      continue
    }
    // Multiple methods on same path
    const first = list[0]!
    const imports = new Set<string>()
    imports.add(
      `import { NextResponse } from 'next/server'`,
    )
    imports.add(`import { success, fail } from '@/common/result'`)
    imports.add(
      `import { HttpError, parseMaybeJson, readBody, readQuery } from '@/common/http'`,
    )
    for (const r of list) {
      imports.add(
        `import { ${r.controllerExport} } from '@/modules/${r.moduleSlug}/${r.resourceSlug}/${r.resourceSlug}.controller'`,
      )
    }

    const handlers = list.map((r) => {
      const method = r.httpMethod.toUpperCase()
      const exportName = method === 'DELETE' ? 'DELETE' : method
      const inputs = r.api.inputs ?? []
      const argLines = inputs.map((inp) => {
        const name = safeIdent(inp.varName, 'input')
        const expr = parseInputExpr(inp)
        if (inp.required) {
          return `    const ${name} = ${expr}
    if (${name} === undefined || ${name} === null || ${name} === '') {
      throw new HttpError(400, ${JSON.stringify(`${inp.varName}不能为空`)})
    }`
        }
        return `    const ${name} = ${expr}`
      })
      const callArgs = inputs
        .map((inp) => safeIdent(inp.varName, 'input'))
        .join(', ')
      return `export async function ${exportName}(req: Request) {
  try {
    const query = readQuery(req)
    const body = await readBody(req)
${argLines.join('\n')}
    const data = await ${r.controllerExport}.${r.apiMethodName}(${callArgs})
    return NextResponse.json(success(data))
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(fail(err.message, err.status), { status: err.status })
    }
    console.error(${JSON.stringify(`[${method} ${r.httpPath}]`)}, err)
    return NextResponse.json(
      fail(err instanceof Error ? err.message : '内部错误'),
      { status: 500 },
    )
  }
}`
    })

    files[file] = `${[...imports].join('\n')}

export const runtime = 'nodejs'

${handlers.join('\n\n')}
`
  }
  return files
}
