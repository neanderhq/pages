import type { PageHeading } from "./pageToolsModel.ts";

export function PageOutline({ headings, onJump }: { headings: PageHeading[]; onJump: (id: string) => void }) {
  return <nav className="pw-page-tools" aria-label="Table of contents"><h2>On this page</h2>
    {headings.length ? <ul>{headings.map(heading => <li key={heading.id} style={{ paddingInlineStart: `${(heading.level - 1) * 12}px` }}><button type="button" className="wiki-text-link" onClick={() => onJump(heading.id)}>{heading.text}</button></li>)}</ul> : <p>Add headings to build a table of contents.</p>}
  </nav>;
}
