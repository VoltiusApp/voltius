import type { IDisposable, Terminal } from "@xterm/xterm";

const WINDOW_REPORTS = new Set([11, 13, 14, 15, 16, 18, 19, 20, 21]);

export function suppressTerminalQueries(term: Terminal): IDisposable {
  const p = term.parser;
  const swallow = () => true;
  const isQuery = (data: string) => data.split(";").includes("?");
  const disposables: IDisposable[] = [
    p.registerCsiHandler({ final: "c" }, swallow),
    p.registerCsiHandler({ prefix: ">", final: "c" }, swallow),
    p.registerCsiHandler({ prefix: "=", final: "c" }, swallow),
    p.registerCsiHandler({ final: "n" }, swallow),
    p.registerCsiHandler({ prefix: "?", final: "n" }, swallow),
    p.registerCsiHandler({ intermediates: "$", final: "p" }, swallow),
    p.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, swallow),
    p.registerCsiHandler({ prefix: ">", final: "q" }, swallow),
    p.registerCsiHandler({ prefix: "?", final: "u" }, swallow),
    p.registerCsiHandler({ final: "t" }, (params) => WINDOW_REPORTS.has(Number(params[0]))),
    ...[4, 10, 11, 12].map((id) => p.registerOscHandler(id, isQuery)),
    p.registerDcsHandler({ intermediates: "$", final: "q" }, swallow),
  ];
  return { dispose: () => disposables.forEach((d) => d.dispose()) };
}
