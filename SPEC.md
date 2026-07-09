# Tripp.Scenes — Build Spec

## What Is This?

A storyboard editor for AI voice content. Write scripts, assign characters, place emotion tags, generate voice audio. Brutalist terminal aesthetic — black background, JetBrains Mono, lime green accents.

**Primary reference:** `tripp-scenes-mockup.html` — this is the EXACT UI to match. Study it carefully. The CSS, layout, colors, and interactions are all defined there.

## Tech Stack

- **Frontend:** HTML + CSS + vanilla JavaScript (NO frameworks, NO React, NO Vue)
- **Backend:** Node.js + Express (minimal, for file I/O and TTS pipeline later)
- **Desktop wrapper:** NONE (no Electron). Runs as a local web app at `localhost:3000`
- **Storage:** localStorage for stories, filesystem for exports

## Design System

From the mockup (`tripp-scenes-mockup.html`):

```
Colors:
  --bg: #000000
  --bg-block: #000000
  --bg-assigned: #1a1a1a
  --border: #2a2a2a
  --text: #e0e0e0
  --text-dim: #555
  --accent: #39ff14 (lime green)
  --accent-dim: rgba(57,255,20,0.12)
  --green: #39ff14
  --yellow: #b8ff00
  --red: #ff3333

Font: JetBrains Mono (Google Fonts)
Scanline overlay: repeating-linear-gradient (subtle CRT effect)
```

## Layout (65/35 Split)

```
┌─────────────────────────────────────────────────┐
│ TOOLBAR: Title | Model selector | Export | Gen  │
├─────────────────────────────────────────────────┤
│ CHARACTER BAR: [Nova] [Aria] [+] click to assign│
├─────────────────────────────────────────────────┤
│ HINT BAR: "Click a character, then click a block│
├──────────────────────────┬──────────────────────┤
│                          │                      │
│   EDITOR (65%)           │   RIGHT PANEL (35%)  │
│                          │                      │
│   Dialogue blocks with   │   Emotion tag grid   │
│   character assignment   │   (10 clickable btns)│
│   and char counts        │                      │
│                          │   Custom tag input   │
│                          │                      │
│                          │   Duration ticker    │
│                          │                      │
├──────────────────────────┴──────────────────────┤
│ BOTTOM BAR: Shortcuts | Cursor position         │
└─────────────────────────────────────────────────┘
```

## Core Features (MVP)

### 1. Editor
- Textarea-based editor with `@Character` syntax for speaker assignment
- `---` for scene breaks
- Line numbers with character count indicators (green/yellow/red)
- Per-block max: 500 characters

### 2. Character Bar
- Click character chip to "pick up" that character
- Click an unassigned block to assign the picked character
- Color-coded dots and borders
- Add/remove characters inline
- Active character highlighted with green glow

### 3. Emotion Tag Grid
- 10 clickable buttons in 2-column grid:
  `[laugh]` `[chuckle]` `[gasp]` `[sigh]` `[clear throat]`
  `[shush]` `[groan]` `[sniff]` `[cough]` `[pause]`
- Click inserts tag at cursor position in editor
- Custom tag input for adding custom tags
- Tags highlighted in preview

### 4. Live Preview Panel
- Parses editor content in real-time
- Shows dialogue blocks with character colors
- Scene breaks as green dividers
- Unassigned blocks shown with red border + low opacity
- Speaker change triggers visual separator

### 5. Duration Ticker
- Live estimate: total chars / 15 = seconds
- Format: M:SS
- Highlight duration milestones (10s, 30s, 1m, 2m, 5m, 10m)

### 6. Edit Mode
- Toggle button in toolbar
- When active: blocks become selectable
- Multi-select with checkboxes
- Drag to reorder (with yellow drop indicator)
- Delete selected with keyboard

### 7. Story Vault
- Hidden drawer (books icon button)
- Save current story to localStorage
- Load saved stories
- Delete stories
- Ctrl+S shortcut to quick-save

### 8. Export
- Export to JSON with full metadata
- Includes: title, model, characters, storyboard segments, char counts

### 9. Keyboard Shortcuts
- `Ctrl+Enter` — new dialogue block
- `Ctrl+S` — save to vault
- `Escape` — close modals
- `Delete` — remove selected blocks (in edit mode)

## What NOT to Build Yet

- TTS generation (wire the button, but no backend yet)
- Tag translation worker
- Chunking + crossfade
- Audio playback
- Agent API
- Version history

## File Structure

```
tripp-scenes/
├── server.js           # Express server (minimal)
├── package.json
├── public/
│   ├── index.html      # Main app (match mockup exactly)
│   ├── style.css       # All styles (extracted from mockup)
│   └── app.js          # All JavaScript logic
└── SPEC.md             # This file
```

## Critical Rule

**Match the mockup exactly.** The `tripp-scenes-mockup.html` file IS the design. Every color, every border, every hover effect, every animation is defined there. Extract the CSS, extract the JS, organize into separate files, but do NOT change the visual design.

The mockup is a single-file HTML app. Your job is to:
1. Split it into `index.html` + `style.css` + `app.js`
2. Add the Node.js server
3. Add localStorage persistence for the Story Vault
4. Keep every visual detail identical

## Success Criteria

- [ ] Opens at localhost:3000
- [ ] Visual match to mockup (side-by-side comparison)
- [ ] All 10 emotion tags work (click inserts at cursor)
- [ ] Character assignment works (click chip → click block)
- [ ] Live preview updates in real-time
- [ ] Edit mode with reorder works
- [ ] Story Vault saves/loads from localStorage
- [ ] Export JSON works
- [ ] All keyboard shortcuts work
- [ ] Mobile responsive (right panel stacks)
