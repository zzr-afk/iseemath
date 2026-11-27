export type SupportedEncoding = 'auto' | 'utf-8' | 'gb18030' | 'utf-16le';

export interface DecodeResult {
  text: string;
  encoding: string;
}

/** Detect a byte-order mark; returns null when absent. */
export function detectBomEncoding(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

function decodeWith(bytes: Uint8Array, label: string, fatal: boolean): string {
  return new TextDecoder(label, { fatal }).decode(bytes);
}

/**
 * Decode bytes with auto-detection: BOM wins; otherwise try strict UTF-8 and
 * fall back to GB18030 (covers GBK/GB2312 Chinese game logs).
 */
export function decodeBytes(bytes: Uint8Array, encoding: SupportedEncoding = 'auto'): DecodeResult {
  const bom = detectBomEncoding(bytes);
  if (bom) {
    return { text: decodeWith(bytes, bom, false), encoding: bom };
  }
  if (encoding !== 'auto') {
    return { text: decodeWith(bytes, encoding, false), encoding };
  }
  try {
    return { text: decodeWith(bytes, 'utf-8', true), encoding: 'utf-8' };
  } catch {
    return { text: decodeWith(bytes, 'gb18030', false), encoding: 'gb18030' };
  }
}

/** Pick the most frequent candidate delimiter in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const candidates = [',', '\t', ';', '|'];
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const ch = line[index];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}
