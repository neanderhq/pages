// Fictional, versioned template content. No delivery workspace or account data.
export const demo = {
  companyId: "59ad0000-0000-4000-8000-000000000001",
  companyName: "Northstar Studio",
  users: [
    { id: "59ad1000-0000-4000-8000-000000000001", name: "Alex Morgan", email: "admin@pages.test", role: "admin" },
    { id: "59ad1000-0000-4000-8000-000000000002", name: "Jordan Lee", email: "editor@pages.test", role: "editor" },
    { id: "59ad1000-0000-4000-8000-000000000003", name: "Casey Rivera", email: "viewer@pages.test", role: "viewer" },
  ],
  spaces: [
    { id: "59ad2000-0000-4000-8000-000000000001", name: "Company knowledge" },
    { id: "59ad2000-0000-4000-8000-000000000002", name: "Product team" },
  ],
  groupId: "59ad3000-0000-4000-8000-000000000001",
  threadId: "59ad4000-0000-4000-8000-000000000001",
};
const id = n => `59ad5000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const text = value => [{ type: "text", text: value, styles: {} }];
const block = (id, type, value, props = {}) => ({ id, type, props, content: text(value), children: [] });
const heading = (id, value) => block(id, "heading", value, { level: 2 });
const paragraph = (id, value) => block(id, "paragraph", value);
const bullet = (id, value) => block(id, "bulletListItem", value);
export const fixturePages = [
  { id: id(1), title: "Welcome to Pages", slug: "welcome-to-pages", space: 0, tags: ["onboarding"], content: [
    heading("welcome-title", "A shared home for your team's knowledge"),
    paragraph("welcome-intro", "Welcome to the Northstar Studio example workspace. These people, projects and documents are fictional; make them your own."),
    heading("welcome-start", "Start here"),
    { id: "welcome-link", type: "paragraph", props: {}, children: [], content: [{ type: "link", href: `/p/${id(2)}?company=${demo.companyId}`, content: text("Read the team handbook") }] },
    bullet("welcome-docs", "Write a page, add a table or checklist, and organize related documents into a page tree."),
    bullet("welcome-team", "Explore Admin, Editor and Viewer roles using your generated demo credentials."),
    bullet("welcome-discussion", "Select text to leave an inline comment, mention a teammate, and review changes in history."),
  ] },
  { id: id(2), title: "Team handbook", slug: "team-handbook", space: 0, tags: ["handbook"], content: [
    heading("handbook-title", "How we work together"),
    paragraph("handbook-intro", "We use clear written decisions, small project milestones and respectful review. This handbook is a living document, not a finished policy."),
    heading("handbook-decisions", "Make decisions easy to find"),
    bullet("handbook-context", "Write down the context, the decision and the owner."),
    bullet("handbook-review", "Ask one teammate for a review and capture the next action."),
    paragraph("handbook-footer", "The Working agreements subpage has a practical checklist for the team's weekly routine."),
  ] },
  { id: id(3), title: "Working agreements", slug: "working-agreements", space: 0, parent: id(2), tags: ["culture"], content: [
    heading("agreements-title", "Our weekly rhythm"),
    block("agreements-planning", "checkListItem", "Share a short plan before the weekly team check-in.", { checked: true }),
    block("agreements-review", "checkListItem", "Review open questions and document the next decision.", { checked: false }),
    block("agreements-update", "checkListItem", "Keep a useful page current instead of repeating the same explanation.", { checked: false }),
  ] },
  { id: id(4), title: "Release checklist", slug: "release-checklist", space: 1, tags: ["operations"], content: [
    heading("release-title", "A simple release checklist"),
    block("release-test", "checkListItem", "Run the relevant automated checks.", { checked: true }),
    block("release-review", "checkListItem", "Review the actual change and capture a short release note.", { checked: true }),
    block("release-browser", "checkListItem", "Check the main journey on desktop and a narrow viewport.", { checked: false }),
    block("release-followup", "checkListItem", "Record the outcome and any follow-up work.", { checked: false }),
  ] },
  { id: id(5), title: "Meeting notes", slug: "meeting-notes", space: 1, owner: 1, tags: ["meetings"], content: [
    heading("meeting-title", "Product team check-in"),
    paragraph("meeting-summary", "We reviewed the onboarding draft and agreed to keep the next change small enough to test in one session."),
    heading("meeting-actions", "Decisions and next steps"),
    bullet("meeting-owner", "Jordan will update the release checklist with the latest review notes."),
    bullet("meeting-review", "Alex will review the welcome page and confirm the project owners."),
  ] },
  { id: id(6), title: "Planning notes", slug: "planning-notes", space: 1, restricted: true, tags: ["planning"], content: [
    heading("planning-title", "An example of restricted access"),
    paragraph("planning-intro", "This fictional page is explicitly shared with the example Admin and Editor. The Viewer account cannot open it. Adjust page grants to explore access controls."),
  ] },
  { id: id(7), title: "Project tracker", slug: "project-tracker", space: 1, owner: 1, tags: ["planning"], content: [
    heading("tracker-title", "Small projects, clear owners"),
    paragraph("tracker-intro", "Keep important work visible. Review owners and status in your weekly team planning meeting."),
    { id: "tracker-table", type: "table", props: {}, children: [], content: { type: "tableContent", headerRows: 1, rows: [
      ["Project", "Owner", "Status"], ["Welcome guide", "Alex Morgan", "In review"], ["Release checklist", "Jordan Lee", "In progress"], ["Handbook refresh", "Casey Rivera", "Planned"],
    ].map(row => ({ cells: row.map(value => ({ type: "tableCell", props: {}, content: text(value) })) })) } },
  ] },
];
