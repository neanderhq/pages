import { BlockNoteSchema, defaultBlockSpecs, type PartialBlock } from "@blocknote/core";
import { CommentsExtension } from "@blocknote/core/comments";
import { AddCommentButton, FloatingComposerController, FloatingThreadController, FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useEffect, useMemo, useRef, useState } from "react";
import "@blocknote/shadcn/style.css";
import type { Block } from "./pagesApi";
import { commentsChanged, isInsideMentionPickerOrComposer, mentionQueryAt, mentionSuggestionKeyDisposition, type CollabApi, type MentionMember } from "./collabApi";
import { CommentAuth, commentSchema, ServerThreadStore } from "./commentStore";
import { captureCommentSelection, documentWithAnchors, hydrateAnchors } from "./editorAnchors";
import { Button } from "./components/ui/button";
import { PageOutline } from "./PageOutline";
import { pageHeadings } from "./pageToolsModel";

// Only the block types the server keeps (server/content.ts), so nothing a person types silently disappears on save.
const schema = BlockNoteSchema.create({ blockSpecs: {
  paragraph: defaultBlockSpecs.paragraph, heading: defaultBlockSpecs.heading, quote: defaultBlockSpecs.quote,
  bulletListItem: defaultBlockSpecs.bulletListItem, numberedListItem: defaultBlockSpecs.numberedListItem, checkListItem: defaultBlockSpecs.checkListItem,
  table: defaultBlockSpecs.table, codeBlock: defaultBlockSpecs.codeBlock, image: defaultBlockSpecs.image, file: defaultBlockSpecs.file,
} });
type Partial = PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;

export default function PageEditor({ content, editable, label, onChange, comments, uploadFile, outline = false }: {
  content: Block[]; editable: boolean; label: string;
  onChange?: (document: Block[]) => void;
  comments?: { api: CollabApi; pageId: string; userId: string; canComment: boolean; isAdmin: boolean; prepare: () => Promise<void>; onCreated: () => void };
  uploadFile?: (file: File) => Promise<string>;
  outline?: boolean;
}) {
  const current = useRef({ onChange, comments }); current.current = { onChange, comments };
  const [ready, setReady] = useState(!comments), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const hydrating = useRef(false);
  const [headings, setHeadings] = useState(() => pageHeadings(content));
  const pendingSelection = useRef<ReturnType<typeof captureCommentSelection> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const commentFloatingOptions = useMemo(() => ({ useDismissProps: {
    // The autocomplete is portalled beside the native composer. Choosing one
    // of its options belongs to that draft, rather than an outside click.
    outsidePress: (event: MouseEvent) => !event.composedPath().some(element => element instanceof HTMLElement && element.classList.contains("pw-inline-mention-options") && element.dataset.pageId === comments?.pageId),
  } }), [comments?.pageId]);
  const store = useMemo(() => comments ? new ServerThreadStore(comments.api, comments.pageId, new CommentAuth(comments.userId, comments.canComment, comments.isAdmin)) : undefined, [comments?.api, comments?.pageId, comments?.userId]);
  if (store) (store.auth as CommentAuth).writable = !!comments?.canComment;
  const editor = useCreateBlockNote({ schema, initialContent: content.length ? content as unknown as Partial[] : undefined, uploadFile: editable ? uploadFile : undefined,
    extensions: store ? [CommentsExtension({ threadStore: store, schema: commentSchema, resolveUsers: async ids => ids.map(id => ({ id, username: store.rows.flatMap(thread => thread.messages).find(message => message.authorId === id)?.authorName ?? "Teammate", avatarUrl: "" })) })] : [],
  }, [store]);
  if (store) {
    store.getAnchor = async () => {
      pendingSelection.current = captureCommentSelection(editor);
      await current.current.comments?.prepare();
      return pendingSelection.current.anchor();
    };
    store.onError = failure => setError(failure instanceof Error ? failure.message : "Could not save the comment. Your draft is still open.");
    store.addThreadToDocument = async ({ threadId }) => {
      const range = pendingSelection.current?.range(); pendingSelection.current = null;
      if (range && range.from < range.to) editor.transact(transaction => {
        transaction.addMark(range.from, range.to, transaction.doc.type.schema.marks.comment.create({ threadId, orphan: false }));
      });
      setError(""); current.current.comments?.onCreated();
    };
  }
  useEffect(() => {
    if (!store) return;
    let active = true;
    void store.reload().then(() => {
      if (!active) return;
      hydrating.current = true;
      hydrateAnchors(editor, store.rows, content);
      hydrating.current = false; setReady(true); setError("");
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Could not load comments."); });
    const refresh = () => { void store.reload().catch(failure => store.onError(failure)); };
    window.addEventListener(commentsChanged, refresh);
    return () => { active = false; window.removeEventListener(commentsChanged, refresh); };
  }, [store, editor, attempt]);
  useEffect(() => {
    if (!comments || !root.current) return;
    return attachInlineMentionAutocomplete(root.current, comments.api, comments.pageId);
  }, [comments?.api, comments?.pageId]);
  return <div ref={root} className="pw-editor" aria-label={label}>
    {outline && <PageOutline headings={headings} onJump={id => {
      const target = Array.from(editor.domElement?.querySelectorAll<HTMLElement>("[data-id]") ?? []).find(element => element.dataset.id === id);
      if (!target) return;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }}/>}
    {error && <div className="wiki-notice" role="alert">{error}{!ready && <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry comments</Button>}</div>}
    <BlockNoteView editor={editor} editable={editable && ready} theme="light" formattingToolbar={false} comments={false} onChange={() => { if (ready && !hydrating.current) { const document = documentWithAnchors(editor); if (outline) setHeadings(pageHeadings(document)); current.current.onChange?.(document); } }}>
      {(editable || comments?.canComment) && <FormattingToolbarController formattingToolbar={() => <FormattingToolbar>{editable ? getFormattingToolbarItems().filter(item => comments?.canComment || item.key !== "addCommentButton") : <AddCommentButton/>}</FormattingToolbar>}/>}
      {comments?.canComment && <><FloatingComposerController floatingUIOptions={commentFloatingOptions}/><FloatingThreadController floatingUIOptions={commentFloatingOptions}/></>}
    </BlockNoteView>
  </div>;
}

function attachInlineMentionAutocomplete(root: HTMLElement, api: CollabApi, pageId: string) {
  const popup = document.createElement("div");
  popup.className = "pw-inline-mention-options";
  popup.dataset.pageId = pageId;
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", "Mention a workspace member");
  let target: HTMLElement | null = null;
  let members: MentionMember[] = [];
  let active = 0;
  let requestId = 0;
  let visible = false;
  const popupId = `pw-inline-mentions-${Math.random().toString(36).slice(2)}`;
  popup.id = popupId;

  function caretRect(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return element.getBoundingClientRect();
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : element.getBoundingClientRect();
  }
  function position() {
    if (!target || !visible) return;
    const rect = caretRect(target);
    const width = Math.min(320, window.innerWidth - 24);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    const below = rect.bottom + 6;
    popup.style.top = `${below + 240 > window.innerHeight ? Math.max(12, rect.top - 246) : below}px`;
  }
  function dismiss() {
    visible = false; members = []; requestId++;
    popup.remove();
    if (target) { target.setAttribute("aria-expanded", "false"); target.removeAttribute("aria-controls"); target.removeAttribute("aria-activedescendant"); }
    target = null;
  }
  function choose(member: MentionMember) {
    if (!target) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const caret = selection.getRangeAt(0).cloneRange();
    caret.collapse(true);
    const prefix = caret.cloneRange();
    prefix.selectNodeContents(target);
    prefix.setEnd(caret.startContainer, caret.startOffset);
    const before = prefix.toString();
    const mention = mentionQueryAt(before, before.length);
    if (!mention) { dismiss(); return; }
    const startOffset = mention.start;
    const endOffset = mention.end;
    const locate = (offset: number) => {
      const walker = document.createTreeWalker(target!, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      let remaining = offset;
      while (node) {
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
        node = walker.nextNode() as Text | null;
      }
      const last = target!.lastChild;
      return last?.nodeType === Node.TEXT_NODE ? { node: last as Text, offset: (last.textContent ?? "").length } : null;
    };
    const start = locate(startOffset), end = locate(endOffset);
    if (!start || !end) { dismiss(); return; }
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    range.deleteContents();
    const token = document.createTextNode(`@${member.email}`);
    range.insertNode(token);
    range.setStartAfter(token); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    target.focus();
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: `@${member.email}` }));
    dismiss();
  }
  function render() {
    popup.replaceChildren(...members.map((member, index) => {
      const option = document.createElement("button");
      option.id = `${popupId}-${index}`;
      option.type = "button"; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === active));
      const name = document.createElement("strong"), email = document.createElement("span");
      name.textContent = member.name; email.textContent = member.email;
      option.append(name, email);
      option.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
      option.addEventListener("click", () => choose(member));
      return option;
    }));
    if (members.length) {
      visible = true;
      if (!popup.isConnected) document.body.append(popup);
      target?.setAttribute("aria-expanded", "true"); target?.setAttribute("aria-controls", popupId); target?.setAttribute("aria-activedescendant", `${popupId}-${active}`);
      position();
    } else dismiss();
  }
  async function update(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !element.contains(selection.anchorNode)) { dismiss(); return; }
    const caret = selection.getRangeAt(0).cloneRange(); caret.collapse(true);
    const prefix = caret.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(caret.startContainer, caret.startOffset);
    const before = prefix.toString();
    const match = mentionQueryAt(before, before.length);
    if (!match?.query) { dismiss(); return; }
    target = element;
    const currentRequest = ++requestId;
    try {
      const result = await api.mentionMembers(pageId, match.query);
      if (currentRequest !== requestId || target !== element) return;
      members = result.members; active = 0; render();
    } catch { if (currentRequest === requestId) dismiss(); }
  }
  function onInput(event: Event) { const element = event.currentTarget as HTMLElement; void update(element); }
  function onKeyDown(event: KeyboardEvent) {
    const disposition = mentionSuggestionKeyDisposition(event.key, target === event.currentTarget && visible && members.length > 0);
    if (disposition === "submit") return;
    if (disposition === "select") {
      if (target !== event.currentTarget || !members.length) return;
      event.preventDefault(); event.stopImmediatePropagation(); choose(members[active]);
      return;
    }
    if (target !== event.currentTarget || !members.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopImmediatePropagation(); active = (active + (event.key === "ArrowDown" ? 1 : members.length - 1)) % members.length; render();
    } else if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); dismiss(); }
  }
  function onDocumentPointerDown(event: PointerEvent) {
    const inside = isInsideMentionPickerOrComposer(event.composedPath(), event.target, popup, target, (surface, pointerTarget) => surface instanceof Node && pointerTarget instanceof Node && surface.contains(pointerTarget));
    if (visible && !inside) dismiss();
  }
  function attach() {
    root.querySelectorAll<HTMLElement>('.bn-comment-editor[contenteditable="true"], .bn-comment-editor [contenteditable="true"]').forEach(element => {
      if (element.dataset.mentionAutocomplete) return;
      element.dataset.mentionAutocomplete = "true";
      element.setAttribute("aria-autocomplete", "list"); element.setAttribute("aria-expanded", "false");
      element.addEventListener("input", onInput); element.addEventListener("keydown", onKeyDown, true);
    });
  }
  const observer = new MutationObserver(attach);
  observer.observe(root, { childList: true, subtree: true });
  attach();
  const reposition = () => position();
  window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  return () => {
    observer.disconnect(); dismiss(); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    root.querySelectorAll<HTMLElement>("[data-mention-autocomplete]").forEach(element => {
      element.removeEventListener("input", onInput); element.removeEventListener("keydown", onKeyDown, true); delete element.dataset.mentionAutocomplete;
      element.removeAttribute("aria-autocomplete"); element.removeAttribute("aria-expanded");
    });
  };
}
