import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DOC_FILES = [
  'README.md',
  '01-project-structure.md',
  '02-pages.md',
  '03-xml-widgets.md',
  '04-xml-attributes.md',
  '05-components-and-slots.md',
  '06-data-pool.md',
  '07-bindings-and-expressions.md',
  '08-methods-and-events.md',
  '09-services-for-frontend.md',
  '10-types-library.md',
  '11-theming-assets.md',
  '12-usage-overview.md',
]

function docsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../../../docs')
}

let cached: string | null = null

/** 组装平台能力说明（非业务项目文件），供 AI 系统提示使用。 */
export async function loadAiDocsPrompt(): Promise<string> {
  if (cached) return cached
  const root = docsRoot()
  const chunks: string[] = [
    '以下是 LubanStack 平台能力与概念说明（必须遵守）。',
    '这些是平台规则，不是当前业务项目的文件内容。',
    '你无法浏览项目磁盘；查询与修改当前项目只能通过工具/接口。',
    '规则里若提到「文件夹 / 配置 / 页面结构」，指平台对象模型，不要理解为你可以打开某个路径。',
    '',
  ]
  for (const file of DOC_FILES) {
    try {
      const text = await fs.readFile(path.join(root, file), 'utf8')
      chunks.push(`## 平台说明：${file.replace(/\.md$/i, '')}`, text.trim(), '')
    } catch {
      // 单个文档缺失时跳过
    }
  }
  cached = chunks.join('\n')
  return cached
}
