import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface NestJsScaffoldContext {
  projectName: string
  /** @deprecated 保留兼容；连接信息已写入 .env.* */
  defaultMysqlId: string
  routes: Array<{
    method: string
    path: string
    name: string
    serviceName: string
  }>
  /** 如 ShopModule */
  rootModuleImports: Array<{ className: string; importPath: string }>
  /** 按环境生成的 .env 文件内容 */
  envFiles: {
    example: string
    development: string
    production: string
  }
  /** 是否生成并挂载 OssModule；默认 true */
  includeOss?: boolean
}

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'templates',
)

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'backend'
}

async function readTemplate(name: string): Promise<string> {
  return readFile(path.join(TEMPLATES_DIR, name), 'utf-8')
}

export async function scaffoldNestJsFiles(
  ctx: NestJsScaffoldContext,
): Promise<Record<string, string>> {
  const includeOss = ctx.includeOss !== false
  const files: Record<string, string> = {}
  const pkgName = slugify(ctx.projectName)
  const templateReads = [
    readTemplate('data-method.ts'),
    readTemplate('db.ts'),
  ] as const
  const [dataMethodTpl, dbTpl, ossTpl] = await Promise.all([
    ...templateReads,
    includeOss ? readTemplate('oss.ts') : Promise.resolve(''),
  ])

  files['package.json'] = `${JSON.stringify(
    {
      name: pkgName,
      private: true,
      version: '0.1.0',
      scripts: {
        build: 'nest build',
        start: 'nest start',
        'start:dev': 'cross-env NODE_ENV=development nest start --watch',
        'start:prod': 'cross-env NODE_ENV=production node dist/main.js',
      },
      dependencies: {
        '@aws-sdk/client-s3': '^3.1095.0',
        '@aws-sdk/s3-request-presigner': '^3.1095.0',
        '@nestjs/common': '^11.0.1',
        '@nestjs/core': '^11.0.1',
        '@nestjs/platform-express': '^11.0.1',
        dotenv: '^16.4.7',
        mysql2: '^3.23.0',
        'reflect-metadata': '^0.2.2',
        rxjs: '^7.8.1',
      },
      devDependencies: {
        '@nestjs/cli': '^11.0.0',
        '@nestjs/schematics': '^11.0.0',
        '@types/express': '^5.0.0',
        '@types/node': '^22.10.0',
        'cross-env': '^7.0.3',
        typescript: '^5.7.0',
      },
    },
    null,
    2,
  )}\n`

  files['nest-cli.json'] = `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/nest-cli',
      collection: '@nestjs/schematics',
      sourceRoot: 'src',
      compilerOptions: { deleteOutDir: true },
    },
    null,
    2,
  )}\n`

  files['tsconfig.json'] = `${JSON.stringify(
    {
      compilerOptions: {
        module: 'commonjs',
        declaration: true,
        removeComments: true,
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
        allowSyntheticDefaultImports: true,
        target: 'ES2021',
        sourceMap: true,
        outDir: './dist',
        baseUrl: './',
        incremental: true,
        skipLibCheck: true,
        strictNullChecks: true,
        noImplicitAny: false,
        strictBindCallApply: false,
        forceConsistentCasingInFileNames: false,
        noFallthroughCasesInSwitch: false,
        esModuleInterop: true,
        paths: { '@/*': ['src/*'] },
      },
      include: ['src/**/*'],
    },
    null,
    2,
  )}\n`

  files['tsconfig.build.json'] = `${JSON.stringify(
    {
      extends: './tsconfig.json',
      exclude: ['node_modules', 'dist', 'test', '**/*spec.ts'],
    },
    null,
    2,
  )}\n`

  files['.env.example'] = ctx.envFiles.example
  files['.env.development'] = ctx.envFiles.development
  files['.env.production'] = ctx.envFiles.production

  files['.gitignore'] = `node_modules
dist
.env
.env.local
.env.development
.env.production
.env.*.local
*.log
`

  files['config/routes-manifest.json'] = `${JSON.stringify(
    { routes: ctx.routes },
    null,
    2,
  )}\n`

  files['README.md'] = `# ${ctx.projectName} · NestJS 后端

独立 NestJS 工程（由设计器导出）。

## 目录

\`\`\`text
src/
  main.ts / app.module.ts
  modules/{服务}/{资源}/
  common/                  # db、result、oss、data-method
  types/
config/
  routes-manifest.json     # 路由清单（非密钥）
.env.example
.env.development           # 开发/测试库（gitignore）
.env.production            # 生产库（gitignore，有则导出）
\`\`\`

## 环境变量

MySQL / OSS 凭据写在 \`.env.*\`，按 \`NODE_ENV\` 加载：

| 脚本 | NODE_ENV | 加载文件 |
|------|----------|----------|
| \`npm run start:dev\` | development | \`.env.development\` |
| \`npm run start:prod\` | production | \`.env.production\` |

开发/测试使用项目里的 **testMysqlId**（及测试 OSS）；生产使用 **productionMysqlId**（及名称含「生产」的 OSS，若有）。

## 启动

\`\`\`bash
npm install
npm run start:dev
\`\`\`

默认 \`http://127.0.0.1:3030\`。

${includeOss ? 'OSS 签名：`POST /oss/sign`\n' : ''}## 已导出路由（${ctx.routes.length}）

${
  ctx.routes.length
    ? ctx.routes
        .map(
          (r) =>
            `- \`${r.method} ${r.path}\` · ${r.name}（${r.serviceName}）`,
        )
        .join('\n')
    : '_暂无控制器 API_'
}
`

  files['src/main.ts'] = `import 'reflect-metadata'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

function loadEnvFiles() {
  const root = process.cwd()
  const nodeEnv = process.env.NODE_ENV || 'development'
  const candidates = [
    path.join(root, '.env'),
    path.join(root, \`.env.\${nodeEnv}\`),
    path.join(root, '.env.local'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    loadEnv({ path: file, override: true })
  }
}

async function bootstrap() {
  loadEnvFiles()
  const app = await NestFactory.create(AppModule)
  app.enableCors()
  const port = Number(process.env.PORT) || 3030
  await app.listen(port)
  console.log(
    \`NestJS backend listening on http://127.0.0.1:\${port} (NODE_ENV=\${process.env.NODE_ENV || 'development'})\`,
  )
}
bootstrap()
`

  const moduleImports = ctx.rootModuleImports
    .map((m) => `import { ${m.className} } from '${m.importPath}'`)
    .join('\n')
  const moduleList = [
    ...ctx.rootModuleImports.map((m) => m.className),
    ...(includeOss ? ['OssModule'] : []),
  ].join(',\n    ')

  files['src/app.module.ts'] = `import { Module } from '@nestjs/common'
${moduleImports}${includeOss ? `\nimport { OssModule } from './modules/oss/oss.module'` : ''}

@Module({
  imports: [
    ${moduleList}
  ],
})
export class AppModule {}
`

  files['src/common/result.ts'] = `export interface Result<T = unknown> {
  code: number
  message: string
  error: string
  data: T
}

export function success<T>(data: T): Result<T> {
  return { code: 200, message: 'ok', error: '', data }
}

export function fail(message: string, code = 500): Result<null> {
  return { code, message, error: message, data: null }
}
`

  files['src/common/http.ts'] = `export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  if (!t) return value
  if (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  ) {
    try {
      return JSON.parse(t)
    } catch {
      return value
    }
  }
  return value
}
`

  files['src/common/db.ts'] = dbTpl

  files['src/common/data-method.ts'] = dataMethodTpl
  if (includeOss) {
    files['src/common/oss.ts'] = ossTpl

    files['src/modules/oss/oss.controller.ts'] = `import { Body, Controller, Post } from '@nestjs/common'
import { success, type Result } from '../../common/result'
import { signOssObject } from '../../common/oss'

@Controller('oss')
export class OssController {
  @Post('sign')
  async sign(
    @Body()
    body: {
      connectionId?: string
      bucketName?: string
      key?: string
      objectKey?: string
      expiresIn?: number
    },
  ): Promise<Result> {
    const DEFAULT_EXPIRES = 7 * 24 * 3600
    const expiresIn =
      body.expiresIn != null
        ? Number(body.expiresIn)
        : process.env.OSS_SIGN_EXPIRES_IN
          ? Number(process.env.OSS_SIGN_EXPIRES_IN)
          : DEFAULT_EXPIRES

    const data = await signOssObject({
      connectionId: String(body.connectionId ?? ''),
      bucketName: String(body.bucketName ?? ''),
      key: String(body.key ?? body.objectKey ?? ''),
      expiresIn,
    })
    return success(data)
  }
}
`

    files['src/modules/oss/oss.module.ts'] = `import { Module } from '@nestjs/common'
import { OssController } from './oss.controller'

@Module({
  controllers: [OssController],
})
export class OssModule {}
`
  }

  return files
}
