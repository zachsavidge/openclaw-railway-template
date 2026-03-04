#!/usr/bin/env node
// browser-skill.js — Playwright browser automation CLI for OpenClaw agent.
//
// Architecture: client/server in a single file.
//   - Client mode (default): sends commands via HTTP to the server process.
//     Auto-starts the server if none is running.
//   - Server mode (--server): manages the headless Chromium browser, listens
//     for HTTP commands on a random port, auto-closes after idle timeout.
//
// Usage:
//   node browser-skill.js <command> [json-args]
//
// Commands:
//   navigate   '{"url":"https://example.com"}'
//   click      '{"selector":"#btn"}'
//   type       '{"selector":"#input","text":"hello"}'
//   fill_form  '{"fields":[{"selector":"#a","value":"b"}]}'
//   wait       '{"selector":".loaded"}' or '{"time":3000}'
//   get_text   '{"selector":".content"}'
//   screenshot '{"fullPage":true}'
//   scroll     '{"direction":"down","amount":500}'
//   evaluate   '{"js":"document.title"}'
//   close      '{}'

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Configuration ──────────────────────────────────────────────────────

const SESSION_FILE = process.env.BROWSER_SESSION_FILE || "/tmp/browser-skill-session.json";
const SCREENSHOTS_DIR = process.env.BROWSER_SCREENSHOTS_DIR || "/data/workspace/screenshots";
const DEFAULT_TIMEOUT = Number.parseInt(process.env.BROWSER_TIMEOUT || "30000", 10);
const IDLE_TIMEOUT = Number.parseInt(process.env.BROWSER_IDLE_TIMEOUT || "300000", 10); // 5 min
const VIEWPORT = {
  width: Number.parseInt(process.env.BROWSER_VIEWPORT_WIDTH || "1920", 10),
  height: Number.parseInt(process.env.BROWSER_VIEWPORT_HEIGHT || "1080", 10),
};
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

// Stealth launch args — reduce automation fingerprints.
const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-background-networking",
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
];

// ════════════════════════════════════════════════════════════════════════
// SERVER MODE — manages the browser and handles commands via HTTP
// ════════════════════════════════════════════════════════════════════════

async function runServer() {
  let browser = null;
  let context = null;
  let page = null;
  let idleTimer = null;
  let httpServer = null;

  // ── Idle timer ────────────────────────────────────────────────────
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      console.error("[browser-skill] Idle timeout reached, shutting down");
      await shutdown();
    }, IDLE_TIMEOUT);
  }

  // ── Graceful shutdown ─────────────────────────────────────────────
  async function shutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    try { if (page) await page.close().catch(() => {}); } catch {}
    try { if (context) await context.close().catch(() => {}); } catch {}
    try { if (browser) await browser.close().catch(() => {}); } catch {}
    try { if (httpServer) httpServer.close(); } catch {}
    try { fs.unlinkSync(SESSION_FILE); } catch {}
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ── Launch browser with stealth ───────────────────────────────────
  browser = await chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });

  context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
    javaScriptEnabled: true,
  });

  // Stealth init script — runs on every new page / navigation.
  await context.addInitScript(() => {
    // Hide navigator.webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // Consistent platform
    Object.defineProperty(navigator, "platform", { get: () => "Linux x86_64" });

    // Stub window.chrome.runtime (present in real Chrome)
    if (window.chrome) {
      window.chrome.runtime = window.chrome.runtime || {};
    } else {
      Object.defineProperty(window, "chrome", {
        value: { runtime: {} },
        writable: false,
      });
    }

    // Override permissions query for notifications
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }

    // Override plugins / mimeTypes to look populated
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  page = await context.newPage();
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);

  // ── Command handlers ──────────────────────────────────────────────

  async function cmdNavigate(args) {
    if (!args.url) throw new Error("Missing required arg: url");
    const response = await page.goto(args.url, {
      waitUntil: args.waitUntil || "domcontentloaded",
      timeout: args.timeout || DEFAULT_TIMEOUT,
    });
    return {
      url: page.url(),
      status: response?.status() ?? null,
      title: await page.title(),
    };
  }

  async function cmdClick(args) {
    if (!args.selector) throw new Error("Missing required arg: selector");
    await page.click(args.selector, {
      timeout: args.timeout || DEFAULT_TIMEOUT,
      button: args.button || "left",
    });
    await page.waitForTimeout(500);
    return { clicked: args.selector, url: page.url() };
  }

  async function cmdType(args) {
    if (!args.selector) throw new Error("Missing required arg: selector");
    if (args.text === undefined) throw new Error("Missing required arg: text");
    if (args.clear !== false) {
      await page.fill(args.selector, "");
    }
    await page.type(args.selector, args.text, {
      delay: args.delay || 50,
      timeout: args.timeout || DEFAULT_TIMEOUT,
    });
    return { typed: args.text.length + " chars", selector: args.selector };
  }

  async function cmdScreenshot(args) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filename = args.filename || `screenshot-${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({
      path: filepath,
      fullPage: args.fullPage ?? false,
      type: "png",
    });
    return {
      path: filepath,
      filename,
      url: page.url(),
      title: await page.title(),
    };
  }

  async function cmdGetText(args) {
    let text;
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) throw new Error(`Element not found: ${args.selector}`);
      text = await el.innerText();
    } else {
      text = await page.innerText("body");
    }
    const maxLen = args.maxLength || 10000;
    if (text.length > maxLen) {
      text = text.substring(0, maxLen) + `\n...[truncated, ${text.length} total chars]`;
    }
    return { text, url: page.url() };
  }

  async function cmdFillForm(args) {
    if (!args.fields || !Array.isArray(args.fields)) {
      throw new Error("Missing required arg: fields (array of {selector, value})");
    }
    const results = [];
    for (const field of args.fields) {
      if (!field.selector || field.value === undefined) {
        results.push({ selector: field.selector, ok: false, error: "missing selector or value" });
        continue;
      }
      try {
        await page.fill(field.selector, String(field.value), {
          timeout: args.timeout || DEFAULT_TIMEOUT,
        });
        results.push({ selector: field.selector, ok: true });
      } catch (err) {
        results.push({ selector: field.selector, ok: false, error: err.message });
      }
    }
    return { filled: results.filter((r) => r.ok).length, total: args.fields.length, results };
  }

  async function cmdWait(args) {
    if (args.selector) {
      await page.waitForSelector(args.selector, {
        state: args.state || "visible",
        timeout: args.timeout || DEFAULT_TIMEOUT,
      });
      return { waited: "selector", selector: args.selector };
    } else if (args.time) {
      await page.waitForTimeout(args.time);
      return { waited: "time", ms: args.time };
    }
    throw new Error("Missing required arg: selector or time");
  }

  async function cmdScroll(args) {
    const direction = args.direction || "down";
    const amount = args.amount || 500;
    const deltaMap = {
      down: { x: 0, y: amount },
      up: { x: 0, y: -amount },
      right: { x: amount, y: 0 },
      left: { x: -amount, y: 0 },
    };
    const delta = deltaMap[direction];
    if (!delta) throw new Error(`Invalid direction: ${direction}. Use: up, down, left, right`);
    await page.mouse.wheel(delta.x, delta.y);
    await page.waitForTimeout(300);
    return { scrolled: direction, amount };
  }

  async function cmdEvaluate(args) {
    if (!args.js) throw new Error("Missing required arg: js");
    const result = await page.evaluate(args.js);
    return { result };
  }

  async function cmdClose() {
    // Schedule shutdown after responding
    setTimeout(() => shutdown(), 100);
    return { closed: true };
  }

  const COMMANDS = {
    navigate: cmdNavigate,
    click: cmdClick,
    type: cmdType,
    screenshot: cmdScreenshot,
    get_text: cmdGetText,
    fill_form: cmdFillForm,
    wait: cmdWait,
    scroll: cmdScroll,
    evaluate: cmdEvaluate,
    close: cmdClose,
  };

  // ── HTTP server ───────────────────────────────────────────────────
  httpServer = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/cmd") {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    resetIdleTimer();

    let body = "";
    for await (const chunk of req) body += chunk;

    let command, args;
    try {
      const parsed = JSON.parse(body);
      command = parsed.command;
      args = parsed.args || {};
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      return;
    }

    const handler = COMMANDS[command];
    if (!handler) {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          ok: false,
          error: `Unknown command: ${command}. Available: ${Object.keys(COMMANDS).join(", ")}`,
        }),
      );
      return;
    }

    try {
      const data = await handler(args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
    }
  });

  // Listen on a random available port.
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = httpServer.address().port;

  // Write session file so the client can find us.
  fs.writeFileSync(
    SESSION_FILE,
    JSON.stringify({ port, pid: process.pid }),
  );

  resetIdleTimer();
  console.error(`[browser-skill] Server running on 127.0.0.1:${port} (PID ${process.pid})`);
}

// ════════════════════════════════════════════════════════════════════════
// CLIENT MODE — sends commands to the server, auto-starts if needed
// ════════════════════════════════════════════════════════════════════════

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isServerAlive(session) {
  if (!session) return false;
  try {
    process.kill(session.pid, 0); // signal 0 = check existence
    return true;
  } catch {
    // Stale session file
    try { fs.unlinkSync(SESSION_FILE); } catch {}
    return false;
  }
}

async function startServer() {
  const thisFile = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [thisFile, "--server"], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env },
  });
  child.unref();

  // Wait for session file to appear (up to 15 seconds for browser launch).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const session = readSession();
    if (session && isServerAlive(session)) return session;
    await new Promise((r) => setTimeout(r, 300));
  }

  // If we get here, check stderr for errors.
  throw new Error("Failed to start browser-skill server within 15 seconds");
}

async function sendCommand(session, command, args) {
  const body = JSON.stringify({ command, args });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: session.port,
        path: "/cmd",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: DEFAULT_TIMEOUT + 5000, // Extra headroom for Playwright's own timeout
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response from server: ${data}`));
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request to browser-skill server timed out"));
    });
    req.write(body);
    req.end();
  });
}

async function runClient() {
  const [, , command, jsonStr] = process.argv;

  if (!command) {
    const msg = [
      "Usage: browser-skill <command> [json-args]",
      "",
      "Commands:",
      "  navigate   '{\"url\":\"https://example.com\"}'",
      "  click      '{\"selector\":\"#btn\"}'",
      "  type       '{\"selector\":\"#input\",\"text\":\"hello\"}'",
      "  fill_form  '{\"fields\":[{\"selector\":\"#a\",\"value\":\"b\"}]}'",
      "  wait       '{\"selector\":\".loaded\"}' or '{\"time\":3000}'",
      "  get_text   '{\"selector\":\".content\"}'",
      "  screenshot '{\"fullPage\":true}'",
      "  scroll     '{\"direction\":\"down\",\"amount\":500}'",
      "  evaluate   '{\"js\":\"document.title\"}'",
      "  close      '{}'",
    ].join("\n");
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    process.exit(1);
  }

  let args = {};
  if (jsonStr) {
    try {
      args = JSON.parse(jsonStr);
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: `Invalid JSON args: ${err.message}` }) + "\n",
      );
      process.exit(1);
    }
  }

  try {
    // Get or start the server.
    let session = readSession();
    if (!isServerAlive(session)) {
      session = await startServer();
    }

    const result = await sendCommand(session, command, args);
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: err.message || String(err) }) + "\n",
    );
    process.exit(1);
  }
}

// ════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════

if (process.argv.includes("--server")) {
  runServer().catch((err) => {
    console.error(`[browser-skill] Server failed: ${err.message}`);
    try { fs.unlinkSync(SESSION_FILE); } catch {}
    process.exit(1);
  });
} else {
  runClient();
}
