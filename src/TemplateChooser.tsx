import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import type { PagesApi, PageTemplate, TreePage } from "./pagesApi";
import type { SpaceRef } from "./PageTree";

export function TemplateChooser({ api, pages, spaces, onCreated, onClose }: { api: PagesApi; pages: TreePage[]; spaces: SpaceRef[]; onCreated: (id: string) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [destination, setDestination] = useState("space:company");
  useEffect(() => {
    let active = true;
    setTemplates(null); setError("");
    api.templates().then(result => { if (active) setTemplates(result.templates); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Could not load templates."); });
    return () => { active = false; };
  }, [api, attempt]);
  async function create(templateId: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await api.create({ templateId, ...(destination.startsWith("page:") ? { parentId: destination.slice(5) } : { spaceId: destination === "space:company" ? null : destination.slice(6) }) });
      onCreated(result.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create this page. Choose a destination you can edit."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent><DialogHeader><DialogTitle>New page from template</DialogTitle><DialogDescription>Choose a starting point and a destination you can edit. The page uses that destination’s permissions.</DialogDescription></DialogHeader>
    <label>Destination<Select value={destination} disabled={busy} onValueChange={setDestination}><SelectTrigger aria-label="Template destination"><SelectValue/></SelectTrigger><SelectContent>
      {spaces.map(space => <SelectItem key={space.id ?? "company"} value={`space:${space.id ?? "company"}`}>{space.name} · top level</SelectItem>)}
      {pages.filter(page => page.role === "editor").map(page => <SelectItem key={page.id} value={`page:${page.id}`}>Under {page.title || "Untitled"}</SelectItem>)}
    </SelectContent></Select></label>
    {error && <p className="wiki-notice" role="alert">{error}</p>}
    {!templates ? error ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry templates</Button> : <p role="status">Loading templates…</p> : <ul className="pw-template-list">{templates.map(template => <li key={template.id}><h3>{template.name}</h3><p>{template.description}</p><Button disabled={busy} onClick={() => void create(template.id)}>Use {template.name}</Button></li>)}</ul>}
    <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
  </DialogContent></Dialog>;
}
