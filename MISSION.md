# Agents Dashboard — Mission

**Live:** http://100.100.35.6:8000/agent-dashboard/
**Repo:** https://github.com/Aarz-aaryan/agent-dashboard (branch: main)
**Last commit:** `0744001` — Dashboard v2 redesign (2026-06-08)

## Mission
Premium dark-mode Ghibli tech-anime multi-agent monitor dashboard for Hermes.

## Status
**Completed** — Phase 3 done, agy self-tested + committed.

## Theme
- Background: Deep dark `#0a0e14`
- Cards: Dark glass `rgba(14,20,30,0.7)` with warm gold glow on hover
- Accents: Warm gold (`#c49a6c`), sage (`#7eb5a6`), sky (`#8bbccc`), terracotta (`#d97d64`)
- Text: Warm cream (`#f5f0e6`), muted cream
- Fonts: `Cormorant Garamond` (headers — Ghibli serif), `DM Sans` (body), `Share Tech Mono` (timestamps)
- No scanlines, no circuit/network lines, no cyan tech glow

## Layout (Tree Structure)
```
            [AARZ] ← top center
           /      \
    [AGY]           [COPILOT] ← second row
    /    \              /    \
[NEO] [JARVIS]      [BMAX] [NINA] ← bottom row
```
- Subtle SVG vine connecting lines between nodes
- Tree layout redraws on window resize

## Agent Logos (Ghibli Anime Style)
- Aarz: Forest spirit (sage/cream, like Totoro companion)
- agy: Floating bird with halo (gold/sky blue)
- Copilot: Robot companion with star (sage/gold)
- Jarvis: Fox spirit (terracotta/cream)
- Neo: Fire spirit / Calcifer (terracotta/gold)
- Bymax: Round fluffy robot (cream/sky blue)
- Nina: Wise owl with spectacles (sky blue/gold)

## Animations
- Active agents: circular boundary rings spin (8s outer, 4.5s inner reverse)
- Idle agents: static rings, no animation
- Cards hover: warm glow + subtle scale/rotate

## What's Done
- [x] Removed ALL horizontal scanlines
- [x] Removed moving circuit/network background lines
- [x] Ghibli serif font (Cormorant Garamond) on headers
- [x] Warm color palette (no cyan/tech blue)
- [x] Tree layout with SVG vine connections
- [x] Ghibli anime logos for all 7 agents (SVG, warm palette)
- [x] Active/idle animation separation
- [x] Fast load, lightweight single-file HTML
- [x] GitHub committed (0744001)

## What's Left
- [ ] Aaryan visual validation + any iteration requests

## Files
- `index.html` — Main single-file app (1156 lines, inline CSS/JS)
- `assets/*.svg` — Agent logos (aarz, agy, bymax, copilot, jarvis, nina, neo, logo)

## Architecture
- Static HTML served by Python HTTP server on port 8000
- JS polls Hermes session files every 30s
- LocalStorage caching for instant render on reload
- Staggered fetch workers for low load
- Tree layout: flexbox rows + SVG connecting lines