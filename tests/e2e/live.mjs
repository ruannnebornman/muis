/**
 * Live smoke test for the REAL Tauri/WebKit window, not browser preview.
 * It launches muis with isolated XDG state, activates the window through
 * KDE/KWin, focuses xterm via its keyboard shortcut, types a command via
 * ydotool, waits for the shell to write a marker file, and saves a desktop
 * screenshot for visual inspection.
 *
 *   node tests/e2e/live.mjs
 *   node tests/e2e/live.mjs --type "echo custom-marker" --shot /tmp/muis.png
 *
 * Requirements: running KDE Wayland session, qdbus6, ydotool+ydotoold,
 * spectacle, and a built target/debug/muis + muis-worker pair.
 * Browser DOM assertions are separately covered by muis.test.mjs.
 */
import { spawn } from "node:child_process";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function args() {
  const marker = `MUIS_LIVE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let markerExplicit = false;
  const out = {
    title: "muis",
    command: `echo ${marker}`,
    marker,
    shot: "/tmp/opencode/muis-live-smoke.png",
    binary: path.join(ROOT, "target/debug/muis"),
    timeout: 45000,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--title") out.title = argv[++i];
    else if (argv[i] === "--type") out.command = argv[++i];
    else if (argv[i] === "--marker") {
      out.marker = argv[++i];
      markerExplicit = true;
    }
    else if (argv[i] === "--shot") out.shot = argv[++i];
    else if (argv[i] === "--binary") out.binary = path.resolve(argv[++i]);
    else if (argv[i] === "--timeout") out.timeout = Number(argv[++i]);
  }
  if (!markerExplicit && out.command !== `echo ${marker}`) {
    out.marker = out.command.trim().split(/\s+/).at(-1) ?? marker;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function focusWindow(needle) {
  // Native Wayland windows are invisible to X11/EWMH. Activate via a
  // short-lived KWin script, matching the app's caption.
  const script = `
const list = workspace.windowList();
for (const w of list) {
  const caption = (w.caption || "").toLowerCase();
  if (caption.includes(${JSON.stringify(needle.toLowerCase())})) {
    w.minimized = false;
    if (w.desktops && w.desktops.length && workspace.currentDesktop !== w.desktops[0]) {
      workspace.currentDesktop = w.desktops[0];
    }
    workspace.raiseWindow(w);
    workspace.activateWindow(w);
    workspace.activeWindow = w;
    console.log("muis live test activated: " + caption);
  }
}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muis-focus-"));
  const file = path.join(dir, "focus.js");
  fs.writeFileSync(file, script);
  const call = (...args) => execFile("qdbus6", ["org.kde.KWin", "/Scripting", ...args]);
  try {
    await call("org.kde.kwin.Scripting.loadScript", file, "muis-live-smoke");
    await call("org.kde.kwin.Scripting.start");
    // KWin executes the script asynchronously; allow activation to apply.
    await sleep(500);
  } finally {
    await call("org.kde.kwin.Scripting.unloadScript", "muis-live-smoke").catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function waitForMarker(markerFile, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(markerFile, "utf8").includes(marker)) return true;
    } catch {
      // Not written yet.
    }
    await sleep(250);
  }
  return false;
}

const opts = args();
if (!fs.existsSync(opts.binary)) throw new Error(`muis binary missing: ${opts.binary}`);
const workerPath = path.join(path.dirname(opts.binary), "muis-worker");
if (!fs.existsSync(workerPath)) throw new Error(`worker binary missing: ${workerPath}`);

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "muis-live-e2e-"));
const markerFile = path.join(runDir, "marker");
const xdgConfig = path.join(runDir, "config");
const xdgState = path.join(runDir, "state");
fs.mkdirSync(xdgConfig);
fs.mkdirSync(xdgState);
const logPath = path.join(runDir, "muis.log");
const logFd = fs.openSync(logPath, "w");
const child = spawn(opts.binary, [], {
  cwd: ROOT,
  env: { ...process.env, XDG_CONFIG_HOME: xdgConfig, XDG_STATE_HOME: xdgState },
  stdio: ["ignore", logFd, logFd],
});
fs.closeSync(logFd);

let success = false;
try {
  // Give the window time to start and the shell time to emit its prompt.
  await sleep(5000);
  if (child.exitCode !== null) throw new Error(`muis exited early; see ${logPath}`);
  await focusWindow(opts.title);
  // Activate the native window, then focus xterm without any pointer
  // coordinate; this is independent of which monitor/workspace it uses.
  await sleep(1200);
  fs.mkdirSync(path.dirname(opts.shot), { recursive: true });
  await execFile("ydotool", ["key", "ctrl+shift+F12"]);
  await sleep(250);
  const typed = `${opts.command}; printf %s '${opts.marker}' > '${markerFile}'`;
  await execFile("ydotool", ["type", "--", typed]);
  await execFile("ydotool", ["key", "Return"]);
  console.log(`typed into live terminal: ${typed}`);

  // The shell writing the marker proves keyboard input reached the real
  // PTY and the command ran.
  if (!(await waitForMarker(markerFile, opts.marker, opts.timeout))) {
    throw new Error(`marker "${opts.marker}" never reached the shell; see ${logPath}`);
  }

  await execFile("spectacle", ["-b", "-f", "-n", "-o", opts.shot]);
  console.log(`PASS: live PTY produced ${opts.marker}`);
  console.log(`screenshot: ${opts.shot}`);
  console.log(`isolated test state: ${runDir}`);
  success = true;
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(3000),
    ]);
  }
  if (!success) console.error(`live test state kept for diagnosis: ${runDir}`);
}
