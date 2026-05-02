---
name: AGNT Design System
version: 0.1.0
description: >
  A dark-first, agentic workflow interface system for AGNT. The visual language
  combines terminal precision, neon signal colors, compact spatial rhythm, and
  crisp utility-driven layouts. Interfaces should feel fast, intelligent,
  technical, and alive without becoming noisy.

colors:
  red: "#fe4e4e"
  orange: "#ff9500"
  yellow: "#ffd700"
  green: "#19ef83"
  blue: "#12e0ff"
  indigo: "#7d3de5"
  violet: "#d13de5"
  pink: "#e53d8f"

  blackNavy: "#070710"
  ultraDarkNavy: "#0b0b17"
  darkNavy: "#10101f"
  navy: "#131322"
  dullNavy: "#1f1f2f"
  dullerNavy: "#3e405a"
  mediumNavy: "#7f8193"
  lightMediumNavy: "#d1d1db"
  lightNavy: "#d9d9d9"
  brightLightNavy: "#ebebeb"
  ultraLightNavy: "#fafafa"
  dullWhite: "#f7f7f7"
  white: "#f1f0f5"

  primary: "{colors.pink}"
  secondary: "{colors.blue}"
  success: "{colors.green}"
  warning: "{colors.yellow}"
  danger: "{colors.red}"
  info: "{colors.blue}"

  background:
    app: "{colors.blackNavy}"
    surfaceDeep: "{colors.ultraDarkNavy}"
    surface: "{colors.darkNavy}"
    surfaceRaised: "{colors.navy}"
    surfaceMuted: "{colors.dullNavy}"
    popup: "rgba(16, 16, 24, 0.95)"

  foreground:
    primary: "{colors.white}"
    secondary: "{colors.lightMediumNavy}"
    muted: "{colors.mediumNavy}"
    faint: "{colors.dullerNavy}"
    inverse: "{colors.blackNavy}"

  overlay:
    lighter0: "rgba(255, 255, 255, 0.1)"
    lighter1: "rgba(255, 255, 255, 0.2)"
    lighter2: "rgba(255, 255, 255, 0.4)"
    lighter3: "rgba(255, 255, 255, 0.8)"
    darker0: "rgba(0, 0, 0, 0.1)"
    darker1: "rgba(0, 0, 0, 0.2)"
    darker2: "rgba(0, 0, 0, 0.4)"
    darker3: "rgba(0, 0, 0, 0.8)"

typography:
  families:
    primary: "League Spartan, sans-serif"
    mono: "Fira Code, monospace"

  base:
    fontFamily: "{typography.families.primary}"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5

  mono:
    fontFamily: "{typography.families.mono}"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5

  scale:
    xs: "0.75rem"
    sm: "0.875rem"
    md: "1rem"
    lg: "1.125rem"
    xl: "1.25rem"
    xxl: "1.5rem"
    xxxl: "2rem"
    display: "2.5rem"

  weights:
    light: 300
    normal: 400
    medium: 500
    semibold: 600
    bold: 700

  h1:
    fontFamily: "{typography.families.primary}"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25

  h2:
    fontFamily: "{typography.families.primary}"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25

  h3:
    fontFamily: "{typography.families.primary}"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25

  h4:
    fontFamily: "{typography.families.primary}"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5

  h5:
    fontFamily: "{typography.families.primary}"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5

  h6:
    fontFamily: "{typography.families.primary}"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5

spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  xxxl: "64px"

radius:
  xs: "2px"
  sm: "4px"
  md: "8px"
  lg: "16px"
  xl: "24px"
  full: "8px"

shadows:
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)"
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"

motion:
  fast: "150ms ease-in-out"
  medium: "300ms ease-in-out"
  slow: "500ms ease-in-out"

  fadeInUp:
    duration: "250ms"
    easing: "ease-out"
    distance: "6px"

  stagger:
    duration: "200ms"
    easing: "ease-out"
    interval: "40ms"
    maxDelay: "240ms"

  skeleton:
    duration: "1500ms"
    easing: "ease-in-out"
    repeat: "infinite"

breakpoints:
  sm: "576px"
  md: "768px"
  lg: "992px"
  xl: "1200px"
  xxl: "1400px"

zIndex:
  dropdown: 1000
  sticky: 1020
  fixed: 1030
  modalBackdrop: 1040
  modal: 1050
  popover: 1060
  tooltip: 1070

components:
  appShell:
    background: "{colors.background.app}"
    color: "{colors.foreground.primary}"
    height: "100vh"
    overflow: "hidden"

  surface:
    background: "{colors.background.surface}"
    color: "{colors.foreground.primary}"
    borderColor: "{colors.background.surfaceMuted}"
    radius: "{radius.md}"

  raisedSurface:
    background: "{colors.background.surfaceRaised}"
    color: "{colors.foreground.primary}"
    borderColor: "{colors.dullNavy}"
    radius: "{radius.md}"
    shadow: "{shadows.md}"

  popup:
    background: "{colors.background.popup}"
    color: "{colors.foreground.primary}"
    radius: "{radius.md}"
    zIndex: "{zIndex.popover}"

  primaryAction:
    background: "{colors.primary}"
    color: "{colors.white}"
    radius: "{radius.md}"
    transition: "{motion.fast}"

  secondaryAction:
    background: "{colors.secondary}"
    color: "{colors.blackNavy}"
    radius: "{radius.md}"
    transition: "{motion.fast}"

  link:
    color: "{colors.blue}"
    hoverDecoration: "underline"

  code:
    fontFamily: "{typography.families.mono}"
    fontSize: "{typography.scale.sm}"
    radius: "{radius.sm}"
    paddingBlock: "{spacing.xxs}"
    paddingInline: "{spacing.xs}"

  focus:
    outlineColor: "{colors.primary}"

  selection:
    background: "rgba(229, 61, 143, 0.3)"

  scrollbar:
    width: "5px"
    thumb: "{colors.dullNavy}"
    track: "transparent"
    radius: "3px"
---

## Overview

AGNT is a dark-first operating environment for agents, workflows, tools, and high-density technical work. The interface should feel like a command center: compact, responsive, sharp, and deeply functional. It is not a generic SaaS dashboard. It should feel closer to a living terminal cockpit with polished product ergonomics.

The core visual identity is built from near-black navy surfaces, bright synthetic accent colors, compact spacing, angular clarity, and restrained glow. Pink is the primary signal color. Cyan is the secondary signal color. Green, yellow, orange, red, indigo, and violet are reserved for state, semantic feedback, data distinction, and controlled moments of emphasis.

The system should always balance two qualities:

1. **Technical density** — AGNT can show logs, agents, workflow nodes, data tables, tool calls, prompts, traces, and complex controls.
2. **Visual legibility** — even dense screens must remain navigable through hierarchy, spacing, contrast, and clear state colors.

The default mood is precise, dark, synthetic, and alert. Avoid soft corporate blandness. Avoid generic rounded white-card SaaS aesthetics. Avoid washed-out purple gradient AI cliche. AGNT should look purpose-built.

## Colors

The AGNT palette is organized around a dark navy foundation and a neon signal spectrum.

Primary surfaces use the navy ramp:

- `#070710` for the deepest app background.
- `#0b0b17` and `#10101f` for deep structural surfaces.
- `#131322` for standard raised panels.
- `#1f1f2f` for muted panels, dividers, borders, recessed regions, and inactive affordances.
- `#3e405a` and `#7f8193` for secondary text, muted icons, placeholder content, and subdued UI chrome.

Foreground text uses off-white rather than pure white. Prefer `#f1f0f5`, `#f7f7f7`, and `#d1d1db` for comfortable dark-mode reading.

The accent spectrum should be used with discipline:

- **Pink `#e53d8f`** is the primary brand signal. Use it for primary actions, selected states, focus outlines, important highlights, active navigation, and agent identity moments.
- **Cyan `#12e0ff`** is the secondary signal. Use it for links, informational highlights, active connections, tool/network affordances, and secondary actions.
- **Green `#19ef83`** indicates success, live status, completed runs, positive deltas, and healthy systems.
- **Yellow `#ffd700`** indicates attention, pending states, warnings, queued work, or incomplete configuration.
- **Orange `#ff9500`** indicates elevated caution, transitional states, and medium-priority alerts.
- **Red `#fe4e4e`** indicates failure, destructive operations, blocked states, and critical errors.
- **Indigo `#7d3de5`** and **violet `#d13de5`** are supporting spectral accents for categorization, graphs, secondary glow, and creative/agentic motifs.

Do not flood screens with accent color. AGNT accents should behave like signal lights in a cockpit: bright, specific, and meaningful.

## Typography

AGNT uses **League Spartan** as its primary typeface and **Fira Code** for monospaced technical content.

League Spartan gives the product a compact, geometric, assertive voice. It should be used for headings, labels, buttons, panels, menus, navigation, chat surfaces, and most interface text.

Fira Code should be used for:

- code snippets
- logs
- terminal output
- tool-call payloads
- JSON
- IDs
- timestamps when technical precision matters
- environment variables
- file paths
- command examples

The default base size is `16px` with a `1.5` line height. Headings are intentionally compact:

- H1: `1.5rem`, bold, `1.25` line height.
- H2: `1.25rem`, bold, `1.25` line height.
- H3: `1.125rem`, semibold, `1.25` line height.
- H4-H6: compact semibold labels with `1.5` line height.

This system favors product density over editorial scale. Large display type can be used for landing pages, empty states, hero moments, and major onboarding screens, but core application surfaces should remain compact and operational.

Use font weight for hierarchy before adding size. Prefer:

- `700` for primary headings.
- `600` for section headings, labels, buttons, and emphasized UI text.
- `400-500` for body and secondary text.
- `300` only for atmospheric or oversized display moments.

## Layout

AGNT layouts are full-viewport, app-like, and overflow-conscious. The base shell occupies `100vw` by `100vh`, with the body locked to a column flex layout and hidden overflow. Internal regions should own their own scrolling.

Use the 2/4/8-based spacing scale:

- `2px` for hairline offsets, tiny optical corrections, and dense separators.
- `4px` for compact inline gaps and micro spacing.
- `8px` for tight component spacing.
- `16px` for standard internal padding and section rhythm.
- `24px` for larger component groups.
- `32px` for major layout gutters.
- `48px` for page-level separation.
- `64px` for large display or landing-page separation.

Interfaces should generally be grid- or flex-driven. Layouts can be dense, but density must be organized. Use clear alignment, consistent gutters, and strong containment.

Use utility-style layout thinking:

- Flex rows and columns for app chrome, panels, toolbars, and inspectors.
- CSS grid for dashboards, cards, workflow canvases, and multi-column configuration pages.
- Internal scroll areas for chat, logs, sidebars, node panels, and trace views.
- Avoid page-level scrolling inside the app shell unless the screen is explicitly document-like.

Responsive breakpoints:

- `576px` small
- `768px` medium
- `992px` large
- `1200px` extra large
- `1400px` extra extra large

On smaller screens, preserve operational clarity by collapsing secondary panels, stacking inspectors, and reducing simultaneous surface count. Do not simply shrink dense desktop layouts until they become illegible.

## Elevation & Depth

AGNT depth should be subtle and dark-mode-native. Avoid heavy floating white-card shadows. Elevation is primarily created through:

- surface color shifts
- thin borders
- inset contrast
- restrained shadows
- translucent overlays
- focus rings
- active neon accents

Use `#10101f`, `#131322`, and `#1f1f2f` to layer surfaces. Popups use `rgba(16, 16, 24, 0.95)` so they feel integrated into the dark environment rather than pasted on top.

The default shadow tokens are soft and conventional; in dark UI, combine them with border and background contrast rather than relying on shadow alone.

Good elevation pattern:

- App background: `#070710`
- Main panel: `#0b0b17` or `#10101f`
- Raised card: `#131322`
- Border/recessed chrome: `#1f1f2f`
- Active edge/focus: `#e53d8f` or `#12e0ff`

## Shapes

AGNT uses modest radius values. The default shape language is crisp and compact, not pillowy.

Radius scale:

- `2px` for tiny chips, code details, hairline UI, and sharp technical elements.
- `4px` for code, scroll thumbs, small controls, and compact tags.
- `8px` as the default practical radius.
- `16px` for larger cards, modals, and feature panels.
- `24px` for expressive containers, hero elements, and marketing-grade surfaces.

The current `full` radius maps to `8px`, so do not assume pill buttons from the `full` token. AGNT's "full" is still controlled and rectangular.

Avoid excessive roundness. The product should feel engineered, not plush.

## Components

### App Shell

The app shell should fill the viewport and prevent accidental body scrolling. Use internal scroll containers for content. The shell should feel continuous and immersive, with a deep navy-black foundation.

### Panels and Cards

Panels should be dark, compact, and bordered by subtle navy contrast. Cards are not generic content blocks; they should clarify structure, state, and affordance.

Use cards for:

- workflow summaries
- agent status
- tool outputs
- settings groups
- saved entities
- dashboard modules
- run history

Cards should usually have:

- dark raised surface
- `8px` or `16px` radius
- compact padding from the spacing scale
- clear heading or label
- muted secondary metadata
- accent only where state or action demands it

### Buttons

Primary buttons use pink. Secondary buttons may use cyan or a dark outlined surface with cyan/pink text. Destructive buttons use red. Success actions may use green, but avoid making green a generic primary action color.

Buttons should have short transitions using `150ms ease-in-out`. Hover states should feel immediate. Avoid slow, floaty, or overly playful interaction timing in core app workflows.

### Links

Links use cyan and underline on hover. Cyan links should remain visually distinct from primary pink actions.

### Code and Technical Blocks

Use Fira Code for code, logs, payloads, file paths, IDs, JSON, and commands. Code blocks should be compact, dark, scrollable, and rounded.

Inline code should use small padding and a `4px` radius. Do not make code blocks visually louder than the content they support unless the code is the primary object of the screen.

### Focus and Selection

Focus outlines use primary pink. Selection background uses translucent pink: `rgba(229, 61, 143, 0.3)`.

Every interactive element must have a visible focus state. Do not remove outlines unless replacing them with an equally visible AGNT-native focus treatment.

### Scrollbars

Scrollbars are thin, with a `5px` track and transparent background. Thumb color should match the relevant border or muted navy token. Scrollbars should be discoverable but quiet.

### Placeholders

Placeholder text uses light navy and should not compete with entered text. Keep placeholders concise and functional.

### Lists and Rich Text

Rich response areas can use slightly more document-like spacing, including section dividers on H2 elements. In dark mode, H2 dividers should use muted navy. Lists should preserve readable indentation and consistent vertical rhythm.

## Motion

AGNT motion is fast, functional, and stateful. It should communicate responsiveness rather than decoration.

Use these core motion patterns:

### Fade In Up

Newly loaded content can appear with a subtle upward fade:

- duration: `250ms`
- easing: `ease-out`
- distance: `6px`

This is appropriate for:

- loaded data
- cards entering a dashboard
- chat/tool results
- settings panels
- small content reveals

### Staggered Lists

Lists and grids can stagger children at `40ms` intervals, capped at `240ms`. This helps dense data feel sequenced without slowing the user down.

### Skeleton Shimmer

Loading placeholders use a horizontal shimmer over dark translucent blocks:

- duration: `1500ms`
- easing: `ease-in-out`
- infinite repeat

Skeletons should approximate final content shape. Do not use skeletons as generic decoration.

### Breathing Error/Attention States

The system includes “breathe” and “error-breathe-inset” patterns. Use these sparingly for live error states, validation attention, or active system feedback. Breathing borders should never distract from text readability or core controls.

Avoid excessive bouncing, elastic motion, whimsical easing, or slow marketing-style animation inside the core product. AGNT should feel alive, but not theatrical during work.

## Accessibility

Maintain strong contrast across all foreground/background combinations. The dark navy palette can collapse if adjacent surfaces are too close; when in doubt, increase contrast through border, text weight, or surface shift.

Use accent colors semantically. Do not rely on color alone for status. Pair status color with text, iconography, labels, or shape.

Required practices:

- Visible focus states on all interactive elements.
- Keyboard-reachable controls.
- Sufficient contrast for text and icons.
- Non-color indicators for destructive, warning, success, and active states.
- Avoid long blocks of low-contrast muted text.
- Keep clickable/tappable targets large enough even in dense UI.
- Respect reduced motion preferences for nonessential animations.

## Voice and Visual Personality

AGNT should feel:

- agentic
- technical
- compact
- luminous
- precise
- fast
- command-center-like
- slightly futuristic
- trustworthy under complexity

AGNT should not feel:

- generic SaaS
- sterile enterprise
- pastel productivity app
- whimsical consumer toy
- washed-out AI gradient template
- over-rounded mobile banking UI
- cluttered hacker terminal parody

The product language is not “cute AI assistant.” It is “serious agentic operating system.”

## Do's and Don'ts

### Do

- Use the navy surface ramp to build depth.
- Use pink for primary action and selected state.
- Use cyan for links, secondary action, and connective/system information.
- Use green/yellow/orange/red for clear semantic states.
- Keep layouts compact but aligned.
- Prefer internal scroll regions over body scrolling.
- Use League Spartan for the product voice.
- Use Fira Code for technical content.
- Use the established 2/4/8 spacing scale.
- Use fast, restrained motion.
- Make focus states obvious.
- Let accent colors act as meaningful signals.
- Preserve high information density while maintaining hierarchy.

### Don't

- Do not create generic white-card SaaS layouts.
- Do not use random purple-blue AI gradients as the main identity.
- Do not overuse glow.
- Do not flood entire screens with pink or cyan.
- Do not use pure black/pure white when existing navy/off-white tokens work better.
- Do not make every surface rounded and soft.
- Do not make core workflow screens feel like landing pages.
- Do not hide scroll behavior.
- Do not remove focus outlines.
- Do not use color as the only status indicator.
- Do not invent unrelated spacing values unless there is a specific optical reason.
- Do not use slow decorative animation in dense operational contexts.

## Implementation Notes for Agents

When generating AGNT UI:

1. Read this file before designing screens or components.
2. Prefer existing CSS custom properties from the AGNT base styles.
3. Use `var(--color-primary)` for primary pink and `var(--color-secondary)` for cyan.
4. Use `var(--spacing-*)` tokens for margin, padding, and gap.
5. Use `var(--border-radius-*)` tokens for shape.
6. Use `var(--font-family-primary)` and `var(--font-family-mono)`.
7. Use `var(--transition-fast)`, `var(--transition-medium)`, and `var(--transition-slow)` for interaction timing.
8. Keep application screens dark-first unless the user explicitly asks for a light surface or document-style output.
9. For new components, define state clearly: default, hover, active, selected, disabled, loading, error, and focus.
10. If a screen becomes visually noisy, reduce accent color before reducing information density.

The goal is not minimalism. The goal is controlled complexity.
