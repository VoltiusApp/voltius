export interface StreamHooks {
  onText(delta: string): void;
  onTool(tool: string, state: "call" | "result", detail: string): void;
  onError(message: string): void;
}

/**
 * Drain an AI-SDK `streamText` fullStream, routing typed parts to store hooks.
 * Part shapes (text-delta.text, tool-call/tool-result.toolName+input/output,
 * error.error) verified against node_modules/ai/dist/index.d.ts TextStreamPart
 * union — distinct from the raw LanguageModelV4 doStream chunk shape.
 */
export async function consumeStream(
  fullStream: AsyncIterable<Record<string, unknown>>,
  hooks: StreamHooks,
): Promise<void> {
  for await (const part of fullStream) {
    switch (part.type) {
      case "text-delta":
        hooks.onText(String(part.text ?? ""));
        break;
      case "tool-call":
        hooks.onTool(String(part.toolName), "call", JSON.stringify(part.input ?? {}));
        break;
      case "tool-result":
        hooks.onTool(
          String(part.toolName),
          "result",
          typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? ""),
        );
        break;
      case "error": {
        const e = part.error;
        hooks.onError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
  }
}
