#!/usr/bin/env node
// outlook-skill.js — Composio Outlook CLI for OpenClaw agent.
//
// Provides email and calendar access for james@elevatecappartners.com
// via the Composio REST API (connected account with OAuth).
//
// Usage:
//   node outlook-skill.js <command> [json-args]
//
// Commands:
//   list_emails     '{"folder":"inbox","top":10}'
//   get_email       '{"messageId":"AAM..."}'
//   search_emails   '{"query":"from:john subject:meeting"}'
//   send_email      '{"to":"a@b.com","subject":"Hi","body":"Hello"}'
//   reply_email     '{"messageId":"AAM...","body":"Thanks!"}'
//   create_draft    '{"to":"a@b.com","subject":"Hi","body":"Hello"}'
//   send_draft      '{"messageId":"AAM..."}'
//   forward_email   '{"messageId":"AAM...","to":"c@d.com","comment":"FYI"}'
//   delete_email    '{"messageId":"AAM..."}'
//   list_folders    '{}'
//   list_events     '{"top":10}'
//   get_event       '{"eventId":"AAM..."}'
//   create_event    '{"subject":"Meeting","start":"2026-03-10T10:00:00","end":"2026-03-10T11:00:00","attendees":["a@b.com"]}'
//   calendar_view   '{"startDateTime":"2026-03-10T00:00:00Z","endDateTime":"2026-03-11T00:00:00Z"}'
//   get_profile     '{}'
//   check_availability '{"startDateTime":"...","endDateTime":"..."}'  (both calendars, cached)
//   create_zoom     '{"topic":"Sync call","startTime":"2026-03-15T10:00:00Z","duration":30}'

import https from "node:https";
import fs from "node:fs";
import path from "node:path";

// ── Configuration ──────────────────────────────────────────────────────

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
const CONNECTED_ACCOUNT_ID = process.env.COMPOSIO_OUTLOOK_ACCOUNT_ID;
const ZOOM_ACCOUNT_ID = process.env.COMPOSIO_ZOOM_ACCOUNT_ID; // optional
if (!COMPOSIO_API_KEY || !CONNECTED_ACCOUNT_ID) {
  console.log(JSON.stringify({ ok: false, error: "Missing COMPOSIO_API_KEY or COMPOSIO_OUTLOOK_ACCOUNT_ID env vars" }));
  process.exit(1);
}
const MAX_OUTPUT = Number.parseInt(process.env.OUTLOOK_MAX_OUTPUT || "5000", 10);

// ── Active hours gate (8 AM – 9 PM Pacific) ─────────────────────────

const ACTIVE_START_HOUR = 8;  // 8 AM PT
const ACTIVE_END_HOUR = 21;   // 9 PM PT

function isActiveHours() {
  // Get current hour in US Pacific time
  const ptHour = Number.parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }),
    10,
  );
  return ptHour >= ACTIVE_START_HOUR && ptHour < ACTIVE_END_HOUR;
}

// ── Rate-limit, retry & cache helpers ────────────────────────────────

const MIN_REQUEST_INTERVAL_MS = 500;   // 500ms between Composio calls
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;          // 2s → 4s → 8s on 429

let lastRequestTime = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Enforce minimum spacing between requests. */
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

/** File-based cache — persists across CLI invocations within the same heartbeat. */
const CACHE_DIR = process.env.OUTLOOK_CACHE_DIR || "/tmp/outlook-skill-cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

function cacheKey(action, input) {
  // Simple hash to make a safe filename
  const raw = `${action}:${JSON.stringify(input)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return `${action}_${(h >>> 0).toString(36)}`;
}

function cacheGet(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) { fs.unlinkSync(file); return null; }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

function cacheSet(key, data) {
  try {
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {}
}

// Actions that are safe to cache (read-only, idempotent)
const CACHEABLE_ACTIONS = new Set([
  "OUTLOOK_OUTLOOK_GET_SCHEDULE",
  "OUTLOOK_OUTLOOK_LIST_EVENTS",
  "OUTLOOK_OUTLOOK_GET_EVENT",
  "OUTLOOK_OUTLOOK_GET_MESSAGE",
  "OUTLOOK_OUTLOOK_GET_PROFILE",
]);

// ── Composio API helper ────────────────────────────────────────────────

function composioRequestOnce(actionName, input, accountId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      connectedAccountId: accountId || CONNECTED_ACCOUNT_ID,
      input: input || {},
    });

    const options = {
      hostname: "backend.composio.dev",
      port: 443,
      path: `/api/v2/actions/${actionName}/execute`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": COMPOSIO_API_KEY,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          // Surface the HTTP status so retry logic can see 429s
          parsed._httpStatus = res.statusCode;
          resolve(parsed);
        } catch {
          resolve({ error: data, _httpStatus: res.statusCode });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Composio request with throttle, retry on 429, and read-through cache.
 */
async function composioRequest(actionName, input, accountId) {
  // Check file-based cache for read-only actions
  const key = cacheKey(actionName, input);
  if (CACHEABLE_ACTIONS.has(actionName)) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const result = await composioRequestOnce(actionName, input, accountId);
      const status = result._httpStatus;
      delete result._httpStatus;

      if (status === 429) {
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        console.error(`[outlook-skill] 429 rate-limited on ${actionName}, retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`);
        await sleep(backoff);
        lastError = new Error(`Rate limited (429) on ${actionName}`);
        continue;
      }

      // Cache successful read-only results to disk
      if (CACHEABLE_ACTIONS.has(actionName)) {
        cacheSet(key, result);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        console.error(`[outlook-skill] Error on ${actionName}: ${err.message}, retry in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw lastError;
}

function truncate(str) {
  if (typeof str !== "string") str = JSON.stringify(str);
  if (str && str.length > MAX_OUTPUT) {
    return str.substring(0, MAX_OUTPUT) + `\n...[truncated, ${str.length} total chars]`;
  }
  return str;
}

// ── Response trimmers (reduce LLM token consumption) ─────────────────

/** Keep only fields the agent needs from calendar events. */
function trimCalendarEvents(raw) {
  const events = raw?.data?.response_data || raw?.response_data || raw?.data || [];
  if (!Array.isArray(events)) return raw;
  return events.map((e) => ({
    id: e.id,
    subject: e.subject,
    start: e.start?.dateTime || e.start,
    end: e.end?.dateTime || e.end,
    isAllDay: e.isAllDay,
    showAs: e.showAs,
    location: e.location?.displayName || e.location,
  }));
}

/** Keep only fields the agent needs from email search results. */
function trimEmails(raw) {
  const msgs = raw?.data?.response_data || raw?.response_data || raw?.data || [];
  if (!Array.isArray(msgs)) return raw;
  return msgs.map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address || m.from,
    to: (m.toRecipients || []).map((r) => r.emailAddress?.address || r).join(", "),
    cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address || r).join(", "),
    date: m.receivedDateTime || m.sentDateTime,
    isRead: m.isRead,
    preview: (m.bodyPreview || "").substring(0, 200),
    conversationId: m.conversationId,
  }));
}

// ── Command handlers ───────────────────────────────────────────────────

const commands = {
  async list_emails(args) {
    if (!isActiveHours()) return { skipped: true, reason: "Outside active hours (8 AM – 9 PM PT)" };
    const input = {};
    if (args.folder) input.folder_name = args.folder;
    if (args.top) input.top = args.top;
    const result = await composioRequest("OUTLOOK_OUTLOOK_LIST_MESSAGES", input);
    return args.raw ? result : trimEmails(result);
  },

  async get_email(args) {
    if (!args.messageId) throw new Error("Missing required arg: messageId");
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_MESSAGE", {
      message_id: args.messageId,
    });
    return result;
  },

  async search_emails(args) {
    if (!isActiveHours()) return { skipped: true, reason: "Outside active hours (8 AM – 9 PM PT)" };
    if (!args.query) throw new Error("Missing required arg: query");
    const result = await composioRequest("OUTLOOK_OUTLOOK_SEARCH_MESSAGES", {
      query: args.query,
    });
    return args.raw ? result : trimEmails(result);
  },

  async send_email(args) {
    if (!args.to || !args.subject || !args.body)
      throw new Error("Missing required args: to, subject, body");
    const input = {
      to: args.to,
      subject: args.subject,
      body: args.body,
    };
    if (args.cc) input.cc = args.cc;
    if (args.bcc) input.bcc = args.bcc;
    if (args.isHtml) input.is_html = true;
    const result = await composioRequest("OUTLOOK_OUTLOOK_SEND_EMAIL", input);
    return result;
  },

  async reply_email(args) {
    if (!args.messageId || !args.body)
      throw new Error("Missing required args: messageId, body");
    const result = await composioRequest("OUTLOOK_OUTLOOK_REPLY_EMAIL", {
      message_id: args.messageId,
      body: args.body,
    });
    return result;
  },

  async create_draft(args) {
    if (!args.to || !args.subject || !args.body)
      throw new Error("Missing required args: to, subject, body");
    const result = await composioRequest("OUTLOOK_OUTLOOK_CREATE_DRAFT", {
      to: args.to,
      subject: args.subject,
      body: args.body,
    });
    return result;
  },

  async send_draft(args) {
    if (!args.messageId) throw new Error("Missing required arg: messageId");
    const result = await composioRequest("OUTLOOK_OUTLOOK_SEND_EMAIL", {
      message_id: args.messageId,
    });
    return result;
  },

  async forward_email(args) {
    if (!args.messageId || !args.to)
      throw new Error("Missing required args: messageId, to");
    const result = await composioRequest("OUTLOOK_OUTLOOK_MOVE_MESSAGE", {
      message_id: args.messageId,
      destination_id: args.to,
    });
    return result;
  },

  async delete_email(args) {
    if (!args.messageId) throw new Error("Missing required arg: messageId");
    // Move to Deleted Items folder
    const result = await composioRequest("OUTLOOK_OUTLOOK_MOVE_MESSAGE", {
      message_id: args.messageId,
      destination_id: "deleteditems",
    });
    return result;
  },

  async list_folders() {
    const result = await composioRequest("OUTLOOK_OUTLOOK_LIST_MAIL_FOLDERS", {});
    return result;
  },

  async list_events(args) {
    const input = {};
    if (args.top) input.top = args.top;
    if (args.calendarOwner) input.user_id = args.calendarOwner;
    const result = await composioRequest("OUTLOOK_OUTLOOK_LIST_EVENTS", input);
    return result;
  },

  async get_event(args) {
    if (!args.eventId) throw new Error("Missing required arg: eventId");
    const input = { event_id: args.eventId };
    if (args.calendarOwner) input.user_id = args.calendarOwner;
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_EVENT", input);
    return result;
  },

  async create_event(args) {
    if (!args.subject || !args.start || !args.end)
      throw new Error("Missing required args: subject, start, end");
    const input = {
      subject: args.subject,
      start_datetime: args.start,
      end_datetime: args.end,
    };
    if (args.attendees) input.attendees = args.attendees;
    if (args.location) input.location = args.location;
    if (args.body) input.body = args.body;
    if (args.isOnline) input.is_online_meeting = true;
    if (args.calendarOwner) input.user_id = args.calendarOwner;
    const result = await composioRequest("OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT", input);
    return result;
  },

  async calendar_view(args) {
    if (!isActiveHours()) return { skipped: true, reason: "Outside active hours (8 AM – 9 PM PT)" };
    if (!args.startDateTime || !args.endDateTime)
      throw new Error("Missing required args: startDateTime, endDateTime");
    const input = {
      start_date_time: args.startDateTime,
      end_date_time: args.endDateTime,
    };
    if (args.calendarOwner) input.user_id = args.calendarOwner;
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_SCHEDULE", input);
    return args.raw ? result : trimCalendarEvents(result);
  },

  async get_profile() {
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_PROFILE", {});
    return result;
  },

  async check_availability(args) {
    if (!isActiveHours()) return { skipped: true, reason: "Outside active hours (8 AM – 9 PM PT)" };
    if (!args.startDateTime || !args.endDateTime)
      throw new Error("Missing required args: startDateTime, endDateTime");
    const input = {
      start_date_time: args.startDateTime,
      end_date_time: args.endDateTime,
    };
    const [elevate, broadband] = await Promise.all([
      composioRequest("OUTLOOK_OUTLOOK_GET_SCHEDULE", { ...input, user_id: "zach@elevatecappartners.com" }),
      composioRequest("OUTLOOK_OUTLOOK_GET_SCHEDULE", { ...input, user_id: "zach@broadbandcap.com" }),
    ]);
    return {
      elevate: trimCalendarEvents(elevate),
      broadband: trimCalendarEvents(broadband),
    };
  },

  async create_zoom(args) {
    if (!ZOOM_ACCOUNT_ID) {
      throw new Error("Missing COMPOSIO_ZOOM_ACCOUNT_ID env var — Zoom not configured");
    }
    if (!args.topic || !args.startTime) {
      throw new Error("Missing required args: topic, startTime");
    }
    const input = {
      topic: args.topic,
      type: 2, // scheduled meeting
      start_time: args.startTime,
      duration: args.duration || 30,
      timezone: args.timezone || "America/New_York",
      userId: "me",
      settings__join__before__host: true,
      settings__waiting__room: false,
    };
    const result = await composioRequest("ZOOM_CREATE_A_MEETING", input, ZOOM_ACCOUNT_ID);
    return result;
  },
};

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const [command, argsJson] = process.argv.slice(2);

  if (!command || command === "--help") {
    console.log(JSON.stringify({
      ok: true,
      data: {
        commands: Object.keys(commands),
        account: "james@elevatecappartners.com",
      },
    }));
    process.exit(0);
  }

  const handler = commands[command];
  if (!handler) {
    console.log(JSON.stringify({ ok: false, error: `Unknown command: ${command}` }));
    process.exit(1);
  }

  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.log(JSON.stringify({ ok: false, error: "Invalid JSON arguments" }));
      process.exit(1);
    }
  }

  try {
    const result = await handler(args);
    const output = JSON.stringify({ ok: true, data: result });
    console.log(truncate(output));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

main();
