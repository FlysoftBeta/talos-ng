/** Real, deterministic CJK PDF with a valid xref; no external generator required. */
export function libraryPdf(pages = 2) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>",
  ];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const page = objects.length + 1;
    kids.push(page);
    const suffix = String(i + 1)
      .split("")
      .map((c) => c.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");
    const content = `BT /F1 20 Tf 40 700 Td <4F60597D4E16754C0020${suffix}> Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
