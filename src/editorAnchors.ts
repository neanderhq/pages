import { trackPosition, type BlockNoteEditor } from "@blocknote/core";
import type { Anchor, Thread } from "./collabApi";
import type { Block } from "./pagesApi";

type Editor = Pick<BlockNoteEditor<any, any, any>, "prosemirrorState" | "transact" | "document">;
type Range = { threadId: string; from: number; to: number };

export function selectedAnchor(editor: Editor, selection: { from: number; to: number; empty: boolean } = editor.prosemirrorState.selection): Anchor {
  const { doc } = editor.prosemirrorState;
  let anchor: Anchor | undefined;
  doc.descendants((node, position) => {
    if (anchor || node.type.name !== "blockContainer" || !node.firstChild?.isTextblock) return;
    const start = position + 2, end = start + node.firstChild.content.size;
    if (selection.from < start || selection.to > end || selection.empty) return;
    const from = selection.from - start, to = selection.to - start;
    const sourceText = node.firstChild.textContent, quote = sourceText.slice(from, to);
    if (quote.trim() && quote.length <= 500) anchor = { blockId: node.attrs.id, quote, prefix: sourceText.slice(0, from).slice(-64), suffix: sourceText.slice(to, to + 64), from, to, sourceText };
  });
  if (!anchor) throw new Error("Select up to 500 characters within one text block to add a comment.");
  return anchor;
}

export function captureCommentSelection(editor: BlockNoteEditor<any, any, any>) {
  selectedAnchor(editor);
  const from = trackPosition(editor, editor.prosemirrorState.selection.from, "right");
  const to = trackPosition(editor, editor.prosemirrorState.selection.to, "left");
  return { range: () => ({ from: from(), to: to() }), anchor: () => selectedAnchor(editor, { from: from(), to: to(), empty: from() >= to() }) };
}

export function documentWithAnchors(editor: Editor): Block[] {
  const ranges = new Map<string, Range[]>();
  editor.prosemirrorState.doc.descendants((node) => {
    if (node.type.name !== "blockContainer" || !node.firstChild?.isTextblock) return;
    const found: Range[] = [];
    node.firstChild.descendants((child, offset) => {
      if (!child.isText) return;
      for (const mark of child.marks) if (mark.type.name === "comment" && typeof mark.attrs.threadId === "string") {
        const previous = found.find(range => range.threadId === mark.attrs.threadId && range.to === offset);
        if (previous) previous.to = offset + child.nodeSize;
        else found.push({ threadId: mark.attrs.threadId, from: offset, to: offset + child.nodeSize });
      }
    });
    ranges.set(node.attrs.id, found);
  });
  const walk = (blocks: Block[]): Block[] => blocks.map(block => ({ ...block, commentRanges: ranges.get(block.id as string) ?? [], ...(Array.isArray(block.children) ? { children: walk(block.children) } : {}) }));
  return walk(editor.document as Block[]);
}

export function hydrateAnchors(editor: Editor, threads: Thread[], content: Block[] = []) {
  const persisted = new Map<string, Range[]>();
  const walk = (blocks: Block[]) => { for (const block of blocks) { if (Array.isArray(block.commentRanges)) persisted.set(block.id as string, block.commentRanges as Range[]); if (Array.isArray(block.children)) walk(block.children); } };
  walk(content);
  editor.transact(transaction => {
    const mark = transaction.doc.type.schema.marks.comment;
    if (!mark) return;
    transaction.setMeta("addToHistory", false);
    transaction.doc.descendants((node, position) => {
      if (node.type.name !== "blockContainer" || !node.firstChild?.isTextblock) return;
      for (const thread of threads) {
        if (thread.kind !== "inline" || thread.anchorStatus !== "attached") continue;
        const ranges = (persisted.get(node.attrs.id) ?? []).filter(range => range.threadId === thread.id);
        const placement = thread.placement;
        if (!ranges.length && placement && placement.blockId === node.attrs.id) ranges.push({ ...placement, threadId: thread.id });
        for (const range of ranges) if (range.from >= 0 && range.to > range.from && range.to <= node.firstChild.content.size) transaction.addMark(position + 2 + range.from, position + 2 + range.to, mark.create({ threadId: thread.id, orphan: thread.resolved }));
      }
    });
  });
}
