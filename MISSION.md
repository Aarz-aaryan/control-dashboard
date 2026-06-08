# Agents Dashboard — Mission

**Live:** http://100.100.35.6:8000/agent-dashboard/
**Repo:** https://github.com/Aarz-aaryan/agent-dashboard

## Mission
Build a premium dark-mode anime-styled multi-agent monitor dashboard for Hermes. Goal: Ghibli-meets-tech-anime aesthetic — warm, cozy, and cool — not cute, not cyber-cold.

## Status
**Phase3 — Polish& Iterate**

## Theme (current)
- Background: Deep dark `#0a0e14`
- Cards: Dark glass `rgba(15,20,30,0.85)` with subtle cyan glow on hover
- Accents: Warm gold (`#c49a6c`), sage teal (`#7eb5a6`), sky blue (`#8bbccc`)
- Text: Cool white (`#e2e8f0`), muted slate (`rgba(148,163,184,0.6)`)
- Fonts: `Cormorant Garamond` (headers — Ghibli serif), `DM Sans` (body), `Share Tech Mono` (timestamps)
- Icons: Warm Ghibli-anime styled SVGs — golden drone, sage wisp, chibi robots, fox, owl

## What Aaryan Likes
- Dark background, warm accents
- Cormorant Garamond for headers
- Floating particles + circuit lines (restore-able)
- Agent logos: warm Ghibli style, NOT dark/cyber
- Live agent status, timestamps, session polling

## What Aaryan Dislikes
- Horizontal scanlines
- Circuit-board overlay lines (disable-able)
- Dark/cyber-anime logos
- Too-cute bright pastels
- "SkyEye" branding
- Emojis in UI

## What's Done
- [x] Dark mode with warm accents
- [x] Ghibli font (Cormorant Garamond) on headers
- [x] Warm SVG logos for all 7 agents
- [x] Agent session polling (30s refresh)
- [x] Card hover glow animations
- [x] Floating particles (currently ON)
- [x] Circuit SVG lines (currently ON)
- [x] Scanlines disabled
- [x] Fast load (~0.0007s)
- [x] 0 JS errors
- [x] GitHub repo + initial commit

## What's Left
- [ ] Generate premium Ghibli tech-anime assets (logos, header art) via agy
- [ ] Performance: optimize if needed
- [ ] New agent additions or role changes
- [ ] Consider JSON/websocket data source instead of file polling

## Files
- `index.html` — Main single-file app (HTML/CSS/JS inline)
- `assets/` — SVG logos per agent (aarz, agy, bymax, copilot, jarvis, nina, neo, logo)
- `bg.png` — Background image
- `index_dark_backup.html` — Backup before overlay removal

## Architecture
- Static HTML served by Python HTTP server on port 8000
- JS polls Hermes session files every 30s
- LocalStorage caching for instant render on reload
- Staggered fetch workers for low load
