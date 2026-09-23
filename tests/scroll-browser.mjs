import { chromium, expect } from "@playwright/test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

const directory = mkdtempSync(join(tmpdir(), "relay-browser-")),
  store = createStore(directory);
store.createUser("test-owner", "Test Owner", "fixture-password-only");
const root = express(),
  server = root.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const app = createApp(store, { origin });
root.use(app);
app.locals.voice.attach(server);
root.use(express.static(resolve("dist")));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const user=store.get('SELECT id FROM users WHERE username=?','test-owner').id;
  for(let i=0;i<70;i++){
    const number='+1202555'+String(1000+i),c=store.conversation(user,number,1);
    store.run('INSERT INTO messages VALUES(?,?,?,?,?,?)','scroll-sms-'+i,user,c.id,store.seal({text:'Synthetic message '+i,sim:1,direction:'incoming',status:'received'}),Date.now()-i*1000,0);
    store.run('INSERT INTO calls VALUES(?,?,?,?)','scroll-call-'+i,user,store.seal({number,sim:1,direction:'incoming',duration:10}),Date.now()-i*1000);
    store.run('INSERT INTO contacts(id,user_id,number_key,data) VALUES(?,?,?,?)','scroll-contact-'+i,user,store.numberKey(number),store.seal({name:'Fixture '+i,number}));
  }
  const page=await browser.newPage();
  await page.goto(origin);
  await page.getByLabel('Username',{exact:true}).fill('test-owner');
  await page.locator('input[name="password"]').fill('fixture-password-only');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
    await page.setViewportSize(viewport);
    for(const tab of ['Messages','Calls','Contacts']){
      await page.getByRole('button',{name:tab,exact:true}).filter({visible:true}).click();
      const list=page.locator(tab==='Messages'?'.list-scroll':'.list-page > .rows');
      await expect(list.locator(tab==='Messages'?'.conversation':'.data-row')).toHaveCount(70);
      const search=page.getByRole('textbox',{name:'Search '+tab.toLowerCase(),exact:true});
      const before=await search.boundingBox();
      const result=await list.evaluate(el=>{el.scrollTop=el.scrollHeight;return {top:el.scrollTop,height:el.clientHeight,content:el.scrollHeight,bottom:el.getBoundingClientRect().bottom,body:document.documentElement.scrollHeight,viewport:innerHeight};});
      if(result.top<=0||result.content<=result.height)throw Error(tab+' list did not scroll');
      const after=await search.boundingBox();
      if(Math.abs(before.y-after.y)>1)throw Error(tab+' search scrolled');
      if(result.body>result.viewport+1)throw Error(tab+' causes outer page scrolling');
      if(viewport.width<800){const nav=await page.locator('.mobile-nav').boundingBox();if(result.bottom>nav.y+1)throw Error(tab+' list overlaps navigation');}
      await expect(list.locator(tab==='Messages'?'.conversation':'.data-row').last()).toBeInViewport();
    }
  }
  console.log('PASS long Messages, Calls and Contacts lists: fixed controls, reachable final row, no page overflow on mobile and desktop');
} finally {
  await browser.close();
  app.locals.voice.close();
  await new Promise((r) => server.close(r));
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
}
