import { z } from "zod";

export const pageArgs = z
  .object({
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
