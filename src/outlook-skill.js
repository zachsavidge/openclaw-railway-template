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

import https from "node:https";

// ── Configuration ──────────────────────────────────────────────────────

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
const CONNECTED_ACCOUNT_ID = process.env.COMPOSIO_OUTLOOK_ACCOUNT_ID;
if (!COMPOSIO_API_KEY || !CONNECTED_ACCOUNT_ID) {
  console.log(JSON.stringify({ ok: false, error: "Missing COMPOSIO_API_KEY or COMPOSIO_OUTLOOK_ACCOUNT_ID env vars" }));
  process.exit(1);
}
const MAX_OUTPUT = Number.parseInt(process.env.OUTLOOK_MAX_OUTPUT || "5000", 10);

// ── Composio API helper ────────────────────────────────────────────────

function composioRequest(actionName, input) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      connectedAccountId: CONNECTED_ACCOUNT_ID,
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
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: data });
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

function truncate(str) {
  if (typeof str !== "string") str = JSON.stringify(str);
  if (str && str.length > MAX_OUTPUT) {
    return str.substring(0, MAX_OUTPUT) + `\n...[truncated, ${str.length} total chars]`;
  }
  return str;
}

// ── Command handlers ───────────────────────────────────────────────────

const commands = {
  async list_emails(args) {
    const input = {};
    if (args.folder) input.folder_name = args.folder;
    if (args.top) input.top = args.top;
    const result = await composioRequest("OUTLOOK_OUTLOOK_LIST_MESSAGES", input);
    return result;
  },

  async get_email(args) {
    if (!args.messageId) throw new Error("Missing required arg: messageId");
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_MESSAGE", {
      message_id: args.messageId,
    });
    return result;
  },

  async search_emails(args) {
    if (!args.query) throw new Error("Missing required arg: query");
    const result = await composioRequest("OUTLOOK_OUTLOOK_SEARCH_MESSAGES", {
      search_query: args.query,
    });
    return result;
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
    if (!args.startDateTime || !args.endDateTime)
      throw new Error("Missing required args: startDateTime, endDateTime");
    const input = {
      start_date_time: args.startDateTime,
      end_date_time: args.endDateTime,
    };
    if (args.calendarOwner) input.user_id = args.calendarOwner;
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_SCHEDULE", input);
    return result;
  },

  async get_profile() {
    const result = await composioRequest("OUTLOOK_OUTLOOK_GET_PROFILE", {});
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
