import { z } from "zod";
export const FEATURES = [
  "offline",
  "articles",
  "article_reader",
  "ebook_reader",
  "learning",
  "article_download",
  "ai",
  "media",
  "post_images",
] as const;
export type Feature = (typeof FEATURES)[number];
export const featureSchema = z.enum(FEATURES);
/** Product gate dependencies are identical on the client and server. */
export function hasFeature(
  features: readonly Feature[],
  feature: Feature,
): boolean {
  return (
    features.includes(feature) &&
    (!(
      feature === "article_reader" ||
      feature === "ebook_reader" ||
      feature === "article_download"
    ) ||
      features.includes("articles"))
  );
}
