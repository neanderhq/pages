import { randomUUID } from "node:crypto";
import { fail } from "./http.ts";
import { blockTexts } from "./anchors.ts";

// Server-side allowlist for BlockNote document JSON. Anything not listed here is dropped; structural abuse
// (too large, too deep, too many blocks) is rejected with 400 so nothing unexpected is ever stored.
export const maxContentBytes = 1_000_000;
const maxDepth = 8;
const maxBlocks = 5_000;
const maxText = 100_000;
const colors = new Set(["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const alignments = new Set(["left", "center", "right", "justify"]);
const blockTypes = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "table", "codeBlock", "image", "file"]);
const attachmentUrl = /^\/api\/companies\/[A-Za-z0-9-]{1,64}\/attachments\/[0-9a-f-]{36}$/i;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = maxText) => typeof value === "string" ? value.slice(0, max) : undefined;
const color = (value: unknown) => typeof value === "string" && colors.has(value) ? value : undefined;

export function tableCellContent(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell;
  return isObject(cell) ? cell.content : undefined;
}

export function safeLink(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  const href = value.trim();
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return href;
  try { return ["http:", "https:", "mailto:"].includes(new URL(href).protocol) ? href : undefined; }
  catch { return undefined; }
}

export function safeMediaUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  const url = value.trim();
  if (attachmentUrl.test(url)) return url;
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined; }
  catch { return undefined; }
}

function styles(value: unknown) {
  const result: Json = {};
  if (!isObject(value)) return result;
  for (const key of ["bold", "italic", "underline", "strike", "code"]) if (value[key] === true) result[key] = true;
  for (const key of ["textColor", "backgroundColor"]) { const safe = color(value[key]); if (safe) result[key] = safe; }
  return result;
}

function styledText(value: unknown) {
  if (!isObject(value) || value.type !== "text") return null;
  return { type: "text", text: text(value.text) ?? "", styles: styles(value.styles) };
}

function inline(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: Json[] = [];
  for (const item of value.slice(0, 2_000)) {
    if (isObject(item) && item.type === "link") {
      const href = safeLink(item.href);
      const content = Array.isArray(item.content) ? item.content.map(styledText).filter((part): part is NonNullable<typeof part> => !!part) : [];
      if (href) result.push({ type: "link", href, content });
      else result.push(...content);
    } else {
      const part = styledText(item);
      if (part) result.push(part);
    }
  }
  return result;
}

function props(type: string, value: unknown) {
  const source = isObject(value) ? value : {};
  const result: Json = {};
  for (const key of ["textColor", "backgroundColor"]) { const safe = color(source[key]); if (safe) result[key] = safe; }
  if (typeof source.textAlignment === "string" && alignments.has(source.textAlignment)) result.textAlignment = source.textAlignment;
  if (type === "heading") {
    result.level = Number.isInteger(source.level) && (source.level as number) >= 1 && (source.level as number) <= 6 ? source.level : 1;
    if (typeof source.isToggleable === "boolean") result.isToggleable = source.isToggleable;
  }
  if (type === "checkListItem") result.checked = source.checked === true;
  if (type === "numberedListItem" && Number.isInteger(source.start) && (source.start as number) >= 0 && (source.start as number) < 1_000_000) result.start = source.start;
  if (type === "codeBlock") { const language = text(source.language, 40); if (language && /^[A-Za-z0-9+#._-]*$/.test(language)) result.language = language; }
  if (type === "image" || type === "file") {
    result.url = safeMediaUrl(source.url) ?? "";
    for (const key of ["name", "caption"]) result[key] = text(source[key], 500) ?? "";
    if (type === "image") {
      if (typeof source.showPreview === "boolean") result.showPreview = source.showPreview;
      if (typeof source.previewWidth === "number" && source.previewWidth > 0 && source.previewWidth <= 4_000) result.previewWidth = Math.round(source.previewWidth);
    }
  }
  return result;
}

function table(value: unknown) {
  const source = isObject(value) ? value : {};
  const rows = Array.isArray(source.rows) ? source.rows.slice(0, 200) : [];
  const result: Json = { type: "tableContent", rows: rows.map(row => ({
    cells: (isObject(row) && Array.isArray(row.cells) ? row.cells.slice(0, 50) : []).map(cell => {
      if (!isObject(cell) || cell.type !== "tableCell") return inline(cell);
      const cellProps: Json = {};
      const cellSource = isObject(cell.props) ? cell.props : {};
      for (const key of ["textColor", "backgroundColor"]) { const safe = color(cellSource[key]); if (safe) cellProps[key] = safe; }
      if (typeof cellSource.textAlignment === "string" && alignments.has(cellSource.textAlignment)) cellProps.textAlignment = cellSource.textAlignment;
      for (const key of ["colspan", "rowspan"]) if (Number.isInteger(cellSource[key]) && (cellSource[key] as number) >= 1 && (cellSource[key] as number) <= 50) cellProps[key] = cellSource[key];
      return { type: "tableCell", props: cellProps, content: inline(cell.content) };
    }),
  })) };
  if (Array.isArray(source.columnWidths)) result.columnWidths = source.columnWidths.slice(0, 50).map(width => typeof width === "number" && width > 0 && width < 4_000 ? width : null);
  for (const key of ["headerRows", "headerCols"]) if (Number.isInteger(source[key]) && (source[key] as number) >= 0 && (source[key] as number) <= 10) result[key] = source[key];
  return result;
}

// Returns a cleaned copy of a BlockNote document, or throws a 400 HttpError when the document is unusable.
export function sanitizeContent(value: unknown): Json[] {
  if (!Array.isArray(value)) return fail(400, "Page content must be a list of blocks.");
  if (JSON.stringify(value).length > maxContentBytes) fail(413, "This page is too large to save.");
  let count = 0;
  const blocks = (list: unknown[], depth: number): Json[] => {
    if (depth > maxDepth) fail(400, "Page content is nested too deeply.");
    const result: Json[] = [];
    for (const item of list) {
      if (!isObject(item) || typeof item.type !== "string" || !blockTypes.has(item.type)) continue;
      if (++count > maxBlocks) fail(400, "Page content has too many blocks.");
      const type = item.type;
      const id = typeof item.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : randomUUID();
      const content = type === "table" ? table(item.content) : type === "image" || type === "file" ? undefined : inline(item.content);
      const children = Array.isArray(item.children) && item.children.length > 0 && type !== "table" ? blocks(item.children, depth + 1) : [];
      const block = { id, type, props: props(type, item.props), ...(content === undefined ? {} : { content }), children };
      const length = blockTexts([block])[0]?.text.length ?? 0;
      const commentRanges = Array.isArray(item.commentRanges) ? item.commentRanges.slice(0, 500).filter((range): range is Json => isObject(range) && typeof range.threadId === "string" && /^[0-9a-f-]{36}$/i.test(range.threadId) && Number.isInteger(range.from) && Number.isInteger(range.to) && (range.from as number) >= 0 && (range.to as number) > (range.from as number) && (range.to as number) <= length).map(range => ({ threadId: range.threadId, from: range.from, to: range.to })) : [];
      result.push({ ...block, ...(commentRanges.length ? { commentRanges } : {}) });
    }
    return result;
  };
  return blocks(value, 1);
}

function unescapeMarkdown(value: string) {
  return value.replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1");
}

function markdownInline(source: string): Json[] {
  const result: Json[] = [];
  const appendText = (value: string, style: Json = {}) => {
    const previous = result.at(-1);
    if (previous?.type === "text" && JSON.stringify(previous.styles) === JSON.stringify(style)) previous.text = String(previous.text) + value;
    else result.push({ type: "text", text: value, styles: style });
  };
  const pattern = /\\([\\`*_{}\[\]()#+.!|>~-])|\[((?:\\.|[^\]\\])+)\]\(((?:\\.|[^)\\\s])+)(?:\s+"[^"]*")?\)|\*\*((?:\\.|[^*\\])+)\*\*|__((?:\\.|[^_\\])+)__|~~((?:\\.|[^~\\])+)~~|`([^`]+)`|\*((?:\\.|[^*\\])+)\*|_((?:\\.|[^_\\])+)_/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) appendText(source.slice(offset, index));
    const label = match[2] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? match[8] ?? match[9];
    if (match[1] !== undefined) appendText(match[1]);
    else if (match[2] !== undefined) result.push({ type: "link", href: unescapeMarkdown(match[3]), content: [{ type: "text", text: unescapeMarkdown(label), styles: {} }] });
    else appendText(match[7] !== undefined ? label : unescapeMarkdown(label), {
      ...(match[4] !== undefined || match[5] !== undefined ? { bold: true } : {}),
      ...(match[6] !== undefined ? { strike: true } : {}),
      ...(match[7] !== undefined ? { code: true } : {}),
      ...(match[8] !== undefined || match[9] !== undefined ? { italic: true } : {}),
    });
    offset = index + match[0].length;
  }
  if (offset < source.length) appendText(source.slice(offset));
  return result;
}

function markdownCells(line: string) {
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, "|").trim());
}

function inlineText(value: Json[]): string {
  return value.map(part => part.type === "text" ? String(part.text ?? "") : part.type === "link" && Array.isArray(part.content) ? inlineText(part.content as Json[]) : "").join("");
}

function markdownHeadingTitle(line: string | undefined) {
  const heading = line?.match(/^ {0,3}#\s+(.+?)\s*$/);
  if (!heading) return undefined;
  const source = heading[1].replace(/\s+#+$/, "");
  return inlineText(markdownInline(source)).trim() || undefined;
}

export function markdownImportTitle(markdown: string, fallback: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] === "<!-- pages:page-title -->" || lines[0] === "<!-- team-wiki:page-title -->") {
    const markedTitle = markdownHeadingTitle(lines[1]);
    if (markedTitle) return markedTitle;
  }
  for (const line of lines) {
    const title = markdownHeadingTitle(line);
    if (title) return title;
  }
  return fallback;
}

export function markdownToContent(markdown: string): Json[] {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/^<!-- (?:pages|team-wiki):page-title -->\n# [^\n]*(?:\n\n|$)/, "").split("\n");
  const blocks: Json[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", content: markdownInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s*```([A-Za-z0-9+#._-]{0,40})\s*$/);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      while (++index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index]);
      blocks.push({ type: "codeBlock", props: { language: fence[1] ?? "" }, content: [{ type: "text", text: code.join("\n"), styles: {} }] });
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { flushParagraph(); blocks.push({ type: "heading", props: { level: heading[1].length }, content: markdownInline(heading[2]) }); continue; }
    const image = line.match(/^!\[((?:\\.|[^\]\\])*)\]\(((?:\\.|[^)\\])+)\)\s*$/);
    if (image) { flushParagraph(); blocks.push({ type: "image", props: { url: unescapeMarkdown(image[2]), name: unescapeMarkdown(image[1]), caption: unescapeMarkdown(image[1]), showPreview: true } }); continue; }
    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      flushParagraph();
      const headers = markdownCells(line);
      index++;
      const rows = [{ cells: headers.map(cell => ({ type: "tableCell", props: {}, content: markdownInline(cell) })) }];
      while (index + 1 < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[index + 1])) {
        const cells = markdownCells(lines[++index]);
        rows.push({ cells: headers.map((_, cellIndex) => ({ type: "tableCell", props: {}, content: markdownInline(cells[cellIndex] ?? "") })) });
      }
      blocks.push({ type: "table", content: { type: "tableContent", rows, headerRows: 1 } });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { flushParagraph(); blocks.push({ type: "quote", content: markdownInline(quote[1]) }); continue; }
    const list = line.match(/^\s*(?:([-+*])\s+|\d+[.)]\s+)(?:\[([ xX])\]\s+)?(.*)$/);
    if (list) {
      flushParagraph();
      const type = list[2] !== undefined ? "checkListItem" : /^\s*\d/.test(line) ? "numberedListItem" : "bulletListItem";
      blocks.push({ type, props: type === "checkListItem" ? { checked: list[2].toLowerCase() === "x" } : {}, content: markdownInline(list[3]) });
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");
}

function markdownCodeSpan(value: string): string {
  if (!value) return "";
  const longest = (value.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const padding = /^[` ]|[` ]$/.test(value) && /[^ ]/.test(value) ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function renderInline(value: unknown, tableCell = false): string {
  if (!Array.isArray(value)) return "";
  return value.map((item: unknown): string => {
    if (!isObject(item)) return "";
    if (item.type === "link") {
      const href = safeLink(item.href);
      const label = renderInline(item.content, tableCell);
      return href ? `[${label}](${href.replace(/[)\\|]/g, "\\$&")})` : label;
    }
    if (item.type !== "text") return "";
    const content = String(item.text ?? "");
    const style = isObject(item.styles) ? item.styles : {};
    if (style.code === true) return (tableCell ? content.split("|") : [content]).map(markdownCodeSpan).join("\\|");
    return `${style.bold === true ? "**" : ""}${style.italic === true ? "*" : ""}${style.strike === true ? "~~" : ""}${escapeMarkdown(content)}${style.strike === true ? "~~" : ""}${style.italic === true ? "*" : ""}${style.bold === true ? "**" : ""}`;
  }).join("");
}

function renderBlock(block: Json, depth: number): string {
  const type = typeof block.type === "string" ? block.type : "";
  const props = isObject(block.props) ? block.props : {};
  const children = Array.isArray(block.children) ? block.children.filter(isObject) : [];
  const textContent = renderInline(block.content);
  let output = "";
  if (type === "heading") output = `${"#".repeat(Number(props.level) || 1)} ${textContent}`;
  else if (type === "bulletListItem") output = `${"  ".repeat(depth)}- ${textContent}`;
  else if (type === "numberedListItem") output = `${"  ".repeat(depth)}${Number(props.start) || 1}. ${textContent}`;
  else if (type === "checkListItem") output = `${"  ".repeat(depth)}- [${props.checked === true ? "x" : " "}] ${textContent}`;
  else if (type === "quote") output = textContent.split("\n").map(line => `> ${line}`).join("\n");
  else if (type === "codeBlock") {
    const code = Array.isArray(block.content) ? block.content.map(part => isObject(part) ? String(part.text ?? "") : "").join("") : "";
    output = `\`\`\`${typeof props.language === "string" ? props.language : ""}\n${code}\n\`\`\``;
  } else if (type === "table" && isObject(block.content) && Array.isArray(block.content.rows)) {
    const rows = block.content.rows.map(row => isObject(row) && Array.isArray(row.cells) ? row.cells.map(cell => renderInline(tableCellContent(cell), true)) : []);
    if (rows.length) output = [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => `| ${row.join(" | ")} |`).join("\n");
  } else if (type === "image") output = `![${escapeMarkdown(String(props.caption || props.name || "image"))}](${String(props.url ?? "").replace(/[)\\]/g, "\\$&")})`;
  else if (type === "file") output = `[${escapeMarkdown(String(props.name || "file"))}](${String(props.url ?? "")})`;
  else output = textContent;
  if (children.length) output += `\n${children.map(child => renderBlock(child, depth + 1)).join("\n")}`;
  return output;
}

export function contentToMarkdown(title: string, content: unknown): string {
  const heading = `<!-- pages:page-title -->\n# ${escapeMarkdown((title || "Untitled").replace(/[\r\n\u2028\u2029]+/g, " "))}`;
  const blocks = Array.isArray(content) ? content.filter(isObject).map(block => renderBlock(block, 0)).filter(Boolean) : [];
  return [heading, ...blocks].join("\n\n");
}
