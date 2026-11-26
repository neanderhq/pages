// Exercise the actual production image with an owned PostgreSQL test database.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, request } from "playwright";
import { Client } from "pg";
import { demo, fixturePages } from "./seed-fixtures.mjs";
const exec = promisify(execFile);
async function json(response, status=200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function main() {
  const image=process.env.NEANDER_TEMPLATE_IMAGE, database=process.env.NEANDER_TEMPLATE_TEST_DATABASE_URL;
  const password=process.env.DEMO_PASSWORD, secret=process.env.BETTER_AUTH_SECRET;
  assert.ok(image && database && password && secret, "Supply the built image, disposable database and generated test credentials");
  assert.equal(process.env.DATABASE_URL,database);
  assert.ok(["127.0.0.1","localhost"].includes(new URL(database).hostname), "Use an explicitly disposable loopback database");
  const configured=new URL(process.env.NEANDER_TEMPLATE_TEST_ORIGIN || process.env.APP_URL || "http://127.0.0.1:8080");
  assert.ok(["127.0.0.1","localhost"].includes(configured.hostname));
  // The private publisher starts with a clean runner, not app CI's browser cache.
  console.info("Provisioning pinned Playwright Chromium for template verification.");
  await exec("pnpm",["exec","playwright","install","--with-deps","chromium"],{timeout:300000,maxBuffer:4*1024*1024});
  const directory=await mkdtemp(join(tmpdir(),"pages-image-check-"));
  const name="pages-image-check-"+randomUUID().slice(0,12), contexts=[];
  const db=new Client({connectionString:database});await db.connect();
  let browser,proxy,started=false,upstreamPort;
  async function ready() {
    if(process.platform!=="linux")upstreamPort=Number((await exec("docker",["port",name,"8080/tcp"])).stdout.trim().split(":").at(-1));
    for(let attempt=0;attempt<120;attempt++) {
      try { if((await fetch(`http://127.0.0.1:${upstreamPort}/api/health`)).ok)return; } catch {}
      await delay(500);
    }
    const logs=await exec("docker",["logs","--tail","30",name]);
    throw new Error("Pages image did not become ready: "+logs.stdout+logs.stderr);
  }
  async function seed() {
    await exec("pnpm",["db:seed"],{timeout:120000,maxBuffer:1024*1024});
  }
  try {
    // A real local TLS terminator preserves production HTTPS/cookie behavior.
    // This forwards real requests; no network faults or provider calls are made.
    const key=join(directory,"key.pem"),cert=join(directory,"cert.pem");
    await exec("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=IP:127.0.0.1,DNS:localhost"],{timeout:30000});
    proxy=https.createServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
      const forwarded=http.request({hostname:"127.0.0.1",port:upstreamPort,path:incoming.url,method:incoming.method,headers:incoming.headers},response=>{
        outgoing.writeHead(response.statusCode || 502,response.headers);response.pipe(outgoing);
      });
      forwarded.on("error",()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end("Upstream unavailable");});
      incoming.pipe(forwarded);
    });
    await new Promise((resolve,reject)=>{proxy.once("error",reject);proxy.listen(0,"127.0.0.1",resolve);});
    const origin=`https://127.0.0.1:${proxy.address().port}`;
    const runtimeDatabase=new URL(database);if(process.platform==="darwin")runtimeDatabase.hostname="host.docker.internal";
    const bundle=join(directory,"environment");
    await writeFile(bundle,`DATABASE_URL=${runtimeDatabase.href}\nAPP_URL=${origin}\nBETTER_AUTH_SECRET=${secret}\nDEMO_PASSWORD=${password}\n`,{mode:0o644});
    const networking=process.platform==="linux" ? ["--network","host","--env",`PORT=${Number(configured.port || 8080)}`] : ["--publish","127.0.0.1::8080"];
    await exec("docker",["run","--detach","--name",name,"--mount",`type=bind,src=${bundle},dst=/run/secrets/neander_environment,readonly`,...networking,image],{timeout:60000});started=true;
    upstreamPort=process.platform==="linux" ? Number(configured.port || 8080) : Number((await exec("docker",["port",name,"8080/tcp"])).stdout.trim().split(":").at(-1));
    await ready();
    async function client() {
      const context=await request.newContext({baseURL:origin,ignoreHTTPSErrors:true,extraHTTPHeaders:{origin}});contexts.push(context);return context;
    }
    const hashes=(await db.query("SELECT id,password FROM auth_accounts WHERE user_id=ANY($1::text[]) ORDER BY id",[demo.users.map(person=>person.id)])).rows;
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pages")).rows[0].count,7);
    await seed();assert.deepEqual((await db.query("SELECT id,password FROM auth_accounts WHERE user_id=ANY($1::text[]) ORDER BY id",[demo.users.map(person=>person.id)])).rows,hashes);
    const roles=new Map();
    for(const person of demo.users) {
      const context=await client();await json(await context.post("/api/auth/sign-in/email",{data:{email:person.email,password}}));
      const identity=await json(await context.get("/api/me"));assert.equal(identity.user.id,person.id);assert.equal(identity.companies[0].companyId,demo.companyId);assert.equal(identity.companies[0].role,person.role);roles.set(person.role,context);
    }
    const admin=roles.get("admin"),viewer=roles.get("viewer"),editor=roles.get("editor"),anonymous=await client();
    await json(await anonymous.get("/api/me"),401);
    const base=`/api/companies/${demo.companyId}/pages`,welcome=fixturePages[0],restricted=fixturePages.find(page=>page.restricted);
    assert.equal((await json(await admin.get(base))).pages.length,7);
    assert.equal((await json(await viewer.get(base))).pages.length,6);
    await json(await viewer.get(`${base}/${restricted.id}`),404);
    await json(await editor.get(`${base}/${restricted.id}`));
    await json(await viewer.post(base,{data:{title:"Viewer must not create",spaceId:demo.spaces[0].id}}),404);
    await json(await admin.post(base,{headers:{origin:"https://other.apps.neander.ai"},data:{title:"Cross-origin must not create",spaceId:demo.spaces[0].id}}),403);
    await json(await anonymous.post("/api/auth/request-password-reset",{data:{email:"admin@pages.test"}}),503);
    const outsider=await client();
    await json(await outsider.post("/api/register",{data:{name:"Independent test user",companyName:"Independent test workspace",email:`independent-${randomUUID()}@pages.test`,password}}));
    assert.notEqual((await json(await outsider.get("/api/me"))).companies[0].companyId,demo.companyId);
    await json(await outsider.get(base),404);
    const markdown=await admin.get(`${base}/${welcome.id}/export-markdown`);assert.equal(markdown.status(),200);assert.match(await markdown.text(),/pages:page-title/);
    const snapshot=await json(await admin.post(`${base}/${welcome.id}/public-snapshot`,{data:{}}));assert.equal(new URL(snapshot.url).origin,origin);
    const publicView=await anonymous.get(snapshot.url);assert.equal(publicView.status(),200);assert.match(await publicView.text(),/Welcome to Pages/);
    await json(await admin.delete(`${base}/${welcome.id}/public-snapshot`,{data:{}}));assert.equal((await anonymous.get(snapshot.url)).status(),404);
    browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:1500,height:1000},ignoreHTTPSErrors:true,storageState:await admin.storageState()});
    const page=await context.newPage();page.setDefaultTimeout(20000);
    await page.goto(origin);assert.match(await page.title(),/Pages/);
    await page.getByRole("heading",{name:demo.companyName,exact:true}).waitFor();
    await page.waitForFunction(()=>!document.body.textContent.includes("Loading pages…"));
    await page.getByRole("button",{name:"New page",exact:true}).last().waitFor();
    const capture=process.env.PAGES_CAPTURE_DIRECTORY;
    if(capture){await mkdir(join(capture,"screenshots"),{recursive:true});await page.screenshot({animations:"disabled",path:join(capture,"thumbnail.png")});}
    for(const [record,file] of [[welcome,"document"],[fixturePages[6],"project-tracker"]]) {
      await page.goto(`${origin}/p/${record.id}?company=${demo.companyId}`);
      await page.getByRole("textbox",{name:"Page title",exact:true}).waitFor();
      await page.waitForFunction(()=>document.querySelector('[aria-label="Page content"] .tiptap')?.getAttribute("contenteditable")==="true");
      assert.equal(await page.getByRole("textbox",{name:"Page title",exact:true}).inputValue(),record.title);
      if(file==="project-tracker")await page.locator('[aria-label="Page content"] .tableWrapper table').waitFor();
      if(capture)await page.screenshot({animations:"disabled",path:join(capture,"screenshots",file+".png")});
    }
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Built mobile app must have no page overflow");
    await page.setViewportSize({width:1500,height:1000});await page.goto(`${origin}/settings?company=${demo.companyId}`);
    await page.getByRole("heading",{name:"Members",exact:true}).waitFor();await page.getByText("viewer@pages.test",{exact:true}).waitFor();
    if(capture)await page.screenshot({animations:"disabled",path:join(capture,"screenshots","members.png")});
    await context.close();await browser.close();browser=undefined;
    const stored=(await json(await admin.get(`${base}/${welcome.id}`))).page;
    const changed=[...stored.content,{id:randomUUID(),type:"paragraph",props:{},children:[],content:[{type:"text",text:"Verified persistent template edit",styles:{}}]}];
    await json(await admin.put(`${base}/${welcome.id}/content`,{data:{baseRevision:stored.revision,content:changed}}));
    await seed();await exec("docker",["restart",name],{timeout:60000});await ready();
    assert.match(JSON.stringify((await json(await admin.get(`${base}/${welcome.id}`))).page.content),/Verified persistent template edit/);
    assert.deepEqual((await db.query("SELECT id,password FROM auth_accounts WHERE user_id=ANY($1::text[]) ORDER BY id",[demo.users.map(person=>person.id)])).rows,hashes);
    console.info("PASS: real Pages production image/PostgreSQL/TLS browser, three roles, private-page/workspace/Origin enforcement, optional mail, public snapshot/export, repeatable seed and persistent edit across restart.");
  } finally {
    await browser?.close();for(const context of contexts)await context.dispose();
    if(started)await exec("docker",["rm","--force",name],{timeout:30000}).catch(()=>{});
    if(proxy)await new Promise(resolve=>proxy.close(resolve));await db.end();await rm(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
