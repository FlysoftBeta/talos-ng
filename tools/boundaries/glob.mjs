// Minimal glob: `**/` (any directories, may be empty), `**`, `*` (no slash),
// `?`, and `{a,b}` alternation. Patterns match whole strings.
function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open < 0) return [glob];
  let depth = 0;
  let close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return [glob];
  const parts = [];
  let current = "";
  depth = 0;
  for (const char of glob.slice(open + 1, close)) {
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") depth--;
    current += char;
  }
  parts.push(current);
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return parts.flatMap((part) => expandBraces(`${head}${part}${tail}`));
}
function translate(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
  }
  return out;
}
const cache = new Map();
export function globToRegExp(glob) {
  let regexp = cache.get(glob);
  if (!regexp) {
    regexp = new RegExp(`^(?:${expandBraces(glob).map(translate).join("|")})$`);
    cache.set(glob, regexp);
  }
  return regexp;
}
export function matchesAny(globs, ...values) {
  const list = Array.isArray(globs) ? globs : [globs];
  return list.some((glob) => {
    const regexp = globToRegExp(glob);
    return values.some((value) => value !== undefined && regexp.test(value));
  });
}
