/**
 * Live interaction tests for the muis frontend: real clicks, real keys,
 * real screenshots, driven by Selenium through headless Chromium.
 *
 * Runs against the PRODUCTION BUILD served over plain HTTP
 * (browser/EchoTransport mode — tabs echo instead of real ptys).
 * Real-ptys behavior is covered by the Rust worker roundtrip tests;
 * this suite covers everything a user can click.
 *
 *   1. serve the UI:  python3 -m http.server 4173 --directory src-ui/dist
 *   2. run:           MUIS_URL=http://localhost:4173 npm test --prefix tests/e2e
 *
 * Screenshots land in $SHOTS_DIR (default tests/e2e/shots/).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, Key, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const URL = process.env.MUIS_URL ?? "http://localhost:4173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? path.join(HERE, "artifacts", "shots");
const CHROME_BIN =
  process.env.CHROME_BIN ??
  path.join(
    process.env.HOME ?? "~",
    ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
  );

let driver;
let shotN = 0;

async function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  shotN++;
  const file = path.join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await driver.takeScreenshot().then((png) => fs.writeFileSync(file, png, "base64"));
  return file;
}

async function tabs() {
  return driver.findElements(By.css("#tabbar .tab"));
}

async function activeTabIndex() {
  const els = await tabs();
  for (let i = 0; i < els.length; i++) {
    const cls = await els[i].getAttribute("class");
    if (cls.split(" ").includes("active")) return i;
  }
  return -1;
}

async function activeSessionIndex() {
  const els = await driver.findElements(By.css(".session"));
  for (let i = 0; i < els.length; i++) {
    const cls = await els[i].getAttribute("class");
    if (cls.split(" ").includes("active")) return i;
  }
  return -1;
}

/** Dispatch a chord as a synthetic event (Chrome reserves ctrl+tab etc.). */
async function press(chord) {
  await driver.executeScript((c) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ...c, bubbles: true, cancelable: true }),
    );
  }, chord);
}

async function assertOneVisibleTerminal() {
  const state = await driver.executeScript(() => {
    const boxes = [...document.querySelectorAll(".term-wrap .tabbox")];
    return {
      total: boxes.length,
      active: boxes.filter((box) => box.classList.contains("active")).length,
      visible: boxes.filter((box) => {
        const rect = box.getBoundingClientRect();
        return getComputedStyle(box).display !== "none" && rect.width > 0 && rect.height > 0;
      }).length,
    };
  });
  assert.equal(state.active, 1, `expected exactly one active xterm surface, got ${JSON.stringify(state)}`);
  assert.equal(state.visible, 1, `expected exactly one visible xterm surface, got ${JSON.stringify(state)}`);
}

describe("muis chrome", () => {
  before(async () => {
    const options = new chrome.Options()
      .setChromeBinaryPath(CHROME_BIN)
      .addArguments("--headless=new", "--no-sandbox", "--window-size=1280,800");
    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
    await driver.get(URL);
    await driver.wait(until.elementLocated(By.css(".xterm")), 15000);
    await driver.sleep(1500); // fit polling + first paint
  });

  after(async () => {
    await driver?.quit();
  });

  it("renders the target chrome: titlebar, sidebar, tabbar, statusbar, terminal", async () => {
    assert.equal(await driver.findElement(By.css(".app-title")).getText(), "muis");
    assert.ok(await driver.findElement(By.css("#titleSearch")).isDisplayed());
    assert.ok((await driver.findElements(By.css(".session"))).length >= 1);
    assert.equal((await tabs()).length, 1);
    assert.ok(await driver.findElement(By.css(".statusbar")).isDisplayed());
    assert.ok(await driver.findElement(By.css(".pane-head")).isDisplayed());
    assert.match(await driver.findElement(By.css(".pane-head")).getText(), /ready/);
    // Import/export were removed; only the "+ session" action remains.
    assert.equal((await driver.findElements(By.css(".side-footer .btn"))).length, 1);
    const termText = await driver.findElement(By.css(".xterm")).getText();
    assert.match(termText, /browser preview/);
    await shot("01-chrome");
  });

  it("opens a new tab and marks it active", async () => {
    await driver.findElement(By.css("#tabbar .newtab")).click();
    await driver.wait(async () => (await tabs()).length === 2, 5000);
    assert.equal(await activeTabIndex(), 1);
    await shot("02-two-tabs");
  });

  it("switches tabs on click with a visible indicator", async () => {
    await (await tabs())[0].click();
    await driver.wait(async () => (await activeTabIndex()) === 0, 5000);
    const cls = await (await tabs())[0].getAttribute("class");
    assert.ok(cls.split(" ").includes("active"));
    await shot("03-first-tab-active");
  });

  it("focuses the terminal by shortcut and echoes typed input", async () => {
    await driver
      .actions()
      .keyDown(Key.CONTROL)
      .keyDown(Key.SHIFT)
      .sendKeys(Key.F12)
      .keyUp(Key.SHIFT)
      .keyUp(Key.CONTROL)
      .perform();
    const terminalInput = await driver.switchTo().activeElement();
    assert.ok((await terminalInput.getAttribute("class")).includes("xterm-helper-textarea"));
    await terminalInput.sendKeys("echo hi-e2e");
    await terminalInput.sendKeys(Key.ENTER);
    await driver.wait(
      async () => (await driver.findElement(By.css(".xterm")).getText()).includes("echo hi-e2e"),
      5000,
    );
    await shot("04-typed");
  });

  it("labels the active tab with the last command", async () => {
    // Read in-page: renderTabs replaces the tab nodes, so a held element
    // reference goes stale.
    await driver.wait(
      () =>
        driver.executeScript(() => {
          const tab = document.querySelector("#tabbar .tab.active");
          return !!tab && (tab.textContent || "").includes("echo hi-e2e");
        }),
      3000,
    );
    await shot("04b-tab-label");
  });

  it("focuses titlebar search with ctrl+shift+f and searches", async () => {
    await driver
      .actions()
      .keyDown(Key.CONTROL)
      .keyDown(Key.SHIFT)
      .sendKeys("f")
      .keyUp(Key.SHIFT)
      .keyUp(Key.CONTROL)
      .perform();
    const active = await driver.switchTo().activeElement();
    assert.equal(await active.getAttribute("id"), "titleSearch");
    await active.sendKeys("echo");
    await driver.sleep(400);
    assert.equal(await active.getAttribute("value"), "echo");
    await active.sendKeys(Key.ESCAPE);
    await shot("05-search");
  });

  it("opens settings, hides the sessions panel, restores it", async () => {
    await driver
      .actions()
      .keyDown(Key.CONTROL)
      .sendKeys(",")
      .keyUp(Key.CONTROL)
      .perform();
    const overlay = await driver.findElement(By.css(".settings-overlay"));
    await driver.wait(async () => overlay.isDisplayed(), 5000);
    await shot("06-settings");
    const boxes = await overlay.findElements(By.css('input[type="checkbox"]'));
    assert.equal(boxes.length, 1); // show sessions
    const themes = await overlay.findElements(By.css("select"));
    assert.equal(themes.length, 1);
    assert.equal((await themes[0].findElements(By.css("option"))).length, 6);
    await boxes[0].click(); // uncheck
    await overlay.findElement(By.xpath('.//button[text()="Save"]')).click();
    await driver.wait(async () => !(await driver.findElement(By.css(".sidebar")).isDisplayed()), 5000);
    await shot("07-no-sidebar");
    // restore for the remaining tests
    await driver.actions().keyDown(Key.CONTROL).sendKeys(",").keyUp(Key.CONTROL).perform();
    const overlay2 = await driver.findElement(By.css(".settings-overlay"));
    await driver.wait(async () => overlay2.isDisplayed(), 5000);
    await (await overlay2.findElements(By.css('input[type="checkbox"]')))[0].click();
    await overlay2.findElement(By.xpath('.//button[text()="Save"]')).click();
    await driver.wait(async () => driver.findElement(By.css(".sidebar")).isDisplayed(), 5000);
  });

  it("keeps one terminal visible while switching sessions and tabs", async () => {
    await driver.findElement(By.css(".side-footer .btn.primary")).click();
    await driver.wait(until.alertIsPresent(), 5000);
    const nameDialog = await driver.switchTo().alert();
    await nameDialog.sendKeys("e2e-second");
    await nameDialog.accept();
    await driver.wait(until.alertIsPresent(), 5000);
    const dirDialog = await driver.switchTo().alert();
    await dirDialog.sendKeys("/tmp");
    await dirDialog.accept();
    await driver.wait(async () => (await driver.findElements(By.css(".session"))).length === 2, 5000);

    await assertOneVisibleTerminal();
    await shot("08-second-session");

    // Leave the second workspace, switch both tabs in the first, then
    // return. A previous session's xterm must remain hidden each time.
    await (await driver.findElements(By.css(".session")))[0].click();
    await assertOneVisibleTerminal();
    const firstWorkspaceTabs = await tabs();
    assert.equal(firstWorkspaceTabs.length, 2);
    await firstWorkspaceTabs[0].click();
    await assertOneVisibleTerminal();
    await (await tabs())[1].click();
    await assertOneVisibleTerminal();
    await (await driver.findElements(By.css(".session")))[1].click();
    await assertOneVisibleTerminal();
    await shot("09-session-switches-one-terminal");
  });

  it("cycles tabs with ctrl+tab and ctrl+shift+tab", async () => {
    await (await driver.findElements(By.css(".session")))[0].click();
    await (await tabs())[0].click();
    assert.equal(await activeTabIndex(), 0);
    await press({ key: "Tab", code: "Tab", ctrlKey: true });
    await driver.wait(async () => (await activeTabIndex()) === 1, 3000);
    await press({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true });
    await driver.wait(async () => (await activeTabIndex()) === 0, 3000);
    await shot("11-ctrl-tab");
  });

  it("cycles sessions with ctrl+page down and up", async () => {
    const before = await activeSessionIndex();
    await press({ key: "PageDown", code: "PageDown", ctrlKey: true });
    await driver.wait(async () => (await activeSessionIndex()) !== before, 3000);
    await press({ key: "PageUp", code: "PageUp", ctrlKey: true });
    await driver.wait(async () => (await activeSessionIndex()) === before, 3000);
    await shot("12-ctrl-page-sessions");
  });

  it("closes the second tab", async () => {
    await (await driver.findElements(By.css(".session")))[0].click();
    const closeBtns = await driver.findElements(By.css("#tabbar .tab .x"));
    assert.equal(closeBtns.length, 2);
    await closeBtns[1].click();
    await driver.wait(async () => (await tabs()).length === 1, 5000);
    await shot("10-one-tab");
  });

  it("closes the session when its last tab closes", async () => {
    // Switch to the second session and close its only tab; the session
    // must disappear and the first session take over.
    await (await driver.findElements(By.css(".session")))[1].click();
    await driver.wait(async () => (await tabs()).length === 1, 5000);
    await driver.findElement(By.css("#tabbar .tab .x")).click();
    await driver.wait(
      async () => (await driver.findElements(By.css(".session"))).length === 1,
      5000,
    );
    assert.equal((await tabs()).length, 1);
    await assertOneVisibleTerminal();
    await shot("13-session-closed-with-last-tab");
  });

  it("leaves no sessions after the last session's last tab closes", async () => {
    // Only the first session remains; closing its last tab empties the
    // app instead of quitting or resurrecting a tab.
    await driver.findElement(By.css("#tabbar .tab .x")).click();
    await driver.wait(
      async () => (await driver.findElements(By.css(".session"))).length === 0,
      5000,
    );
    assert.equal((await tabs()).length, 0);
    const visible = await driver.executeScript(() => {
      const boxes = [...document.querySelectorAll(".term-wrap .tabbox")];
      return boxes.filter((box) => {
        const rect = box.getBoundingClientRect();
        return getComputedStyle(box).display !== "none" && rect.width > 0 && rect.height > 0;
      }).length;
    });
    assert.equal(visible, 0);
    await shot("14-no-sessions");

    // The empty state recovers: "+ session" mints a fresh session + tab.
    await driver.findElement(By.css(".side-footer .btn.primary")).click();
    await driver.wait(until.alertIsPresent(), 5000);
    const nameDialog = await driver.switchTo().alert();
    await nameDialog.sendKeys("e2e-fresh");
    await nameDialog.accept();
    await driver.wait(until.alertIsPresent(), 5000);
    const dirDialog = await driver.switchTo().alert();
    await dirDialog.sendKeys("/tmp");
    await dirDialog.accept();
    await driver.wait(
      async () => (await driver.findElements(By.css(".session"))).length === 1,
      5000,
    );
    await driver.wait(async () => (await tabs()).length === 1, 5000);
    await assertOneVisibleTerminal();
    await shot("15-empty-state-recovers");
  });
});
