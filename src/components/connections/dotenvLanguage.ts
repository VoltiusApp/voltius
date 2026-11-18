import { StreamLanguage, type StringStream } from "@codemirror/language";

interface State {
  phase: "key" | "equals" | "value" | "rest";
  quote: string | null;
}

function readQuoted(stream: StringStream, state: State): string {
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "\\" && state.quote === '"') stream.next();
    else if (ch === state.quote) {
      state.quote = null;
      state.phase = "rest";
      break;
    }
  }
  return "string";
}

export const dotenvLanguage = StreamLanguage.define<State>({
  name: "dotenv",
  startState: () => ({ phase: "key", quote: null }),
  token(stream, state) {
    if (state.quote) return readQuoted(stream, state);
    if (stream.sol()) state.phase = "key";
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#" && state.phase !== "value") {
      stream.skipToEnd();
      return "comment";
    }
    switch (state.phase) {
      case "key":
        if (stream.match(/^export(?=\s)/)) return "keyword";
        if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?=\s*=)/)) {
          state.phase = "equals";
          return "propertyName";
        }
        stream.skipToEnd();
        return "invalid";
      case "equals":
        stream.next();
        state.phase = "value";
        return "operator";
      case "value": {
        const ch = stream.next()!;
        if (ch === '"' || ch === "'" || ch === "`") {
          state.quote = ch;
          return readQuoted(stream, state);
        }
        stream.match(/^.*?(?=\s+#|$)/);
        state.phase = "rest";
        return "string";
      }
      default:
        stream.next();
        return null;
    }
  },
});
