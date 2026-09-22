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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel("Username", { exact: true }).fill("test-owner");
  await page
    .locator('input[name="password"]')
    .fill("fixture-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Device", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Create pairing code" }).click();
  await expect(page.locator(".pairing code")).toBeVisible();
  const code = await page.locator(".pairing code").textContent();
  async function phone(path, body, token) {
    const r = await fetch(origin + "/api/device" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("Phone fixture request failed: " + r.status);
    return r.json();
  }
  const paired = await phone("/pair", { token: code, name: "Test Xperia" });
  await phone(
    "/heartbeat",
    {
      model: "F8332",
      battery: 72,
      smsReady: true,
      sims: [{ slot: 1, label: "Test SIM", available: true }],
    },
    paired.token,
  );
  await expect(page.getByText("Online", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page
    .getByRole("button", { name: "Messages", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("+12025550111");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Browser integration test");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Browser integration test", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message-meta")).toContainText("queued");
  const claimed = await phone("/commands/claim", {}, paired.token);
  await phone(
    "/commands/" + claimed.command.id + "/result",
    { status: "sent" },
    paired.token,
  );
  await expect(page.locator(".message-meta")).toContainText("sent", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page
    .getByRole("button", { name: "Add to contacts", exact: true })
    .click();
  await expect(page.getByLabel("Phone number")).toHaveValue("+12025550111");
  await page.getByLabel("Name", { exact: true }).fill("SMS Contact");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".thread-person h2")).toHaveText("SMS Contact");
  await phone(
    "/events",
    {
      events: [
        {
          id: "contact-call-fixture",
          type: "call",
          number: "+12025550112",
          sim: 1,
          timestamp: Date.now(),
          direction: "missed",
          duration: 0,
        },
      ],
    },
    paired.token,
  );
  await page
    .getByRole("button", { name: "Calls", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Options for +12025550112", exact: true })
    .click();
  await page.getByRole("button", { name: "Add to contacts", exact: true }).click();
  await expect(page.getByLabel("Phone number")).toHaveValue("+12025550112");
  await page.getByLabel("Name", { exact: true }).fill("Call Contact");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".data-row")).toContainText("Call Contact");
  await page
    .getByRole("button", { name: "Options for Call Contact", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit contact", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Call Contact",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Device", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Remove phone", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove phone", exact: true })
    .click();
  await expect(page.getByText("Not paired", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS authenticated mobile browser: login, pairing, simulated phone heartbeat, queued SMS, confirmed SMS, revocation, logout. No physical device tested.",
  );
} finally {
  await browser.close();
  app.locals.voice.close();
  await new Promise((r) => server.close(r));
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
}
