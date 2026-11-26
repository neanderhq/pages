import { createRoot } from "react-dom/client";
import { PageView, type PageEvents } from "../../src/PageView";
import { pagesApi } from "../../src/pagesApi";
import { collabApi } from "../../src/collabApi";
import { NotionThemeProvider } from "../../src/neander-design-pack/notion/0.1.0/ui/theme";
import "../../src/globals.css";
import "../../src/neander-design-pack/notion/0.1.0/pack.css";
import "../../src/wiki.css";
import "../../src/pages.css";

const params = new URLSearchParams(location.search);
const companyId = params.get("company")!, pageId = params.get("page")!, userId = params.get("user")!;
const events: PageEvents = { onOpen() {}, onShare() {}, onUnsaved() {}, onTitle() {}, onFavorite() {}, onCreated() {}, onVisited() {} };
createRoot(document.getElementById("root")!).render(<NotionThemeProvider theme="light"><div className="pw-root notion-pack" data-ui-pack="notion"><div className="pw-main"><PageView api={pagesApi(companyId)} collab={collabApi(companyId)} members={[]} userId={userId} isAdmin={params.get("admin") === "1"} pageId={pageId} events={events} topbar={(crumbs, actions) => <header>{crumbs}{actions}</header>}/></div></div></NotionThemeProvider>);
