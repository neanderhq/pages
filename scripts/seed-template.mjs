import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";
import { sanitizeContent } from "../server/content.ts";
import { blockTexts } from "../server/anchors.ts";
import { demo, fixturePages } from "./seed-fixtures.mjs";

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!process.env.DATABASE_URL || !password || password.length < 12 || password.length > 128) {
    throw new Error("Supply DATABASE_URL and a generated DEMO_PASSWORD of 12–128 characters before explicit initialization.");
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('pages_template_seed')) AS locked");
    if (!lock.rows[0].locked) throw new Error("Another template initialization is running");
    if ((await client.query("SELECT 1 FROM companies LIMIT 1")).rowCount) {
      await client.query("ROLLBACK");
      console.info("Existing workspace preserved; no accounts, passwords, pages or history changed.");
      return;
    }
    await client.query("INSERT INTO companies (company_id,name) VALUES ($1,$2)", [demo.companyId, demo.companyName]);
    for (const person of demo.users) {
      await client.query("INSERT INTO auth_users (id,name,email,email_verified) VALUES ($1,$2,$3,true)", [person.id, person.name, person.email]);
      await client.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), person.id, await hashPassword(password)]);
      await client.query("INSERT INTO memberships (company_id,user_id,role,status) VALUES ($1,$2,$3,'active')", [demo.companyId, person.id, person.role]);
    }
    for (const space of demo.spaces) await client.query("INSERT INTO spaces (id,company_id,name,created_by) VALUES ($1,$2,$3,$4)", [space.id, demo.companyId, space.name, demo.users[0].id]);
    await client.query("INSERT INTO groups (id,company_id,name) VALUES ($1,$2,'Product team')", [demo.groupId, demo.companyId]);
    for (const person of demo.users.slice(0,2)) await client.query("INSERT INTO group_members (company_id,group_id,user_id) VALUES ($1,$2,$3)", [demo.companyId, demo.groupId, person.id]);
    for (const [index, page] of fixturePages.entries()) {
      const content = sanitizeContent(page.content), owner = demo.users[page.owner ?? 0].id;
      await client.query("INSERT INTO pages (id,company_id,space_id,parent_id,owner_id,title,slug,position,inherits,content,revision,search_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)",
        [page.id,demo.companyId,demo.spaces[page.space].id,page.parent ?? null,owner,page.title,page.slug,index,!page.restricted,JSON.stringify(content),blockTexts(content).map(b=>b.text).join("\n")]);
      await client.query("INSERT INTO page_revisions (company_id,page_id,revision,content,author_id) VALUES ($1,$2,1,$3,$4)", [demo.companyId,page.id,JSON.stringify(content),owner]);
      await client.query("INSERT INTO page_activity (id,company_id,page_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,'created','Fictional template document')", [randomUUID(),demo.companyId,page.id,owner]);
      for (const tag of page.tags) await client.query("INSERT INTO page_tags (company_id,page_id,tag) VALUES ($1,$2,$3)", [demo.companyId,page.id,tag]);
      if (page.restricted) for (const person of demo.users.slice(0,2)) await client.query("INSERT INTO page_grants (id,company_id,page_id,principal_type,principal_id,role) VALUES ($1,$2,$3,'user',$4,'editor')", [randomUUID(),demo.companyId,page.id,person.id]);
    }
    const welcome = fixturePages[0].id;
    await client.query("INSERT INTO page_links (company_id,source_id,target_id) VALUES ($1,$2,$3)", [demo.companyId,welcome,fixturePages[1].id]);
    await client.query("INSERT INTO page_favorites (company_id,user_id,page_id) VALUES ($1,$2,$3)", [demo.companyId,demo.users[0].id,welcome]);
    await client.query("INSERT INTO comment_threads (id,company_id,page_id,kind,created_by) VALUES ($1,$2,$3,'page',$4)", [demo.threadId,demo.companyId,welcome,demo.users[1].id]);
    await client.query("INSERT INTO comment_messages (id,company_id,thread_id,author_id,body) VALUES ($1,$2,$3,$4,$5)", [randomUUID(),demo.companyId,demo.threadId,demo.users[1].id,"Welcome! Keep this handbook current and leave a comment when something needs a review."]);
    await client.query("INSERT INTO notifications (id,company_id,recipient_id,kind,page_id,actor_id,thread_id,email_status) VALUES ($1,$2,$3,'comment',$4,$5,$6,'not_applicable')", [randomUUID(),demo.companyId,demo.users[0].id,welcome,demo.users[1].id,demo.threadId]);
    await client.query("INSERT INTO invitations (id,company_id,email,token_hash,role,invited_by,expires_at) VALUES ($1,$2,'teammate@pages.test',$3,'editor',$4,NOW()+INTERVAL '48 hours')", [randomUUID(),demo.companyId,createHash('sha256').update(randomBytes(32)).digest('hex'),demo.users[0].id]);
    await client.query("INSERT INTO audit_events (id,company_id,actor,action,target) VALUES ($1,$2,$3,'company.created',$3)", [randomUUID(),demo.companyId,demo.users[0].id]);
    await client.query("COMMIT");
    console.info("Initialized fictional Pages workspace: 3 roles, 2 spaces, 7 documents, discussion and in-app notification. Use your generated DEMO_PASSWORD.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
await main();
