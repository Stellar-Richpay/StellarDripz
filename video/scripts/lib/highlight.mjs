/**
 * Minimal syntax highlighter for the code panels in the pitch video.
 *
 * Highlighting happens here (once, at build time) instead of in the render
 * stage so the per-frame work stays cheap: each line becomes a list of
 * `{ t: text, k: class }` tokens.
 */

const KEYWORDS = {
  ts: [
    "import", "from", "export", "default", "const", "let", "var", "function", "return", "async",
    "await", "if", "else", "for", "while", "try", "catch", "finally", "throw", "new", "class",
    "extends", "interface", "type", "enum", "implements", "public", "private", "readonly",
    "typeof", "instanceof", "in", "of", "null", "undefined", "true", "false", "as", "satisfies",
  ],
  rust: [
    "pub", "fn", "let", "mut", "const", "struct", "enum", "impl", "use", "mod", "return", "if",
    "else", "match", "for", "while", "loop", "in", "as", "self", "Self", "Ok", "Err", "Some",
    "None", "true", "false", "require_auth", "env", "Result", "Vec", "Address", "String", "u32",
    "u64", "i128", "bool", "contractimpl", "contracttype", "contract", "contracterror",
  ],
  json: ["true", "false", "null"],
  yaml: ["true", "false", "null", "on", "runs-on", "uses", "with", "env", "if", "needs", "steps"],
  bash: [
    "npm", "npx", "cargo", "node", "git", "run", "install", "test", "build", "&&", "cd", "echo",
    "export", "ffmpeg", "curl",
  ],
};

const COMMENT_PREFIX = {
  ts: ["//", "/*", "*"],
  rust: ["//", "///"],
  json: [],
  yaml: ["#"],
  bash: ["#"],
};

/** Escape a plain string for insertion into HTML. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Split one line into highlighted tokens. */
function tokenizeLine(line, lang) {
  const keywords = new Set(KEYWORDS[lang] || []);
  const comments = COMMENT_PREFIX[lang] || [];
  const tokens = [];

  // Whole-line comment first — it swallows anything after it.
  const trimmed = line.trimStart();
  const commentHit = comments.find((p) => trimmed.startsWith(p));
  if (commentHit) {
    const indent = line.slice(0, line.length - trimmed.length);
    if (indent) tokens.push({ t: indent, k: "plain" });
    tokens.push({ t: trimmed, k: "com" });
    return tokens;
  }

  const pattern =
    /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\w.]*\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|[^\w\s]+)/g;

  let match;
  let lastIndex = 0;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ t: line.slice(lastIndex, match.index), k: "plain" });
    }
    const [raw, comment, str, num, word, punct] = match;
    if (comment) tokens.push({ t: raw, k: "com" });
    else if (str) tokens.push({ t: raw, k: "str" });
    else if (num) tokens.push({ t: raw, k: "num" });
    else if (word) {
      if (keywords.has(word)) tokens.push({ t: raw, k: "kw" });
      else if (/^[A-Z]/.test(word)) tokens.push({ t: raw, k: "type" });
      else if (line[pattern.lastIndex] === "(") tokens.push({ t: raw, k: "fn" });
      else tokens.push({ t: raw, k: "plain" });
    } else if (punct) {
      tokens.push({ t: raw, k: "punct" });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) tokens.push({ t: line.slice(lastIndex), k: "plain" });
  return tokens;
}

/**
 * Highlight a block of source text.
 * @returns {{ n: number, tokens: {t: string, k: string}[] }[]}
 */
export function highlight(text, lang = "ts") {
  return text
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line, index) => ({ n: index + 1, tokens: tokenizeLine(line, lang) }));
}

/**
 * Pick a contiguous slice of a file, keeping real line numbers so the panel
 * shows the excerpt's true place in the source.
 */
export function excerpt(text, { match, before = 4, after = 26 } = {}) {
  const lines = text.split("\n");
  const index = match ? lines.findIndex((l) => l.includes(match)) : 0;
  const start = Math.max(0, (index === -1 ? 0 : index) - before);
  const slice = lines.slice(start, start + before + after);
  return {
    text: slice.join("\n"),
    firstLine: start + 1,
    totalLines: lines.length,
  };
}

/** Render tokens to HTML spans (used by the stage for panel layers). */
export function tokensToHtml(tokens) {
  return tokens.map((tok) => `<span class="tk-${tok.k}">${escapeHtml(tok.t)}</span>`).join("");
}
