# Import/export samples

These fictional examples are repository documentation, not seeded workspace data. See [walkthrough](../WALKTHROUGH.md) and [acceptance](../ACCEPTANCE.md).

| File | Intended use |
| --- | --- |
| [Handbook.md](Handbook.md) | Markdown import: onboarding prose, headings, emphasis, lists and a basic table. |
| [SOP.md](SOP.md) | Markdown import: checklist, ordered steps, quote and fenced code. |
| [Meeting-notes.md](Meeting-notes.md) | Markdown import: agenda, decisions, actions and a remote-image placeholder. |
| [Export-reimport.md](Export-reimport.md) | Demonstrates the reserved exported-title marker and reimport behavior. |
| [Topics.csv](Topics.csv) | **Attachment only**: a UTF-8, comma-separated file with a header; not page/table import. |

## Markdown

Use Import Markdown to select a folder of `.md` files for an editable space. Put only intended sample pages in that folder (exclude this README if you do not want a README page). Relative paths supplied by the browser define the hierarchy; otherwise filenames alone do not encode parent relationships. The server accepts only safe relative `.md` paths, 1–100 files, up to 1,000,000 bytes each / 8,000,000 total, and up to 1,000 pages including generated folder pages.

The filename without `.md` is the page title; an ordinary first `#` heading is content, not a title override. `Export-reimport.md` begins exactly with `<!-- pages:page-title -->` followed by the generated title heading; the importer removes only that generated prefix. Do not add another wrapper heading or put this reserved marker into ordinary authored content. Markdown export creates this prefix automatically.

Supported normalized syntax includes headings, paragraphs, simple bold/italic/strike/inline code and links, bullet/numbered/check lists, quotes, fenced code, basic pipe tables and standalone images. It is not a full-fidelity rich-editor interchange: nested/rich structure, colors, merged or sized tables and file-block identity are not preserved reliably. IDs can change. Export is one page, **not a page-tree export or attachment-byte bundle**. Private attachment links still need authorization after import elsewhere.

The image in Meeting-notes is an intentionally unavailable remote placeholder on `example.invalid`. No image or other attachment is packaged here; do not expect it to load, including in public snapshots with restrictive media policy. Replace it with a permitted real image when using the sample. Rendering this sample was not verified. The app's PDF export opens the browser print dialog (**Save as PDF**), not a server-generated PDF file. The user reported a separate manual layout check with a table and uploaded image (chrome hidden, table borders/header OK, image scaled), not an automated pass or a retest of the subsequent A-20 Backlinks fix; see [acceptance](../ACCEPTANCE.md).

Known defect: the sanitizer accepts array-form table cells, but Markdown/public HTML exporters read object-cell `.content`, so array cells can become blank. The simple object-cell normalized roundtrip regression passes in historical evidence; that does not resolve this separate source-level defect. See [acceptance](../ACCEPTANCE.md).

## CSV

Topics.csv contains safe fictional text, consistent three-column rows and a quoted comma example. Upload it as a file attachment; an authorized reader can download it. There is **no CSV parser, CSV-to-table/page importer, or CSV export endpoint**. The `.csv` upload allowlist is not validation of its data structure. Do not select it for Markdown import.

Source: [import/export routes](../../server/pages.ts), [Markdown parser/renderers](../../server/content.ts), [roundtrip regression](../../tests/markdown.test.ts).
