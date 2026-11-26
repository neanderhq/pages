import type { CommentAnchor } from "./schema.ts";

type Json = Record<string, unknown>;
export type AnchorResult = { status: "attached" | "detached"; blockId: string };
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

function inlineText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map(item => {
    if (!isObject(item)) return "";
    if (item.type === "text") return typeof item.text === "string" ? item.text : "";
    if (item.type === "link") return inlineText(item.content);
    return "";
  }).join("");
}

function contentText(value: unknown): string {
  if (Array.isArray(value)) return inlineText(value);
  if (!isObject(value) || value.type !== "tableContent" || !Array.isArray(value.rows)) return "";
  return value.rows.map(row => (isObject(row) && Array.isArray(row.cells) ? row.cells : [])
    .map(cell => isObject(cell) && cell.type === "tableCell" ? inlineText(cell.content) : inlineText(cell)).join("\t")).join("\n");
}

// Plain text of every block (children included), in document order.
export function blockTexts(content: unknown): { id: string; text: string }[] {
  const result: { id: string; text: string }[] = [];
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 16) return;
    for (const block of list) {
      if (!isObject(block)) continue;
      if (typeof block.id === "string") result.push({ id: block.id, text: contentText(block.content) });
      walk(block.children, depth + 1);
    }
  };
  walk(content, 1);
  return result;
}

// How well the text around one occurrence matches the saved prefix/suffix (number of matching characters).
function contextScore(text: string, index: number, anchor: CommentAnchor) {
  let score = 0;
  const before = text.slice(0, index), after = text.slice(index + anchor.quote.length);
  for (let i = 1; i <= Math.min(anchor.prefix.length, before.length) && before[before.length - i] === anchor.prefix[anchor.prefix.length - i]; i++) score++;
  for (let i = 0; i < Math.min(anchor.suffix.length, after.length) && after[i] === anchor.suffix[i]; i++) score++;
  return score;
}

export function anchorPlacement(content: unknown, anchor: CommentAnchor, threadId?: string): { blockId: string; from: number; to: number } | null {
  const blocks = blockTexts(content);
  if (anchor.sourceText !== undefined) {
    const texts = new Map(blocks.map(block => [block.id, block.text]));
    let found: { blockId: string; from: number; to: number } | null = null;
    const walk = (value: unknown) => {
      if (!Array.isArray(value)) return;
      for (const block of value) {
        if (!isObject(block)) continue;
        const text = typeof block.id === "string" ? texts.get(block.id) ?? "" : "";
        if (Array.isArray(block.commentRanges)) for (const range of block.commentRanges) {
          if (isObject(range) && range.threadId === threadId && typeof range.from === "number" && typeof range.to === "number" && range.from >= 0 && range.to > range.from && range.to <= text.length && typeof block.id === "string") {
            found ??= { blockId: block.id, from: range.from, to: range.to };
          }
        }
        walk(block.children);
      }
    };
    if (threadId) walk(content);
    if (found) return found;
    const original = blocks.find(block => block.id === anchor.blockId && block.text === anchor.sourceText);
    return original && anchor.from !== undefined && anchor.to !== undefined ? { blockId: original.id, from: anchor.from, to: anchor.to } : null;
  }
  const candidates: { blockId: string; from: number; to: number; score: number }[] = [];
  for (const block of blocks) for (let index = block.text.indexOf(anchor.quote); index >= 0; index = block.text.indexOf(anchor.quote, index + 1)) {
    candidates.push({ blockId: block.id, from: index, to: index + anchor.quote.length, score: contextScore(block.text, index, anchor) + (block.id === anchor.blockId ? 1 : 0) });
  }
  candidates.sort((first, second) => second.score - first.score);
  const best = candidates[0];
  if (!best || (candidates[1] && candidates[1].score === best.score)) return null;
  return { blockId: best.blockId, from: best.from, to: best.to };
}

export function resolveAnchor(content: unknown, anchor: CommentAnchor, threadId?: string): AnchorResult {
  const placement = anchorPlacement(content, anchor, threadId);
  return placement ? { status: "attached", blockId: placement.blockId } : { status: "detached", blockId: anchor.blockId };
}

export function preserveNativeRanges(previous: unknown, content: Json[], threads: { id: string; anchor: CommentAnchor | null }[]) {
  const before = new Map(blockTexts(previous).map(block => [block.id, block.text]));
  const after = blockTexts(content);
  const nodes = new Map<string, Json>();
  const marked = new Set<string>();
  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) if (isObject(block)) {
      if (typeof block.id === "string") nodes.set(block.id, block);
      if (Array.isArray(block.commentRanges)) for (const range of block.commentRanges) if (isObject(range) && typeof range.threadId === "string") marked.add(range.threadId);
      walk(block.children);
    }
  };
  walk(content);
  for (const thread of threads) {
    if (!thread.anchor || thread.anchor.sourceText === undefined || marked.has(thread.id)) continue;
    const old = anchorPlacement(previous, thread.anchor, thread.id);
    let placement = old ? null : anchorPlacement(content, thread.anchor, thread.id);
    if (old) {
      const oldText = before.get(old.blockId);
      let next = after.find(block => block.id === old.blockId);
      if (!next) {
        const matches = after.filter(block => block.text === oldText);
        if (matches.length === 1) next = matches[0];
      }
      if (oldText !== undefined && next) {
        let prefix = 0, suffix = 0;
        while (prefix < Math.min(oldText.length, next.text.length) && oldText[prefix] === next.text[prefix]) prefix++;
        while (suffix < Math.min(oldText.length, next.text.length) && oldText[oldText.length - suffix - 1] === next.text[next.text.length - suffix - 1]) suffix++;
        if (oldText !== next.text && prefix + suffix > Math.min(oldText.length, next.text.length)) continue;
        suffix = Math.min(suffix, Math.min(oldText.length, next.text.length) - prefix);
        const oldEnd = oldText.length - suffix;
        const shift = next.text.length - oldText.length;
        if (oldEnd <= old.from) placement = { blockId: next.id, from: old.from + shift, to: old.to + shift };
        else if (prefix >= old.to) placement = { ...old, blockId: next.id };
        else if (prefix >= old.from && oldEnd <= old.to && old.to + shift > old.from) placement = { blockId: next.id, from: old.from, to: old.to + shift };
      }
    }
    if (!placement) continue;
    const block = nodes.get(placement.blockId);
    if (block) block.commentRanges = [...(Array.isArray(block.commentRanges) ? block.commentRanges : []), { threadId: thread.id, from: placement.from, to: placement.to }];
  }
  return content;
}
