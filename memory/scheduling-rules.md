# Scheduling Rules

## Context Routing
- broadbandcap.com senders: US rules, calendar zach@broadbandcap.com
- elevatecappartners.com senders: Japan rules, calendar zach@elevatecappartners.com
- Unclear domain: default US rules, zach@elevatecappartners.com

## Timezone Windows
- **US (Broadband):** correspondent 9AM-8PM ET, Zach 7AM-6PM ET. Offer overlap only.
- **Japan (Elevate):** correspondent 7AM-6PM JST, Zach 7AM-10PM ET. Offer overlap only.

## Slot Presentation
- Offer 3-4 times in both timezones
- Default meeting duration: 30 min (infer from context if longer)
- Use `check_availability` for next 3 business days; only offer times free on BOTH calendars

## Recipient Logic
- FROM Zach (CC's james@): counterpart is in TO field, use `send_email` with "Re: [subject]"
- FROM someone else: use `reply_email`
- Always exclude james@ and Zach's addresses from recipient list

## On Confirmation
1. Create Zoom via `create_zoom`
2. Get `join_url` from response
3. Create calendar event with `location`=join_url, `isOnline`=true, add attendee
4. Reply to thread with Zoom link
