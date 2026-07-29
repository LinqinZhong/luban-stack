import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/** 导出/构建清理时永不删除的依赖与缓存 */
export const OUTPUT_CLEAN_KEEP = new Set([
  '.git',
  'node_modules',
  'dist',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
])

/**
 * 清空目录内源码等文件，但：
 * - 保留目录本身
 * - 永不删除 node_modules / dist / 锁文件
 * - 子目录若仍含保留项，不整目录 rm（避免把 node_modules 一并删掉）
 */
export async function emptyDirPreserveDeps(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (OUTPUT_CLEAN_KEEP.has(ent.name)) continue
    const target = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await emptyDirPreserveDeps(target)
      let left: string[]
      try {
        left = await readdir(target)
      } catch {
        continue
      }
      // 还有 node_modules 等保留项：留下该目录壳
      if (left.length > 0) continue
      try {
        await rm(target, { recursive: true, force: true })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err
      }
    } else {
      try {
        await rm(target, { force: true })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'EBUSY' && code !== 'EPERM') throw err
      }
    }
  }
}
