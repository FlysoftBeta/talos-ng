/**
 * Zod 3 assigns its BigInt factory after the class declaration. Rolldown therefore
 * treats an otherwise unused class as a side effect. Group only those local
 * declarations in a pure expression; preserve every line of their implementation.
 * If a schema ever actually uses bigint, its native calls remain in the output and
 * the Chrome 70 compatibility gate rejects that build.
 */
export function annotateZodBigInt(source) {
  const startText = "export class ZodBigInt extends ZodType";
  const endText = "export class ZodBoolean extends ZodType";
  const factoryText = "const bigIntType = ZodBigInt.create;";
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  if (
    start < 0 ||
    end < start ||
    !source.includes(factoryText) ||
    !source.slice(start, end).includes("ZodBigInt.create = (params) => {")
  )
    throw new Error(
      "Zod BigInt declaration changed; review the browser purity annotation before upgrading",
    );
  const declaration = source.slice(start, end).replace("export class", "class");
  return (
    source.slice(0, start) +
    "export const ZodBigInt = /* @__PURE__ */ (() => {\n" +
    declaration +
    "\nreturn ZodBigInt;\n})();\n" +
    source
      .slice(end)
      .replace(
        factoryText,
        "const bigIntType = /* @__PURE__ */ (() => ZodBigInt.create)();",
      )
  );
}

/** @returns {import('vite').Plugin} */
export function zodTreeShake() {
  return {
    name: "talos-zod-pure-bigint-declaration",
    enforce: "pre",
    transform(source, id) {
      if (!id.replaceAll("\\", "/").endsWith("/zod/v3/types.js")) return;
      return { code: annotateZodBigInt(source), map: null };
    },
  };
}
