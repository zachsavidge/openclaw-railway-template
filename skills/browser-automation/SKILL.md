---
name: browser-automation
description: Automate web browsers with Playwright — navigate pages, fill forms, click buttons, take screenshots, and extract data from websites. Ideal for booking workflows, web scraping, and multi-step web interactions.
user-invocable: true
metadata: {"openclaw":{"emoji":"🌐","os":["linux"],"requires":{"bins":["node"]}}}
---

# Browser Automation Skill

You have access to a headless Chromium browser via the `browser-skill.js` CLI tool. Use it to interact with websites, fill forms, make bookings, extract data, and take screenshots.

## How to Use

Run commands via the Exec tool:

```bash
node /app/src/browser-skill.js <command> '<json-args>'
```

Every command returns JSON to stdout:
- Success: `{"ok": true, "data": { ... }}`
- Failure: `{"ok": false, "error": "..."}`

## Available Commands

### Navigate to a URL
```bash
node /app/src/browser-skill.js navigate '{"url":"https://example.com"}'
```
Returns: `{"ok":true,"data":{"url":"...","title":"..."}}`

### Click an element
```bash
node /app/src/browser-skill.js click '{"selector":"#search-btn"}'
```

### Type text into an input (with human-like delay)
```bash
node /app/src/browser-skill.js type '{"selector":"#destination","text":"New York"}'
```

### Fill multiple form fields at once
```bash
node /app/src/browser-skill.js fill_form '{"fields":[{"selector":"#name","value":"John"},{"selector":"#email","value":"john@example.com"}]}'
```

### Wait for an element or a fixed time
```bash
node /app/src/browser-skill.js wait '{"selector":".results-loaded"}'
node /app/src/browser-skill.js wait '{"time":3000}'
```

### Get text content from the page
```bash
node /app/src/browser-skill.js get_text '{"selector":".price-summary"}'
```
Returns: `{"ok":true,"data":{"text":"...","selector":"..."}}`

### Take a screenshot
```bash
node /app/src/browser-skill.js screenshot '{"fullPage":true}'
```
Returns: `{"ok":true,"data":{"path":"/data/workspace/screenshots/shot-....png"}}`
Screenshots are saved to `/data/workspace/screenshots/`.

### Scroll the page
```bash
node /app/src/browser-skill.js scroll '{"direction":"down","amount":500}'
```

### Run JavaScript on the page
```bash
node /app/src/browser-skill.js evaluate '{"js":"document.title"}'
```

### Close the browser session (frees memory)
```bash
node /app/src/browser-skill.js close
```

## Multi-Step Workflow Example

For booking or multi-step tasks, the browser keeps its state between commands:

```bash
# 1. Navigate to the booking site
node /app/src/browser-skill.js navigate '{"url":"https://booking.com"}'

# 2. Fill in the search form
node /app/src/browser-skill.js type '{"selector":"#destination","text":"Paris"}'

# 3. Click search
node /app/src/browser-skill.js click '{"selector":"#search-btn"}'

# 4. Wait for results to load
node /app/src/browser-skill.js wait '{"selector":".results-list"}'

# 5. Take a screenshot of the results
node /app/src/browser-skill.js screenshot '{"fullPage":false}'

# 6. Extract pricing info
node /app/src/browser-skill.js get_text '{"selector":".price-summary"}'

# 7. Close when done
node /app/src/browser-skill.js close
```

## Important Notes

- The browser auto-closes after 5 minutes of inactivity to save memory.
- Always call `close` when you're done with a browsing session.
- The browser has stealth configuration to avoid bot detection on booking sites.
- Use CSS selectors to target elements. Inspect the page with `evaluate` if you need to find selectors.
- Screenshots are saved as PNG files in `/data/workspace/screenshots/`.
