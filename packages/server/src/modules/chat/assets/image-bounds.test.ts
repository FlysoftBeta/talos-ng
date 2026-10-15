import { describe, expect, it } from "vitest";
import { validateImageBounds } from "./image-bounds.ts";
describe("image allocation bounds", () => {
  it("rejects oversized PNG dimensions before decoding compressed pixels", () => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 100000);
    view.setUint32(20, 100000);
    expect(() => validateImageBounds(bytes, "image/png")).toThrowError(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
  });
  it("rejects zero dimensions", () => {
    expect(() =>
      validateImageBounds(new Uint8Array(24), "image/png"),
    ).toThrow();
  });
  it("rejects truncated JPEG segments", () => {
    expect(() =>
      validateImageBounds(
        new Uint8Array([255, 216, 255, 192, 0, 99]),
        "image/jpeg",
      ),
    ).toThrow();
  });
  it("finds JPEG SOF after a metadata segment", () => {
    const bytes = new Uint8Array([
      255, 216, 255, 224, 0, 3, 0, 255, 192, 0, 7, 8, 0, 10, 0, 20,
    ]);
    expect(() => validateImageBounds(bytes, "image/jpeg")).not.toThrow();
  });
  it("rejects malformed GIF blocks without looping", () => {
    const bytes = new Uint8Array(14);
    bytes[6] = 1;
    bytes[8] = 1;
    bytes[13] = 99;
    expect(() => validateImageBounds(bytes, "image/gif")).toThrow();
  });
  it("rejects excessively large BMP dimensions", () => {
    const bytes = new Uint8Array(26);
    const view = new DataView(bytes.buffer);
    view.setUint32(14, 40, true);
    view.setInt32(18, 32000, true);
    view.setInt32(22, -32000, true);
    expect(() => validateImageBounds(bytes, "image/bmp")).toThrow();
  });

  const png = (w: number, h: number) => {
    const bytes = new Uint8Array(33);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return bytes;
  };
  const gif = (
    width: number,
    height: number,
    frames: { w: number; h: number }[],
  ) => {
    const out = [
      ...Buffer.from("GIF89a"),
      width & 255,
      width >> 8,
      height & 255,
      height >> 8,
      0, // no global colour table
      0,
      0,
    ];
    for (const f of frames)
      out.push(
        44,
        0,
        0,
        0,
        0,
        f.w & 255,
        f.w >> 8,
        f.h & 255,
        f.h >> 8,
        0,
        2, // LZW minimum code size
        1,
        0, // one data sub-block of one byte, then terminator
        0,
      );
    out.push(59);
    return new Uint8Array(out);
  };
  it("accepts well-formed PNG at the limits and rejects the pixel budget and truncation", () => {
    expect(() =>
      validateImageBounds(png(5600, 5700), "image/png"),
    ).not.toThrow();
    expect(() => validateImageBounds(png(5700, 5700), "image/png")).toThrow(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
    expect(() => validateImageBounds(png(32769, 1), "image/png")).toThrow(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
    expect(() =>
      validateImageBounds(png(10, 10).subarray(0, 23), "image/png"),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
  });
  it("reads OS/2 core and Windows BMP headers", () => {
    const core = new Uint8Array(26);
    const view = new DataView(core.buffer);
    view.setUint32(14, 12, true);
    view.setUint16(18, 100, true);
    view.setUint16(20, 100, true);
    expect(() => validateImageBounds(core, "image/bmp")).not.toThrow();
    view.setUint16(18, 0, true);
    expect(() => validateImageBounds(core, "image/bmp")).toThrow();
    expect(() =>
      validateImageBounds(core.subarray(0, 25), "image/bmp"),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
  });
  it("finds progressive and extended-sequential JPEG frames and skips restart markers", () => {
    for (const sof of [194, 193, 202]) {
      const bytes = new Uint8Array([
        255,
        216,
        255,
        208,
        255,
        255,
        sof,
        0,
        7,
        8,
        0,
        10,
        0,
        20,
      ]);
      expect(() => validateImageBounds(bytes, "image/jpeg")).not.toThrow();
    }
    const huge = new Uint8Array([
      255, 216, 255, 192, 0, 7, 8, 255, 255, 255, 255, 0,
    ]);
    expect(() => validateImageBounds(huge, "image/jpeg")).toThrow(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
    // Scan data (SOS) before any frame header: no dimensions can be proven.
    expect(() =>
      validateImageBounds(
        new Uint8Array([255, 216, 255, 218, 0, 2, 0, 0]),
        "image/jpeg",
      ),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
    expect(() =>
      validateImageBounds(
        new Uint8Array([255, 216, 1, 2, 3, 4, 5]),
        "image/jpeg",
      ),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
  });
  it("bounds GIF frame count and total decoded pixels, not just the canvas", () => {
    expect(() =>
      validateImageBounds(gif(10, 10, [{ w: 10, h: 10 }]), "image/gif"),
    ).not.toThrow();
    expect(() =>
      validateImageBounds(
        gif(
          10,
          10,
          Array.from({ length: 512 }, () => ({ w: 10, h: 10 })),
        ),
        "image/gif",
      ),
    ).not.toThrow();
    expect(() =>
      validateImageBounds(
        gif(
          10,
          10,
          Array.from({ length: 513 }, () => ({ w: 10, h: 10 })),
        ),
        "image/gif",
      ),
    ).toThrow(expect.objectContaining({ code: "E_TOO_LARGE" }));
    // 8 frames of 2000x2000 on a tiny canvas: each frame fits, the animation does not.
    expect(() =>
      validateImageBounds(
        gif(
          10,
          10,
          Array.from({ length: 9 }, () => ({ w: 2000, h: 2000 })),
        ),
        "image/gif",
      ),
    ).toThrow(expect.objectContaining({ code: "E_TOO_LARGE" }));
    expect(() =>
      validateImageBounds(gif(10, 10, [{ w: 0, h: 5 }]), "image/gif"),
    ).toThrow(expect.objectContaining({ code: "E_TOO_LARGE" }));
    const truncated = gif(10, 10, [{ w: 10, h: 10 }]);
    expect(() =>
      validateImageBounds(
        truncated.subarray(0, truncated.length - 4),
        "image/gif",
      ),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
  });
  it("never crashes with a non-application error or hangs on random and truncated input", () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/bmp"]) {
      for (let i = 0; i < 400; i++) {
        const bytes = new Uint8Array(next() % 80);
        for (let j = 0; j < bytes.length; j++) bytes[j] = next() >>> 24;
        if (mime === "image/jpeg" && bytes.length > 1) bytes.set([255, 216]);
        if (mime === "image/gif" && bytes.length > 5)
          bytes.set(Buffer.from("GIF89a"));
        try {
          validateImageBounds(bytes, mime);
        } catch (error) {
          expect((error as { code?: string }).code).toMatch(
            /^E_(INVALID|TOO_LARGE)$/,
          );
        }
      }
    }
    // Unknown types are not inspected here (the decoder gate owns them).
    expect(() =>
      validateImageBounds(new Uint8Array(3), "image/webp"),
    ).not.toThrow();
  });
});
