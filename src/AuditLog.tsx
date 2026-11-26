import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "./api";
import { collabApi, when, type AuditEvent } from "./collabApi";

const pageSize = 25;

export function AuditLog({ companyId }: { companyId: string }) {
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void collabApi(companyId).auditLog(offset, pageSize).then(result => {
      if (!active) return;
      setEvents(result.events);
      setTotal(result.total);
    }).catch(failure => {
      if (!active) return;
      setError(failure instanceof ApiError ? failure.message : "The audit log couldn’t be loaded.");
      setEvents([]);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, offset]);

  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + events.length, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return <section className="wiki-audit-log" aria-label="Audit log">
    <div className="wiki-section-line"><h2>Recent activity</h2><span>{total} {total === 1 ? "event" : "events"}</span></div>
    {error && <p className="wiki-audit-error" role="alert">{error}</p>}
    {loading ? <div className="wiki-loading" role="status"><LoaderCircle size={20} className="wiki-spinner"/>Loading audit events…</div> : events.length ? <Table className="wiki-audit-table">
      <TableHeader><TableRow><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
      <TableBody>{events.map(event => <TableRow key={event.id}>
        <TableCell className="wiki-audit-actor">{event.actorName}</TableCell>
        <TableCell><code>{event.action}</code></TableCell>
        <TableCell className="wiki-audit-target"><span>{event.targetLabel ?? "Unknown target"}</span><br/><code title="Raw audit target">Raw: {event.target}</code></TableCell>
        <TableCell><time dateTime={event.timestamp}>{when(event.timestamp)}</time></TableCell>
      </TableRow>)}</TableBody>
    </Table> : !error && <div className="wiki-audit-empty">No audit events have been recorded yet.</div>}
    <div className="wiki-audit-pagination" aria-label="Audit log pagination">
      <span>{loading ? "Loading events" : `Showing ${first}–${last} of ${total}`}<span className="wiki-audit-page-count"> · Page {currentPage} of {pageCount}</span></span>
      <div><Button type="button" variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={loading || offset === 0}><ArrowLeft size={14}/>Previous</Button><Button type="button" variant="outline" size="sm" onClick={() => setOffset(offset + pageSize)} disabled={loading || offset + pageSize >= total || offset + pageSize > 100_000}>Next<ArrowRight size={14}/></Button></div>
    </div>
  </section>;
}
