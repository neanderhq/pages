import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { tagsChanged, type CollabApi, type LinkedPage } from "./collabApi";
import { addPageTag } from "./pageToolsModel";

const message = (failure: unknown) => failure instanceof Error ? failure.message : "Please try again.";

export function PageBacklinks({ api, pageId, onOpen }: { api: CollabApi; pageId: string; onOpen: (id: string) => void }) {
  const [pages, setPages] = useState<LinkedPage[] | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setPages(null); setError("");
    api.backlinks(pageId).then(result => { if (active) setPages(result.pages); }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [api, pageId, attempt]);
  return <section className="pw-page-tools pw-backlinks" aria-label="Backlinks"><h2>Backlinks</h2>
    {error ? <div role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry backlinks</Button></div>
      : !pages ? <p role="status">Loading backlinks…</p>
      : pages.length ? <ul>{pages.map(page => <li key={page.id}><button type="button" className="wiki-text-link" onClick={() => onOpen(page.id)}>{page.title || "Untitled"}</button></li>)}</ul>
      : <p>No pages you can access link here yet.</p>}
    <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>Refresh backlinks</Button>
  </section>;
}

export function PageTags({ api, pageId, editable }: { api: CollabApi; pageId: string; editable: boolean }) {
  const [tags, setTags] = useState<string[] | null>(null), [draft, setDraft] = useState(""), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setTags(null); setError(""); setDraft(""); setDirty(false); setSaved(false); setBusy(false);
    api.pageTags(pageId).then(result => { if (generation.current === current) setTags(result.tags); }).catch(failure => { if (generation.current === current) setError(message(failure)); });
    return () => { generation.current++; };
  }, [api, pageId, attempt]);
  function add(event: FormEvent) {
    event.preventDefault();
    if (!tags || !editable || busy) return;
    try { setTags(addPageTag(tags, draft)); setDraft(""); setDirty(true); setSaved(false); setError(""); }
    catch (failure) { setError(message(failure)); }
  }
  async function save() {
    if (!tags || !editable || busy) return;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const pending = draft.trim() ? addPageTag(tags, draft) : tags;
      const result = await api.updateTags(pageId, pending);
      if (generation.current !== current) return;
      setTags(result.tags); setDraft(""); setDirty(false); setSaved(true);
      window.dispatchEvent(new Event(tagsChanged));
    } catch (failure) { if (generation.current === current) setError(message(failure)); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <section className="pw-page-tools" aria-label="Page tags"><h3>Tags</h3>
    {error && <p role="alert">{error}</p>}
    {tags === null ? error ? <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry tags</Button> : <p role="status">Loading tags…</p> : <>
      {tags.length ? <ul className="pw-tag-list">{tags.map(tag => <li key={tag}><span>{tag}</span>{editable && <Button type="button" variant="ghost" size="sm" aria-label={`Remove tag ${tag}`} disabled={busy} onClick={() => { setTags(tags.filter(value => value !== tag)); setDirty(true); setSaved(false); }}>{"×"}</Button>}</li>)}</ul> : <p>No tags yet.</p>}
      {editable && <><form className="pw-tag-form" onSubmit={add}><label htmlFor="pw-tag-input">Add a tag</label><Input id="pw-tag-input" value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setSaved(false); }} aria-describedby="pw-tag-limits"/><Button type="submit" variant="outline" size="sm" disabled={busy || !draft.trim()}>Add tag</Button></form><small id="pw-tag-limits">Up to 20 tags, 1–40 characters each. Tags save in lowercase.</small><Button size="sm" disabled={busy || (!dirty && !draft.trim())} onClick={() => void save()}>{busy ? "Saving tags…" : "Save tags"}</Button>{saved && <p role="status">Tags saved.</p>}{dirty && <small>Unsaved tags — choose Save tags before closing.</small>}</>}
    </>}
  </section>;
}
