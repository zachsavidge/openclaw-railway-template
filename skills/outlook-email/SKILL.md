---
name: outlook-email
description: Read, send, search, and manage emails and calendar events for james@elevatecappartners.com (Exchange Online / Outlook). Use this skill for any email or calendar task.
user-invocable: true
metadata: {"openclaw":{"emoji":"📧","os":["linux"],"requires":{"bins":["node"]}}}
---

# Outlook Email & Calendar Skill

You have access to the Outlook mailbox for **james@elevatecappartners.com** via the `outlook-skill.js` CLI tool. Use it to read, send, search emails and manage calendar events.

## How to Use

Run commands via the Exec tool:

```bash
node /app/src/outlook-skill.js <command> '<json-args>'
```

Every command returns JSON to stdout:
- Success: `{"ok": true, "data": { ... }}`
- Failure: `{"ok": false, "error": "..."}`

## Email Commands

### List recent emails
```bash
node /app/src/outlook-skill.js list_emails '{"top":10}'
```
Optional args: `folder` (default: inbox), `top` (max results).

### Get a specific email by ID
```bash
node /app/src/outlook-skill.js get_email '{"messageId":"AAMkAG..."}'
```

### Search emails
```bash
node /app/src/outlook-skill.js search_emails '{"query":"from:john subject:meeting"}'
```
Uses Microsoft Graph `$search` syntax.

### Send an email
```bash
node /app/src/outlook-skill.js send_email '{"to":"recipient@example.com","subject":"Hello","body":"Message body"}'
```
Optional args: `cc`, `bcc`, `isHtml` (boolean).

### Reply to an email
```bash
node /app/src/outlook-skill.js reply_email '{"messageId":"AAMkAG...","body":"Thanks for your email!"}'
```

### Create a draft
```bash
node /app/src/outlook-skill.js create_draft '{"to":"recipient@example.com","subject":"Draft","body":"Draft body"}'
```

### Send a draft
```bash
node /app/src/outlook-skill.js send_draft '{"messageId":"AAMkAG..."}'
```

### Forward an email
```bash
node /app/src/outlook-skill.js forward_email '{"messageId":"AAMkAG...","to":"someone@example.com","comment":"FYI"}'
```

### Delete an email
```bash
node /app/src/outlook-skill.js delete_email '{"messageId":"AAMkAG..."}'
```

### List mail folders
```bash
node /app/src/outlook-skill.js list_folders '{}'
```

## Calendar Commands

### List upcoming events
```bash
node /app/src/outlook-skill.js list_events '{"top":10,"calendarOwner":"zach@elevatecappartners.com"}'
```
Optional args: `top`, `calendarOwner` (email of the calendar owner to query as delegate).

### Get a specific event
```bash
node /app/src/outlook-skill.js get_event '{"eventId":"AAMkAG...","calendarOwner":"zach@elevatecappartners.com"}'
```
Optional args: `calendarOwner`.

### Create a calendar event
```bash
node /app/src/outlook-skill.js create_event '{"subject":"Team Standup","start":"2026-03-10T10:00:00","end":"2026-03-10T10:30:00","attendees":["alice@example.com"],"location":"Conference Room A","calendarOwner":"zach@elevatecappartners.com"}'
```
Optional args: `body`, `location`, `attendees` (array), `isOnline` (boolean), `calendarOwner`.

### View calendar for a date range
```bash
node /app/src/outlook-skill.js calendar_view '{"startDateTime":"2026-03-10T00:00:00Z","endDateTime":"2026-03-11T00:00:00Z","calendarOwner":"zach@elevatecappartners.com"}'
```
Optional args: `calendarOwner`.

### Check availability on both calendars (preferred)
```bash
node /app/src/outlook-skill.js check_availability '{"startDateTime":"2026-03-10T00:00:00Z","endDateTime":"2026-03-13T00:00:00Z"}'
```
Fetches both Zach's calendars in one call. Returns `{ elevate: [...], broadband: [...] }` with trimmed event data. Results are cached for 5 min — use this instead of calling `calendar_view` twice.

### Get profile info
```bash
node /app/src/outlook-skill.js get_profile '{}'
```

## Zoom Commands

### Create a Zoom meeting
```bash
node /app/src/outlook-skill.js create_zoom '{"topic":"Sync with John","startTime":"2026-03-15T10:00:00Z","duration":30,"timezone":"America/New_York"}'
```
Required args: `topic`, `startTime` (ISO 8601).
Optional args: `duration` (minutes, default 30), `timezone` (default America/New_York).
Returns: Zoom meeting details including `join_url`. Use the `join_url` as the calendar event `location` and include it in the event `body`.

## Important Notes

- This skill only has access to **james@elevatecappartners.com** — no other mailboxes.
- **Calendar delegation:** All calendar commands accept a `calendarOwner` parameter (email address) to operate on another user's calendar as a delegate. See BOOT.md for default delegation rules.
- **EA heartbeat:** This skill is used on each heartbeat to check for unread scheduling requests and reply autonomously. See BOOT.md for the full EA workflow, timezone rules, and availability logic.
- Email IDs (messageId) are returned by `list_emails` and `search_emails` — use them for `get_email`, `reply_email`, `forward_email`, and `delete_email`.
- Calendar event IDs (eventId) are returned by `list_events` and `calendar_view`.
- The search query uses Microsoft Graph search syntax (e.g., `from:name`, `subject:keyword`, `hasAttachment:true`, `isRead:false`).
- Output is automatically truncated to prevent large responses.
