import slugify from "slugify";

export function toAnchor(value: string): string {
  const result = slugify(value, {
    lower: true,
    strict: true,
    trim: true,
  });

  return result.length > 0 ? result : "section";
}
