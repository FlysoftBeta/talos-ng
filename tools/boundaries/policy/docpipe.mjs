export default {
  layers: [
    {
      id: "docpipe-text-no-pdfrender",
      from: "src/text/**",
      forbid: "src/pdfrender/**",
      reason: "The text converter must not depend on the PDF renderer.",
    },
    {
      id: "docpipe-conversion-no-converters",
      from: "src/conversion/**",
      fromIgnore: "**/*.test.ts",
      forbid: ["src/pdfrender/**", "src/text/**"],
      reason: "Converter ports and orchestration do not know any converter.",
    },
    {
      id: "docpipe-file-spool-no-converters",
      from: "src/file-spool/**",
      forbid: ["src/conversion/**", "src/pdfrender/**", "src/text/**"],
      reason: "The file spool carries no converter policy.",
    },
  ],
};
