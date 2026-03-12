## EA Email Check

On this heartbeat, check for unread scheduling requests and handle them.

### Active hours gate

Before doing anything, check the current time in **US Pacific (PT)**. If it is **before 8:00 AM PT or after 9:00 PM PT**, respond with "Outside active hours (8 AM – 9 PM PT). Skipping." and **do nothing else**.

### Steps

1. Run `search_emails` with query `isRead:false` (limit top 5). Process at most **3 scheduling requests** per heartbeat — leave the rest for the next cycle.
2. For each unread email, determine if it is a **scheduling request** — someone asking for a meeting, call, coffee chat, availability, or trying to coordinate time.
3. **Scheduling requests** → follow the Scheduling Workflow in BOOT.md.
4. **Non-scheduling emails** → leave them alone for Zach.
5. **Duplicate check**: Before replying, verify you have not already replied to the same email thread from james@. If a reply already exists, skip it.
6. After processing, respond with a brief summary of actions taken (e.g., "Replied to 1 scheduling request from john@example.com, 3 unread non-scheduling emails left for Zach."). If no unread emails, respond with "No unread emails."
