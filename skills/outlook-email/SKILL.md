---
name: outlook-email
description: Email, calendar, and Zoom for james@elevatecappartners.com via Outlook/Exchange.
user-invocable: true
metadata: {"openclaw":{"emoji":"📧","os":["linux"],"requires":{"bins":["node"]}}}
---

# Outlook Skill

CLI: `node /app/src/outlook-skill.js <command> '<json-args>'`
Returns: `{"ok":true,"data":{...}}` or `{"ok":false,"error":"..."}`

## Commands

**Email:** `list_emails {top}` · `get_email {messageId}` · `search_emails {query}` (Graph $search syntax) · `send_email {to,subject,body,cc?,bcc?,isHtml?}` · `reply_email {messageId,body}` · `create_draft {to,subject,body}` · `send_draft {messageId}` · `forward_email {messageId,to,comment}` · `delete_email {messageId}` · `list_folders {}`

**Calendar:** `list_events {top?,calendarOwner?}` · `get_event {eventId,calendarOwner?}` · `create_event {subject,start,end,attendees?,body?,location?,isOnline?,calendarOwner?}` · `calendar_view {startDateTime,endDateTime,calendarOwner?}` · `check_availability {startDateTime,endDateTime}` (both calendars, cached 5min) · `get_profile {}` · `get_timezone {}` (returns Zach's Outlook mailbox timezone — use to confirm current timezone before scheduling)

**Zoom:** `create_zoom {topic,startTime,duration?,timezone?}` → returns `join_url`

## Notes

- Mailbox: james@elevatecappartners.com only. Pass `calendarOwner` for Zach's calendars.
- IDs from list/search commands feed into get/reply/forward/delete commands.
