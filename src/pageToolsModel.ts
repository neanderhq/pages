import type { Block } from "./pagesApi.ts";

export type PageHeading = { id: string; text: string; level: number };

function inlineText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map(item => item && typeof item === "object" ? (typeof item.text === "string" ? item.text : inlineText(item.content)) : "").join("");
}

export function pageHeadings(blocks: Block[]): PageHeading[] {
  const headings: PageHeading[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && typeof block.id === "string") {
      const props = block.props as { level?: unknown } | undefined;
      const level = typeof props?.level === "number" ? Math.max(1, Math.min(6, props.level)) : 1;
      headings.push({ id: block.id, text: inlineText(block.content).trim() || "Untitled heading", level });
    }
    if (Array.isArray(block.children)) headings.push(...pageHeadings(block.children));
  }
  return headings;
}

export function addPageTag(tags: string[], value: string): string[] {
  const tag = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!tag || tag.length > 40) throw new Error("Tags must be 1–40 characters.");
  if (tags.includes(tag)) return tags;
  if (tags.length >= 20) throw new Error("A page can have up to 20 tags.");
  return [...tags, tag].sort();
}
