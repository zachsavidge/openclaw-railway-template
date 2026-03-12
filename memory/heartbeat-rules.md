# Heartbeat Rules

- Runs every 15 min during active hours (6AM-10PM PT)
- Check `search_emails` with `isRead:false` (top 5)
- Max 3 scheduling requests per heartbeat
- Scheduling requests: follow scheduling-rules. Non-scheduling: leave for Zach.
- Duplicate check: skip if james@ already replied in thread
