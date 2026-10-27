import { CypherError } from "./errors.js";

export type TokenKind = "identifier" | "string" | "integer" | "float" | "parameter" | "symbol" | "eof";

export type Token = {
  kind: TokenKind;
  /** Identifier name, unescaped string content, number text, parameter name or symbol. */
  value: string;
  /** Backtick-quoted identifiers are never keywords. */
  quoted?: boolean;
  start: number;
  end: number;
};

const SYMBOLS = ["<>", "!=", "<=", ">=", "..", "(", ")", "[", "]", "{", "}", ",", ".", ":", "|", ";", "-", "+", "*", "/", "%", "<", ">", "=", "$"];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const fail = (message: string, at = i): never => {
    throw new CypherError("parser", `${message} ${describePosition(source, at)}`);
  };

  while (i < source.length) {
    const char = source[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) fail("unterminated comment");
      i = end + 2;
      continue;
    }

    const start = i;

    if (char === "'" || char === "\"") {
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== char) {
        // Like Kuzu, a backslash makes the next character literal ('\t' is "t").
        if (source[i] === "\\" && i + 1 < source.length) i += 1;
        value += source[i];
        i += 1;
      }
      if (i >= source.length) fail("unterminated string", start);
      i += 1;
      tokens.push({ kind: "string", value, start, end: i });
      continue;
    }

    if (char === "`") {
      const end = source.indexOf("`", i + 1);
      if (end === -1) fail("unterminated quoted identifier");
      tokens.push({ kind: "identifier", value: source.slice(i + 1, end), quoted: true, start, end: end + 1 });
      i = end + 1;
      continue;
    }

    if (/[0-9]/.test(char)) {
      while (/[0-9]/.test(source[i] ?? "")) i += 1;
      let kind: TokenKind = "integer";
      // `1..3` is a range, `1.5` a float.
      if (source[i] === "." && /[0-9]/.test(source[i + 1] ?? "")) {
        kind = "float";
        i += 1;
        while (/[0-9]/.test(source[i] ?? "")) i += 1;
      }
      if (/[eE]/.test(source[i] ?? "") && /[0-9+-]/.test(source[i + 1] ?? "")) {
        kind = "float";
        i += 2;
        while (/[0-9]/.test(source[i] ?? "")) i += 1;
      }
      tokens.push({ kind, value: source.slice(start, i), start, end: i });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      while (/[A-Za-z0-9_]/.test(source[i] ?? "")) i += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, i), start, end: i });
      continue;
    }

    if (char === "$") {
      i += 1;
      while (/[A-Za-z0-9_]/.test(source[i] ?? "")) i += 1;
      if (i === start + 1) fail("expected a parameter name after $", start);
      tokens.push({ kind: "parameter", value: source.slice(start + 1, i), start, end: i });
      continue;
    }

    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, i));
    if (!symbol) fail(`unexpected character ${JSON.stringify(char)}`);
    tokens.push({ kind: "symbol", value: symbol!, start, end: i + symbol!.length });
    i += symbol!.length;
  }

  tokens.push({ kind: "eof", value: "", start: source.length, end: source.length });
  return tokens;
}

export function describePosition(source: string, offset: number): string {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  const near = source.slice(offset, offset + 20).split("\n")[0];
  return `at line ${line}, column ${column}${near ? ` near "${near}"` : " (end of input)"}`;
}
