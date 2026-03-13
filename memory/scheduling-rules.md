# Scheduling Rules

## Context Routing
- broadbandcap.com senders: US rules, calendar zach@broadbandcap.com
- elevatecappartners.com senders: Japan rules, calendar zach@elevatecappartners.com
- Unclear domain: default US rules, zach@elevatecappartners.com

## Timezone Windows
- **US (Broadband):** correspondent 9AM-8PM ET, Zach 7AM-6PM PT. Offer overlap only.
- **Japan (Elevate):** correspondent 7AM-6PM JST, Zach 7AM-10PM PT. Offer overlap only.
- **Note:** Check Zach's Outlook calendar timezone setting if available — he travels, so PT may not always be current.

## Slot Presentation
- Offer 3-4 times in both timezones
- Default meeting duration: 30 min (infer from context if longer)
- Use `check_availability` for next 3 business days; only offer times free on BOTH calendars

## Recipient Logic
- FROM Zach (CC's james@): counterpart is in TO field, use `send_email` with "Re: [subject]"
- FROM someone else: use `reply_email`
- Always exclude james@ and Zach's addresses from recipient list

## Thread Workflow
For every scheduling email, load the full thread (`search_emails` with `conversationId:{id}`) and determine the current state:

1. **New request** (no prior james@ reply): `check_availability` → propose 3-4 times via `reply_email`
2. **Counterparty replied with preference**: confirm the chosen time via `reply_email`, then proceed to step 4
3. **Counterparty proposed alternate times**: check availability for those times, accept one that works, or counter-propose
4. **Time confirmed**: Create Zoom via `create_zoom` → get `join_url` → create calendar event with `location`=join_url, `isOnline`=true, add attendee → reply to thread with confirmation + Zoom link
5. **Meeting already booked** (calendar invite sent): skip, thread is complete

Always reply within the same thread using `reply_email` with the latest messageId. Never start a new email chain for an ongoing scheduling conversation.
