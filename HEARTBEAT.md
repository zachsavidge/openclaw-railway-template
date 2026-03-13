## EA Heartbeat

If current time is before 6AM PT or after 10PM PT → reply "Outside active hours." and stop.

Otherwise: `search_emails` `isRead:false` top 5. Max 3 scheduling requests per heartbeat. Leave non-scheduling for Zach.

For each scheduling email: use `get_email` to read it, then `search_emails` with `conversationId:{id}` to load the full thread. Determine where the conversation stands and take the next action (propose times, confirm a time, create Zoom + calendar invite). Continue each thread until the meeting is booked. Skip if james@ already sent the last reply.
