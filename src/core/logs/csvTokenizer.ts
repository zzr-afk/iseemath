export interface CsvTokenizerOptions {
  delimiter?: string;
  quote?: string;
}

/**
 * Incremental CSV tokenizer. State survives across chunks so quoted fields and
 * records split at arbitrary chunk boundaries parse identically to a single
 * pass. Text decoding (UTF-8/GB18030) happens before this stage.
 */
export class CsvTokenizer {
  private readonly delimiter: string;
  private readonly quote: string;
  private field = '';
  private fields: string[] = [];
  private inQuotes = false;
  /** A closing quote landed exactly at the end of the previous chunk. */
  private quotePending = false;
  /** The previous chunk ended with CR; skip a leading LF of the next chunk. */
  private pendingCR = false;
  private started = false;
  private recordHasContent = false;

  constructor(options: CsvTokenizerOptions = {}) {
    this.delimiter = options.delimiter ?? ',';
    this.quote = options.quote ?? '"';
    if (this.delimiter.length !== 1) throw new Error('CSV 分隔符必须是单个字符');
    if (this.quote.length !== 1) throw new Error('CSV 引号必须是单个字符');
    if (this.delimiter === this.quote) throw new Error('CSV 分隔符不能与引号相同');
  }

  push(chunk: string): string[][] {
    const records: string[][] = [];
    let text = chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }

    let index = 0;
    if (this.quotePending) {
      this.quotePending = false;
      if (text[0] === this.quote) {
        this.field += this.quote;
        index = 1;
      } else {
        this.inQuotes = false;
      }
    }
    if (this.pendingCR) {
      this.pendingCR = false;
      if (text[index] === '\n') index += 1;
    }

    for (; index < text.length; index += 1) {
      const ch = text[index]!;

      // A CR already terminated the previous record. An LF that follows in the
      // same chunk is part of the CRLF pair and must be skipped here too;
      // deferring it to the next push would swallow that chunk's first char.
      if (this.pendingCR) {
        this.pendingCR = false;
        if (ch === '\n') continue;
      }

      if (this.inQuotes) {
        if (ch === this.quote) {
          if (index + 1 >= text.length) {
            // Cannot decide yet whether this is an escaped quote.
            this.quotePending = true;
          } else if (text[index + 1] === this.quote) {
            this.field += this.quote;
            index += 1;
          } else {
            this.inQuotes = false;
          }
        } else {
          this.field += ch;
          this.recordHasContent = true;
        }
        continue;
      }

      if (ch === this.quote && this.field.length === 0) {
        this.inQuotes = true;
        this.recordHasContent = true;
        continue;
      }
      if (ch === this.delimiter) {
        this.fields.push(this.field);
        this.field = '';
        this.recordHasContent = true;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r') this.pendingCR = true;
        if (this.recordHasContent || this.fields.length > 0) {
          this.fields.push(this.field);
          records.push(this.fields);
          this.fields = [];
          this.field = '';
          this.recordHasContent = false;
        }
        continue;
      }
      this.field += ch;
      this.recordHasContent = true;
    }

    return records;
  }

  end(): string[][] {
    const records: string[][] = [];
    if (this.quotePending) {
      this.quotePending = false;
      this.inQuotes = false;
    }
    // Unterminated quoted fields are accepted permissively; the caller can
    // surface a warning from record shape mismatches.
    this.inQuotes = false;
    if (this.recordHasContent || this.fields.length > 0) {
      this.fields.push(this.field);
      records.push(this.fields);
      this.fields = [];
      this.field = '';
      this.recordHasContent = false;
    }
    return records;
  }
}

export function parseCsv(text: string, options: CsvTokenizerOptions = {}): string[][] {
  const tokenizer = new CsvTokenizer(options);
  return [...tokenizer.push(text), ...tokenizer.end()];
}
