// Prints what the PowerPoint inspector reads from a .pptx.
//   npx tsx scripts/inspect-pptx.ts <file.pptx> [--json] [--images <dir>]
// --images names each picture after the image in <dir> it is (every png,
// jpg, jpeg, gif and webp there, named by file name without the extension).
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { describePresentation } from '@/lib/pptx/describe'
import { PptxInspectError, inspectPptx } from '@/lib/pptx/inspect'
import { knownImagesFromFiles } from '@/lib/pptx/known-images'

const USAGE = 'Usage: npx tsx scripts/inspect-pptx.ts <file.pptx> [--json] [--images <dir>]'

async function loadImages(dir: string) {
  const names = (await readdir(dir)).filter((n) => /\.(png|jpe?g|gif|webp)$/i.test(n)).sort()
  if (names.length === 0) {
    console.error(`No png, jpg, jpeg, gif or webp files in ${dir}`)
    process.exit(2)
  }
  return knownImagesFromFiles(await Promise.all(names.map(async (name) => ({ name, bytes: await readFile(path.join(dir, name)) }))))
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const imagesAt = args.indexOf('--images')
  const imagesDir = imagesAt === -1 ? null : args[imagesAt + 1]
  if (imagesAt !== -1 && !imagesDir) {
    console.error(USAGE)
    process.exit(2)
  }
  const file = args.find((a, i) => a !== '--json' && a !== '--images' && (imagesAt === -1 || i !== imagesAt + 1))
  if (!file) {
    console.error(USAGE)
    process.exit(2)
  }
  try {
    const knownImages = imagesDir ? await loadImages(imagesDir) : undefined
    const report = await inspectPptx(await readFile(file), { knownImages })
    console.log(json ? JSON.stringify(report, null, 2) : describePresentation(report))
  } catch (error) {
    if (error instanceof PptxInspectError) {
      console.error(`${error.message}${error.detail ? ` (${error.detail})` : ''}`)
      process.exit(1)
    }
    throw error
  }
}

main()
