const MAX_BUFFER_BYTES = 64 * 1024;

interface OutputBuffer { chunks: Uint8Array[]; totalBytes: number; }

/** Per-key output held until drained, keeping only the newest 64 KB. */
export type OutputBuffers = Map<string, OutputBuffer>;

export function appendOutputBuffer(buffers: OutputBuffers, key: string, data: Uint8Array): void {
  let buf = buffers.get(key);
  if (!buf) { buf = { chunks: [], totalBytes: 0 }; buffers.set(key, buf); }
  buf.chunks.push(data);
  buf.totalBytes += data.length;
  while (buf.totalBytes > MAX_BUFFER_BYTES && buf.chunks.length > 0) {
    buf.totalBytes -= buf.chunks.shift()!.length;
  }
}

export function drainOutputBuffer(buffers: OutputBuffers, key: string): Uint8Array | null {
  const buf = buffers.get(key);
  buffers.delete(key);
  if (!buf || buf.chunks.length === 0) return null;
  const out = new Uint8Array(buf.totalBytes);
  let offset = 0;
  for (const chunk of buf.chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
