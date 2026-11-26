import { ChevronLeft, ChevronRight, FileText, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TreePage } from "./pagesApi";
import { visiblePageTreeActions, type TreeAction } from "./pageActions";

export type { TreeAction } from "./pageActions";
export type SpaceRef = { id: string | null; name: string };
// Children are keyed by parent id; top-level pages by "space:<id>" ("space:" is the company space).
export const rootKey = (spaceId: string | null) => `space:${spaceId ?? ""}`;
export function childrenMap(pages: TreePage[]) {
  const map = new Map<string, TreePage[]>();
  for (const page of pages) {
    const key = page.parentId ?? rootKey(page.spaceId);
    map.set(key, [...map.get(key) ?? [], page]);
  }
  return map;
}

type TreeProps = { children: Map<string, TreePage[]>; currentId: string | null; expanded: Set<string>; busy: boolean; canCreate: boolean; onToggle: (key: string) => void; onAction: (action: TreeAction, page: TreePage) => void };
const pageSize = 25;

function PaginatedPages({ pages, depth, props }: { pages: TreePage[]; depth: number; props: TreeProps }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(pages.length / pageSize);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const start = safePage * pageSize;
  return <>
    <ul className="pw-tree">{pages.slice(start, start + pageSize).map((item, offset) => <PageItem key={item.id} page={item} siblings={pages} index={start + offset} depth={depth} props={props}/>)}</ul>
    {pageCount > 1 && <nav className="pw-pagination" aria-label="Page list pagination">
      <button type="button" aria-label="Previous page list page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={13}/></button>
      <span>Page {safePage + 1} of {pageCount}</span>
      <button type="button" aria-label="Next page list page" disabled={safePage === pageCount - 1} onClick={() => setPage(safePage + 1)}><ChevronRight size={13}/></button>
    </nav>}
  </>;
}

// Row buttons stay enabled while other work runs (a disabled button swallows clicks); the workspace ignores repeat creates itself.
function PageItem({ page, siblings, index, depth, props }: { page: TreePage; siblings: TreePage[]; index: number; depth: number; props: TreeProps }) {
  const kids = props.children.get(page.id) ?? [];
  const open = props.expanded.has(page.id);
  const actions = visiblePageTreeActions(page.role);
  const title = page.title || "Untitled";
  return <li>
    <div className={`pw-tree-row ${props.currentId === page.id ? "pw-tree-current" : ""}`} style={{ paddingLeft: 4 + depth * 14 }}>
      {kids.length ? <button type="button" className="pw-tree-toggle" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${title}`} onClick={() => props.onToggle(page.id)}><ChevronRight size={13} className={open ? "pw-rotate" : ""}/></button>
        : <span className="pw-tree-toggle" aria-hidden="true"><FileText size={13}/></span>}
      <button type="button" className="pw-tree-title" aria-current={props.currentId === page.id ? "page" : undefined} onClick={() => props.onAction("open", page)}>{title}</button>
      {actions.includes("subpage") && <button type="button" className="pw-tree-icon" aria-label={`Add a subpage to ${title}`} title="Add subpage" aria-busy={props.busy || undefined} onClick={() => props.onAction("subpage", page)}><Plus size={14}/></button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="pw-tree-icon" aria-label={`More actions for ${title}`} title="More actions"><MoreHorizontal size={14}/></button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => props.onAction("open", page)}>Open</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onAction("share", page)}>Share / Permissions</DropdownMenuItem>
          {actions.includes("subpage") && <DropdownMenuItem onSelect={() => props.onAction("subpage", page)}>Add subpage</DropdownMenuItem>}
          {actions.includes("rename") && <DropdownMenuItem onSelect={() => props.onAction("rename", page)}>Rename</DropdownMenuItem>}
          {actions.includes("duplicate") && <DropdownMenuItem onSelect={() => props.onAction("duplicate", page)}>Duplicate</DropdownMenuItem>}
          {actions.includes("move") && <><DropdownMenuSeparator/>
            <DropdownMenuItem onSelect={() => props.onAction("move", page)}>Move to…</DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => props.onAction("up", page)}>Move up</DropdownMenuItem>
            <DropdownMenuItem disabled={index === siblings.length - 1} onSelect={() => props.onAction("down", page)}>Move down</DropdownMenuItem>
            <DropdownMenuSeparator/>
            <DropdownMenuItem variant="destructive" onSelect={() => props.onAction("archive", page)}>Move to archive</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {open && kids.length > 0 && <PaginatedPages pages={kids} depth={depth + 1} props={props}/>}
  </li>;
}

export function SpaceTree({ space, onCreate, onPermissions, ...props }: TreeProps & { space: SpaceRef; onCreate: (spaceId: string | null) => void; onPermissions: () => void }) {
  const key = rootKey(space.id);
  const pages = props.children.get(key) ?? [];
  const open = !props.expanded.has(`collapsed:${key}`);
  return <section className="pw-space" aria-label={space.name}>
    <div className="pw-space-head">
      <button type="button" className="pw-space-toggle" aria-expanded={open} onClick={() => props.onToggle(`collapsed:${key}`)}><ChevronRight size={12} className={open ? "pw-rotate" : ""}/><span>{space.name}</span></button>
      {space.id && <button type="button" className="pw-tree-icon" aria-label={`Permissions for ${space.name}`} title="Space permissions" onClick={onPermissions}><MoreHorizontal size={14}/></button>}
      {props.canCreate && <button type="button" className="pw-tree-icon" aria-label={`New page in ${space.name}`} title="New page" aria-busy={props.busy || undefined} onClick={() => onCreate(space.id)}><Plus size={14}/></button>}
    </div>
    {open && (pages.length ? <PaginatedPages pages={pages} depth={0} props={props}/>
      : <p className="pw-tree-empty">No pages yet.</p>)}
  </section>;
}
