/**
 * Incremental JSONL parser. Keeps a partial trailing line between chunks so a
 * JSON object split across chunk boundaries still parses. Blank lines are
 * ignored; bad lines are counted and sampled instead of aborting.
 */
export interface JsonlStats {
  badLines: number;
  samples: string[];
  lineCount: number;
}

export class JsonlParser {
  private buffer = '';
  private started = false;
  private badLines = 0;
  private samples: string[] = [];
  private lineCount = 0;
  private readonly maxSamples: number;
  private readonly strict: boolean;

  constructor(options: { maxSamples?: number; strict?: boolean } = {}) {
    this.maxSamples = options.maxSamples ?? 20;
    this.strict = options.strict ?? false;
  }

  /** Parse complete lines from the chunk. Throws on a bad line when strict. */
  push(chunk: string): unknown[] {
    const values: unknown[] = [];
    let text = chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    this.buffer += text;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.consumeLine(line, values);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return values;
  }

  /** Parse the remaining partial line. */
  end(): unknown[] {
    const values: unknown[] = [];
    let line = this.buffer;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.buffer = '';
    if (line.trim().length > 0) this.consumeLine(line, values);
    return values;
  }

  get stats(): JsonlStats {
    return {
      badLines: this.badLines,
      samples: [...this.samples],
      lineCount: this.lineCount,
    };
  }

  private consumeLine(line: string, values: unknown[]): void {
    if (line.trim().length === 0) return;
    this.lineCount += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.badLines += 1;
      if (this.samples.length < this.maxSamples) this.samples.push(line);
      if (this.strict) {
        throw new Error(
          `JSONL 第 ${this.lineCount} 行解析失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    values.push(parsed);
  }
}

export function parseJsonl(
  text: string,
  options: { maxSamples?: number; strict?: boolean } = {},
): { values: unknown[]; stats: JsonlStats } {
  const parser = new JsonlParser(options);
  const values = [...parser.push(text), ...parser.end()];
  return { values, stats: parser.stats };
}
