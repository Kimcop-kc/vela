import fs from 'node:fs'

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5'

function canDecode(buffer: Buffer, encoding: TextEncoding): boolean {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(buffer, { stream: true })
    return true
  } catch {
    return false
  }
}

export function detectTextEncoding(buffer: Buffer): TextEncoding {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'utf-8'
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return 'utf-16le'
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) return 'utf-16be'

  const sample = buffer.subarray(0, Math.min(buffer.length, 128 * 1024))
  if (canDecode(sample, 'utf-8')) return 'utf-8'
  if (canDecode(sample, 'gb18030')) return 'gb18030'
  if (canDecode(sample, 'big5')) return 'big5'
  return 'gb18030'
}

export function detectFileTextEncoding(filePath: string): TextEncoding {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(128 * 1024)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return detectTextEncoding(buffer.subarray(0, bytesRead))
  } finally {
    fs.closeSync(fd)
  }
}

export function decodeTextBuffer(buffer: Buffer, encoding?: TextEncoding): string {
  return new TextDecoder(encoding ?? detectTextEncoding(buffer)).decode(buffer)
}

export function readTextFileSync(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return decodeTextBuffer(buffer)
}
