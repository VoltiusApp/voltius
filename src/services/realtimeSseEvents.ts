export class SseDataLineParser {
  private pending = "";

  push(chunk: string): string[] {
    const text = this.pending + chunk;
    const lines = text.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.flatMap((line) => this.parseLine(line));
  }

  flush(): string[] {
    if (!this.pending) return [];
    const line = this.pending;
    this.pending = "";
    return this.parseLine(line);
  }

  private parseLine(line: string): string[] {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalized.startsWith("data:")) return [];
    const data = normalized.slice(5).trim();
    return data ? [data] : [];
  }
}
