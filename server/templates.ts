import { json } from "./http.ts";
import { sanitizeContent } from "./content.ts";

// Built-in page templates (server-defined, the same for every workspace). Content is BlockNote JSON without block ids;
// creating a page from a template runs it through the normal sanitizer, which assigns fresh ids.
type Block = Record<string, unknown>;
const text = (value: string) => [{ type: "text", text: value, styles: {} }];
const bold = (value: string) => [{ type: "text", text: value, styles: { bold: true } }];
const block = (type: string, value = "", props: Block = {}): Block => ({ type, props, content: text(value), children: [] });
const heading = (value: string, level = 2) => block("heading", value, { level });
const paragraph = (value = "") => ({ type: "paragraph", props: {}, content: value ? text(value) : [], children: [] });
const bullet = (value: string) => block("bulletListItem", value);
const numbered = (value: string) => block("numberedListItem", value);
const check = (value: string) => block("checkListItem", value, { checked: false });
const table = (rows: string[][]): Block => ({
  type: "table", props: {}, children: [],
  content: { type: "tableContent", headerRows: 1, rows: rows.map((row, index) => ({
    cells: row.map(cell => ({ type: "tableCell", props: {}, content: index === 0 ? bold(cell) : cell ? text(cell) : [] })),
  })) },
});

export type Template = { id: string; name: string; description: string; title: string; content: Block[] };

export const templates: Template[] = [
  {
    id: "handbook", name: "Handbook", description: "Team overview, ways of working and key contacts.", title: "Team handbook",
    content: [
      heading("About the team", 1), paragraph("What we do and who we serve."),
      heading("Ways of working"), bullet("How we plan and prioritise"), bullet("Where we communicate"), bullet("Working hours and availability"),
      heading("Key contacts"), table([["Topic", "Contact", "Channel"], ["", "", ""], ["", "", ""]]),
      heading("Onboarding checklist"), check("Read this handbook"), check("Get access to team tools"), check("Meet your onboarding buddy"),
      heading("Useful links"), bullet("Add links to related pages here"),
    ],
  },
  {
    id: "sop", name: "SOP", description: "A standard operating procedure with steps, checks and an owner.", title: "Standard operating procedure",
    content: [
      heading("Purpose", 1), paragraph("Why this procedure exists and what it achieves."),
      heading("Scope"), paragraph("When this procedure applies, and when it does not."),
      heading("Roles"), table([["Role", "Responsibility"], ["Owner", ""], ["Performer", ""]]),
      heading("Procedure"), numbered("First step"), numbered("Second step"), numbered("Third step"),
      heading("Checks before finishing"), check("Result verified"), check("Records updated"),
      heading("Related documents"), bullet("Add links to related pages here"),
    ],
  },
  {
    id: "meeting-notes", name: "Meeting notes", description: "Agenda, notes, decisions and action items.", title: "Meeting notes",
    content: [
      heading("Details", 1), table([["Date", "Attendees", "Facilitator"], ["", "", ""]]),
      heading("Agenda"), numbered("Topic one"), numbered("Topic two"),
      heading("Notes"), bullet(""),
      heading("Decisions"), bullet(""),
      heading("Action items"), check("Action — owner — due date"),
    ],
  },
];

export const templateById = (id: unknown) => typeof id === "string" ? templates.find(template => template.id === id) : undefined;
export const templateContent = (template: Template) => sanitizeContent(template.content);

// GET templates — available to every active member.
export function templatesRoute() {
  return json({ templates: templates.map(({ id, name, description, title, content }) => ({ id, name, description, title, content })) });
}
