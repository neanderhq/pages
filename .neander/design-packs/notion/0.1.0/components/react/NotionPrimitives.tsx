import * as React from 'react';
import { NotionSelect } from './NotionSelect';
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from './ui/command';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import * as MenuPrimitive from './ui/dropdown-menu';
import * as PopoverPrimitive from './ui/popover';
import { Search, FileText, Table2, Heading1, Heading2, Heading3, List, CheckSquare, ArrowUp, ArrowDown, Trash2, Star, Heart, Flag, Lightbulb, Plane, BookOpen, CalendarDays, Code, Quote, Minus, Image, ListOrdered, ChevronRight, PanelsTopLeft, Link2, Upload, Target, Rocket, Globe2, Smile, Zap, Folder, BriefcaseBusiness, Palette, type LucideIcon } from "./ui/icons";

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>;
export const NotionButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function NotionButton(
  { variant = 'ghost', type = 'button', ...props }, ref,
) {
  return <Button ref={ref} type={type} variant={variant} {...props} />;
});

export type NotionSearchPage = { id: string; title: string; icon?: string; parentId?: string | null; createdBy?:string;database?:unknown;favorite?:boolean;kind?:'page'|'meeting'|'agent';lastEditedLabel?: string; blocks?: { text: string }[] };

export const notionLineIcons: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'file', label: 'File', Icon: FileText }, { id: 'table', label: 'Table', Icon: Table2 }, { id: 'star', label: 'Star', Icon: Star },
  { id: 'heart', label: 'Heart', Icon: Heart }, { id: 'flag', label: 'Flag', Icon: Flag },
  { id: 'idea', label: 'Light bulb', Icon: Lightbulb }, { id: 'plane', label: 'Plane', Icon: Plane },
  { id: 'book', label: 'Book', Icon: BookOpen }, { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'target', label: 'Target', Icon: Target }, { id: 'rocket', label: 'Rocket', Icon: Rocket },
  { id: 'globe', label: 'Globe', Icon: Globe2 }, { id: 'search', label: 'Search', Icon: Search },
  { id: 'smile', label: 'Smile', Icon: Smile }, { id: 'zap', label: 'Lightning', Icon: Zap },
  { id: 'folder', label: 'Folder', Icon: Folder }, { id: 'briefcase', label: 'Briefcase', Icon: BriefcaseBusiness },
  { id: 'palette', label: 'Palette', Icon: Palette },
];

export function NotionIconGlyph({ icon, size = 18 }: { icon?: string; size?: number }) {
  if (!icon) return <FileText size={size} />;
  if (icon === 'notion-icon:agent') return <svg className="notion-agent-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M1 7h5l-2 6H2L1 7Zm7 0h5l-2 6H9L8 7Zm7 0h4l-2 6h-2l1-4h-2l1-2Z" /></svg>;
  if (icon.startsWith('notion-icon:')) {
    const entry = notionLineIcons.find((item) => item.id === icon.slice('notion-icon:'.length));
    return entry ? <entry.Icon size={size} strokeWidth={1.8} /> : <FileText size={size} />;
  }
  if (/^(data:image\/(png|jpeg|webp|gif);base64,|https:\/\/)/.test(icon)) return <img className="notion-uploaded-icon" style={{ width: size, height: size }} src={icon} alt="" />;
  return <span className="notion-emoji-glyph" style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
}

/** Workspace search composes the adopted shadcn Command and Dialog sources. */
export function NotionSearch({ pages, onSelect, label = 'Search', disabled = false, theme = 'light' }: {
  pages: NotionSearchPage[];
  onSelect: (id: string) => void;
  label?: string;
  disabled?: boolean;
  theme?: 'light' | 'dark';
}) {
  const [open, setOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState('');
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [query,setQuery]=React.useState(''),[type,setType]=React.useState('all'),[creator,setCreator]=React.useState(''),[parent,setParent]=React.useState(''),[titleOnly,setTitleOnly]=React.useState(true);
  const visible=pages.filter(page=>(type==='all'||(type==='database'?Boolean(page.database):type==='meeting'?page.kind==='meeting':type==='agent'?page.kind==='agent':!page.database))&&(!creator||page.createdBy===creator)&&(!parent||page.parentId===parent)&&[page.title,...(titleOnly?[]:page.blocks?.map(block=>block.text)??[])].join(' ').toLowerCase().includes(query.toLowerCase()));
  const selected = visible.find((page) => page.id === activeId) ?? visible[0];
  const previewText = selected?.blocks?.find((block) => block.text && block.text !== selected.title)?.text.split(/\n\s*\n/)[0] ?? '';
  const excerpt = previewText.length > 240 ? `${previewText.slice(0, 240).replace(/\s+\S*$/, '').trimEnd()}…` : previewText;
  React.useEffect(() => {
    if (disabled) return;
    const shortcut = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [disabled]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <NotionButton disabled={disabled} ref={triggerRef} aria-label={label} className="notion-sidebar-action" onClick={() => setOpen(true)}><Search size={16} aria-hidden="true" /><span>{label}</span></NotionButton>
    <DialogContent className={`notion-workspace-search notion-${theme}`} overlayClassName="notion-search-overlay" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
      <DialogTitle className="notion-ui-sr-only">Search workspace</DialogTitle><DialogDescription className="notion-ui-sr-only">Search pages. Use arrow keys to preview a result and Enter to open it.</DialogDescription>
      <Command shouldFilter={false} className="notion-command" value={activeId} onValueChange={setActiveId}>
        <CommandInput value={query} onValueChange={setQuery} aria-label="Search pages" placeholder="Search your workspace…" className="notion-command-input" autoFocus />
        <div className="notion-search-filters"><NotionButton aria-pressed={titleOnly} onClick={()=>setTitleOnly(value=>!value)}>Title only</NotionButton><NotionSelect label="Search page type" value={type} onValueChange={setType} options={[{value:'all',label:'All types'},{value:'page',label:'Pages'},{value:'database',label:'Databases'},{value:'meeting',label:'Meeting notes'},{value:'agent',label:'Agents'}]}/><NotionSelect label="Created by" value={creator} onValueChange={setCreator} options={[{value:'',label:'Created by'},...[...new Set(pages.map(page=>page.createdBy).filter((value):value is string=>Boolean(value)))].map(value=>({value,label:value}))]}/><NotionSelect label="Search within" value={parent} onValueChange={setParent} options={[{value:'',label:'In workspace'},...pages.filter(page=>pages.some(child=>child.parentId===page.id)).map(page=>({value:page.id,label:page.title||'Untitled'}))]}/></div>
        <div className="notion-search-body"><CommandList className="notion-command-list" aria-label="Page search results">
          <div className="notion-search-caption">Pages in this workspace</div><CommandEmpty className="notion-command-empty">No pages found</CommandEmpty>
          {visible.map((page) => <CommandItem key={page.id} value={page.id} keywords={[page.title || 'Untitled']} onSelect={() => { onSelect(page.id); setOpen(false); }} className="notion-command-item"><span aria-hidden="true"><NotionIconGlyph icon={page.icon} size={18} /></span><span><strong>{page.title || 'Untitled'}</strong><small>{page.lastEditedLabel || (page.parentId ? pages.find((parent) => parent.id === page.parentId)?.title : 'Private')}</small></span></CommandItem>)}
        </CommandList><aside className="notion-search-preview" aria-label="Search result preview">{selected && <><span className="notion-search-preview-icon"><NotionIconGlyph icon={selected.icon} size={38}/></span><NotionButton className="notion-search-preview-title" onClick={()=>{onSelect(selected.id);setOpen(false);}}><h2>{selected.title || 'Untitled'}</h2></NotionButton><p>{excerpt}</p></>}</aside></div>
      </Command><footer className="notion-search-footer"><span>↵ Open page</span><span>Esc to close</span></footer>
    </DialogContent>
  </Dialog>;
}

export type NotionBlockType = 'text' | 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'todo' | 'callout' | 'toc' | 'page' | 'database' | 'numbered' | 'quote' | 'toggle' | 'code' | 'divider' | 'image' | 'video' | 'audio' | 'file' | 'bookmark' | 'simple-table' | 'columns' | 'linked-database' | 'equation' | 'synced' | 'embed' | 'group';

const blockTypes: { type: NotionBlockType; label: string; icon: React.ReactNode }[] = [
  { type: 'synced', label: 'Synced block', icon: <Link2 size={16}/> },
  { type: 'embed', label: 'Embed', icon: <Globe2 size={16}/> },
  { type: 'text', label: 'Text', icon: <FileText size={16} /> },
  { type: 'numbered', label: 'Numbered list', icon: <ListOrdered size={16}/> },
  { type: 'quote', label: 'Quote', icon: <Quote size={16}/> },
  { type: 'toggle', label: 'Toggle list', icon: <ChevronRight size={16}/> },
  { type: 'equation', label: 'Block equation', icon: <Code size={16}/> },
  { type: 'code', label: 'Code', icon: <Code size={16}/> },
  { type: 'divider', label: 'Divider', icon: <Minus size={16}/> },
  { type: 'image', label: 'Image', icon: <Image size={16}/> },
  { type: 'video', label: 'Video', icon: <PanelsTopLeft size={16}/> },
  { type: 'audio', label: 'Audio', icon: <PanelsTopLeft size={16}/> },
  { type: 'file', label: 'File', icon: <Upload size={16}/> },
  { type: 'bookmark', label: 'Web bookmark', icon: <Link2 size={16}/> },
  { type: 'simple-table', label: 'Simple table', icon: <Table2 size={16}/> },
  { type: 'columns', label: '2 columns', icon: <PanelsTopLeft size={16}/> },
  { type: 'page', label: 'Page', icon: <FileText size={16} /> },
  { type: 'database', label: 'Database', icon: <Table2 size={16} /> },
  { type: 'linked-database', label: 'Linked view of database', icon: <Link2 size={16}/> },
  { type: 'heading1', label: 'Heading 1', icon: <Heading1 size={16} /> },
  { type: 'toc', label: 'Table of contents', icon: <List size={16} /> },
  { type: 'callout', label: 'Callout', icon: <Lightbulb size={16} /> },
  { type: 'heading2', label: 'Heading 2', icon: <Heading2 size={16} /> },
  { type: 'heading3', label: 'Heading 3', icon: <Heading3 size={16} /> },
  { type: 'bullet', label: 'Bulleted list', icon: <List size={16} /> },
  { type: 'todo', label: 'To-do list', icon: <CheckSquare size={16} /> },
];

export function NotionBlockMenu({ onChoose, open, onOpenChange, trigger, theme = 'light', canCreatePage = false, canCreateDatabase = false, canCreateSynced=false, mode = 'insert' }: {
  onChoose: (type: NotionBlockType) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  theme?: 'light' | 'dark';
  canCreatePage?: boolean; canCreateDatabase?: boolean;canCreateSynced?:boolean; mode?: 'insert' | 'transform';
}) {
  const chosen=React.useRef(false);
  return <PopoverPrimitive.Popover open={open} onOpenChange={onOpenChange}>
    <PopoverPrimitive.PopoverTrigger asChild>{trigger}</PopoverPrimitive.PopoverTrigger>

      <PopoverPrimitive.PopoverContent data-ui-pack="notion" className={`notion-block-popover notion-${theme}`} onCloseAutoFocus={event=>{if(chosen.current){event.preventDefault();chosen.current=false;}}} side="bottom" align="start" sideOffset={4}>
        <Command className="notion-command">
          <CommandInput aria-label="Find block type" placeholder={mode === 'insert' ? 'Search for a block…' : 'Turn into…'} className="notion-command-input notion-block-command-input" autoFocus />
          <CommandList className="notion-command-list">
            <CommandEmpty className="notion-command-empty">No block types found</CommandEmpty>
            {blockTypes.filter(item=>item.type!=='synced'||canCreateSynced).filter((item) => item.type !== 'page' || canCreatePage).filter((item) => item.type !== 'database' || canCreateDatabase).map((item) => <CommandItem key={item.type} value={item.label} onSelect={() => { chosen.current=true;onChoose(item.type); onOpenChange(false); }} className="notion-command-item"><span aria-hidden="true">{item.icon}</span>{item.label}</CommandItem>)}
          </CommandList>
        </Command>
      </PopoverPrimitive.PopoverContent>

  </PopoverPrimitive.Popover>;
}

export function NotionBlockActions({ trigger, onMoveUp, onMoveDown, onDelete, onDuplicate, onTurnInto, onIndent, onOutdent, theme = 'light' }: {
  trigger: React.ReactNode; onMoveUp?: () => void; onMoveDown?: () => void; onDelete: () => void; onDuplicate?:()=>void; onTurnInto?:(type:NotionBlockType)=>void; onIndent?:()=>void; onOutdent?:()=>void; theme?: 'light' | 'dark';
}) {
  const [actionsOpen, setActionsOpen] = React.useState(false);
  return <MenuPrimitive.DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}><MenuPrimitive.DropdownMenuTrigger asChild onKeyDown={event=>{if(event.code==='Space'||(['ArrowDown','ArrowUp'].includes(event.key)&&event.currentTarget.closest<HTMLElement>('.notion-sort-list')?.dataset.sorting==='true'))event.preventDefault();}} onPointerDown={(event) => event.preventDefault()} onClick={() => setActionsOpen(true)}>{trigger}</MenuPrimitive.DropdownMenuTrigger><MenuPrimitive.DropdownMenuContent data-ui-pack="notion" className={`notion-menu notion-${theme}`} sideOffset={4} align="start">
    <div className="notion-menu-caption">Block</div>
    {onTurnInto&&<MenuPrimitive.DropdownMenuSub><MenuPrimitive.DropdownMenuSubTrigger>Turn into</MenuPrimitive.DropdownMenuSubTrigger><MenuPrimitive.DropdownMenuSubContent>{blockTypes.filter(item=>!['synced','embed','group','page','database','linked-database','toc','columns','simple-table','image','video','audio','file','bookmark'].includes(item.type)).map(item=><MenuPrimitive.DropdownMenuItem key={item.type} onSelect={()=>onTurnInto(item.type)}>{item.icon}{item.label}</MenuPrimitive.DropdownMenuItem>)}</MenuPrimitive.DropdownMenuSubContent></MenuPrimitive.DropdownMenuSub>}
    {onDuplicate&&<MenuPrimitive.DropdownMenuItem onSelect={onDuplicate}>Duplicate block</MenuPrimitive.DropdownMenuItem>}
    <MenuPrimitive.DropdownMenuItem disabled={!onIndent} onSelect={onIndent}>Indent</MenuPrimitive.DropdownMenuItem>
    <MenuPrimitive.DropdownMenuItem disabled={!onOutdent} onSelect={onOutdent}>Outdent</MenuPrimitive.DropdownMenuItem>
    <MenuPrimitive.DropdownMenuItem className="notion-menu-item" disabled={!onMoveUp} onSelect={onMoveUp}><ArrowUp size={16} />Move up</MenuPrimitive.DropdownMenuItem>
    <MenuPrimitive.DropdownMenuItem className="notion-menu-item" disabled={!onMoveDown} onSelect={onMoveDown}><ArrowDown size={16} />Move down</MenuPrimitive.DropdownMenuItem>
    <MenuPrimitive.DropdownMenuSeparator className="notion-menu-separator" />
    <MenuPrimitive.DropdownMenuItem className="notion-menu-item" onSelect={onDelete}><Trash2 size={16} />Delete block</MenuPrimitive.DropdownMenuItem>
  </MenuPrimitive.DropdownMenuContent></MenuPrimitive.DropdownMenu>;
}
