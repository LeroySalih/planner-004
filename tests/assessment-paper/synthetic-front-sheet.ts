import sharp from 'sharp'

// Pages drawn for the checks. A front sheet: a title, Name / Class / Teacher
// boxes and instructions; `marks` writes in the boxes. A question page: a
// question and answer lines; `marks` writes an answer. `scanned` skews the
// page, greys the paper and adds noise, as a scanner would.
export async function syntheticFrontSheet(marks: boolean, scanned: boolean): Promise<Buffer> {
  return drawPage(frontSheetSvg(marks), scanned)
}

export async function syntheticQuestionPage(page: number, marks: boolean, scanned: boolean): Promise<Buffer> {
  const w = 1240, h = 1754
  const answer = marks
    ? Array.from({ length: 6 }, (_, i) => `<path d="M140 ${460 + i * 110} q30 -40 60 0 t60 0 t60 -10 t60 10 t60 0 t60 -5 t60 5 t60 0" stroke="#123" stroke-width="5" fill="none"/>`).join('')
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#fff"/>
    <text x="120" y="160" font-size="44" font-family="sans-serif" font-weight="bold">Question ${page}</text>
    <text x="120" y="240" font-size="30" font-family="sans-serif">Explain one reason why aluminium is used for the hull of a boat. (${page + 2} marks)</text>
    ${Array.from({ length: 12 }, (_, i) => `<line x1="120" y1="${480 + i * 110}" x2="1120" y2="${480 + i * 110}" stroke="#888" stroke-width="2" stroke-dasharray="4 6"/>`).join('')}
    <text x="1000" y="1700" font-size="24" font-family="sans-serif">Page ${page}</text>
    ${answer}
  </svg>`
  return drawPage(svg, scanned)
}

function frontSheetSvg(marks: boolean): string {
  const w = 1240, h = 1754
  const scribble = marks
    ? `<path d="M330 330 q20 -40 40 0 t40 0 t40 -10 q15 30 30 0 t35 5 t30 -5 t40 10 t30 -10" stroke="#123" stroke-width="5" fill="none"/>
       <path d="M330 470 q25 -35 50 0 t50 0 t40 5" stroke="#123" stroke-width="5" fill="none"/>
       <path d="M800 470 q20 -30 40 0 t40 -5 t40 5" stroke="#123" stroke-width="5" fill="none"/>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#fff"/>
    <text x="120" y="160" font-size="56" font-family="sans-serif" font-weight="bold">GCSE Design and Technology</text>
    <text x="120" y="230" font-size="36" font-family="sans-serif">Materials - Practice Assessment</text>
    <text x="120" y="340" font-size="30" font-family="sans-serif">Name</text>
    <rect x="310" y="280" width="800" height="90" fill="none" stroke="#000" stroke-width="3"/>
    <text x="120" y="480" font-size="30" font-family="sans-serif">Class</text>
    <rect x="310" y="420" width="300" height="90" fill="none" stroke="#000" stroke-width="3"/>
    <text x="640" y="480" font-size="30" font-family="sans-serif">Teacher</text>
    <rect x="780" y="420" width="330" height="90" fill="none" stroke="#000" stroke-width="3"/>
    <rect x="120" y="620" width="990" height="600" fill="none" stroke="#000" stroke-width="2"/>
    ${Array.from({ length: 12 }, (_, i) => `<text x="150" y="${690 + i * 44}" font-size="26" font-family="sans-serif">Instruction ${i + 1}: write your name only on this front sheet and answer every question.</text>`).join('')}
    <text x="120" y="1400" font-size="30" font-family="sans-serif">Total marks: 60    Time: 1 hour</text>
    ${scribble}
  </svg>`
  return svg
}

async function drawPage(svg: string, scanned: boolean): Promise<Buffer> {
  const w = 1240, h = 1754
  let img = sharp(Buffer.from(svg)).png()
  if (scanned) {
    // A scan: slight skew, grey paper, a little noise, a lower resolution.
    const base = await img.rotate(0.8, { background: '#e8e8e8' }).resize(w, h, { fit: 'fill' }).linear(0.9, 10).png().toBuffer()
    const noise = await sharp({ create: { width: w, height: h, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 20 } } }).png().toBuffer()
    img = sharp(base).composite([{ input: noise, blend: 'soft-light' }]).png()
  }
  return img.toBuffer()
}

/** A PDF of the pages, one A4 page each, the images embedded as JPEG. */
export async function pagesToPdf(pages: Buffer[]): Promise<Buffer> {
  const chunks: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: Buffer | string) => {
    const buffer = typeof part === 'string' ? Buffer.from(part, 'latin1') : part
    chunks.push(buffer)
    length += buffer.length
  }
  const object = (id: number, body: Buffer | string, stream?: Buffer) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    push(body)
    if (stream) {
      push('\nstream\n')
      push(stream)
      push('\nendstream')
    }
    push('\nendobj\n')
  }
  push('%PDF-1.4\n')
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  for (const [i, page] of pages.entries()) {
    const { data, info } = await sharp(page).flatten({ background: '#ffffff' }).removeAlpha().toColourspace('srgb')
      .jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
    const id = 3 + i * 3
    const content = Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1')
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`)
    object(id + 1, `<< /Length ${content.length} >>`, content)
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>`, data)
  }
  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(chunks)
}
