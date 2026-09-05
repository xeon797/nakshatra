# NAKSHATRA — Style Reference & Design System

High-signal autonomous AI broadsheet. A disciplined bilingual newsroom where every column earns its keep, evidence is anchored to the millimeter, and color serves strictly as an operational signal.

## Theme: Light (Newsprint Editorial)

NAKSHATRA translates the rigor and restraint of print broadsheet journalism into an autonomous, real-time AI newsroom. Rejecting SaaS dashboard tropes (no neon gradients, no glow effects, no floating drop shadows), the interface grounds itself in a tactile broadsheet aesthetic: a warm newsprint cream canvas, structural 1px hairline rules, clear hierarchy between Satoshi and Hind Siliguri typography, and a deliberate dual-accent color discipline (Signal Magenta for breaking priority/subscribe, Deep Nocturne Plum for structural chrome and verification badges). Density is high, editorial, and functional.

---

## Tokens — Colors

| Name | Value | Token | Role |
|---|---|---|---|
| Signal Magenta | `#d91b74` | `--color-signal-magenta` | Primary operational accent: breaking flags, newsletter subscribe CTA, live pulse indicator, and footnote citations |
| Nocturne Plum | `#1e0a3c` | `--color-nocturne-plum` | Ink for brand wordmark, editorial eyebrows, primary buttons, and Tier 1 lab verification badges |
| Ink Black | `#120424` | `--color-ink-black` | Primary text, article headlines, column dividers, and hairline rules — the pure broadsheet ink |
| Newsprint Cream | `#fdfcf3` | `--color-newsprint-cream` | Page canvas — the warm off-white broadsheet background that prevents visual fatigue and signals print lineage |
| Broadsheet White | `#ffffff` | `--color-broadsheet-white` | Card surfaces, sticky utility chrome, elevated drawers, and inverted text fills |
| Margin Tint | `#fdfbe4` | `--color-margin-tint` | Secondary warm surface for featured analysis blocks, audio dispatches, and key takeaway boxes |
| Evidence Plum | `#f1ebfc` | `--color-evidence-plum` | Recessed background for verified primary source drawers, evidence pills, and footnote inspection cards |
| Rule Hairline | `#d9d9d9` | `--color-rule-hairline` | Structural 1px vertical and horizontal rules separating columns, stories, and metadata grids |
| Caption Slate | `#6e6e6e` | `--color-caption-slate` | Secondary text, time-ago indicators, reading-time estimates, bylines, and source attributions |
| Mute Slate | `#b3b3b3` | `--color-mute-slate` | Tertiary text, disabled states, unselected filter tabs, and footer legal metadata |
| Signal Violet | `#7b3fe4` | `--color-signal-violet` | Secondary semantic accent for academic/research papers (arXiv) and confidence gauges |

---

## Tokens — Typography

### Satoshi — Brand & Display Sans (`--font-satoshi`)

Primary typeface for the NAKSHATRA wordmark, section headlines, lead decks, breaking flags, and metric counters. Set tight with negative tracking at display scales.

- **Weights:** 500 (Medium), 700 (Bold), 900 (Black)
- **Sizes:** 13, 16, 18, 20, 24, 28, 32, 40
- **Line height:** 1.00 (display), 1.15 (headings), 1.25 (cards)
- **Letter spacing:** -0.025em at 32–40px, -0.015em at 20–28px, 0.075em at 13px uppercase eyebrows

### Hind Siliguri — Bengali Editorial Companion (`--font-bengali`)

Primary typeface for all Bengali headlines, executive decks, and translated article prose. Configured with extended line-height to guarantee complex conjuncts (যুক্তবর্ণ) and vowel signs (হ্রস্ব-ই, হ্রস্ব-উ, ঋ-কার) never clip.

- **Weights:** 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
- **Sizes:** 14, 17, 19, 21, 25, 29, 34, 42
- **Line height:** 1.75 minimum across body and card summaries (`leading-relaxed` / `leading-[1.75]`)
- **Letter spacing:** 0.010em (never apply negative letter-spacing to Bengali text)

### Inter / General Sans — Utility Sans (`--font-sans`)

Utility chrome typeface for timestamps, reading-time metrics, language toggles, table headers, and form inputs.

- **Weights:** 400 (Regular), 600 (SemiBold)
- **Sizes:** 12, 13, 14, 16
- **Line height:** 1.20 to 1.38
- **Letter spacing:** 0.010em

### Type Scale

| Role | EN Size / Leading | BN Size / Leading | Letter Spacing (EN / BN) | Token |
|---|---|---|---|---|
| Eyebrow / Tag | 13px / 1.20 | 13px / 1.40 | 0.075em / 0.020em | `--text-eyebrow` |
| Caption / Meta | 13px / 1.25 | 14px / 1.50 | 0.010em / 0.000em | `--text-caption` |
| Body Prose | 16px / 1.40 | 17px / 1.75 | 0.010em / 0.000em | `--text-body` |
| Subheading / Deck | 18px / 1.30 | 19px / 1.70 | 0.010em / 0.000em | `--text-subheading` |
| Heading Sm | 20px / 1.25 | 21px / 1.60 | -0.015em / 0.000em | `--text-heading-sm` |
| Heading Md | 24px / 1.20 | 25px / 1.50 | -0.020em / 0.000em | `--text-heading-md` |
| Heading Lg | 28px / 1.15 | 29px / 1.45 | -0.020em / 0.000em | `--text-heading-lg` |
| Display / Hero | 40px / 1.05 | 42px / 1.35 | -0.025em / 0.000em | `--text-display` |

---

## Tokens — Spacing & Layout

- **Base Grid Unit:** 4px
- **Page Max-Width:** 1240px centered
- **Section Gap:** 48px to 64px
- **Column Gutter:** 24px (desktop), 16px (tablet/mobile)
- **Dividers:** 1px solid `var(--color-rule-hairline)` between columns and rows
- **Border Radii:**
  - Chrome / Buttons / Nav / Tags: 0px (strict broadsheet discipline)
  - Cards: 0px (standard news cards) or 4px maximum on elevated feature modules
  - Evidence & Verification Drawers: 0px with 1px hairline border

---

## Core Components

### 1. Masthead & Wordmark Header

- **Layout:** Center-aligned brand lockup on `#fdfcf3` canvas.
- **Wordmark:** NAKSHATRA set in Satoshi Black (40px, tracking -0.025em) in `#120424`, accented with a solid `#d91b74` (Signal Magenta) period mark.
- **Flanking Modules:**
  - Left: Live Ingestion Ticker (e.g., "42 STORIES CLUSTERED TODAY • 12 SOURCES ACTIVE") in 12px uppercase monospace slate with a blinking 6px green/magenta live dot.
  - Right: Formatted bilingual issue date (e.g., "SATURDAY, 5 SEPTEMBER 2026 / শনিবার, ২০ ভাদ্র ১৪৩৩") in 12px tracked uppercase slate.
- **Hairlines:** Framed top and bottom by 1px `#d9d9d9` rules.

### 2. Category Navigation & Language Segment

- **Layout:** Sticky row on `#ffffff` with 1px bottom border in `#d9d9d9`.
- **Editorial Categories:** ALL STORIES | MODELS & LLMS | AUTONOMOUS AGENTS | INFRASTRUCTURE | RESEARCH PAPERS | POLICY & REGULATION in Satoshi Medium 13px uppercase, tracking 0.075em, pipe-separated. In Bengali mode, labels switch cleanly to Bengali taxonomy.
- **Language Switcher** (`[ EN | বাংলা ]`): Segmented toggle on right rail.
  - 0px radius, 1px `#d9d9d9` border.
  - Active state: `#1e0a3c` (Nocturne Plum) background with white text.
  - Inactive state: `#ffffff` background with `#120424` text.
- **Subscribe Button:** Fixed right position. Solid `#d91b74` (Signal Magenta) background, `#ffffff` bold text in Satoshi 13px uppercase, 0px border-radius, no shadow.

### 3. Lead Breaking Hero Unit (Column 1 & 2 Span)

- **Canvas:** Sits directly on `#fdfcf3` newsprint cream without container shadow or heavy card wraps.
- **Taxonomy Eyebrow:** Tracked uppercase Satoshi/Bengali tag (e.g., "MODELS & LLMS • 2H AGO") in `#1e0a3c`, preceded by a square `#d91b74` badge (BREAKING / শীর্ষ সংবাদ).
- **Headline:** Satoshi Bold (32px, leading 1.15) or Hind Siliguri Bold (34px, leading 1.45) in `#120424`. Left-aligned broadsheet format.
- **Executive Deck:** 2-sentence analytical summary in 16px `#6e6e6e` (`#120424` in dark accents) with 1.75 line-height in Bengali.
- **Corroboration Badges:** Row of verified source pills (e.g., "✓ OpenAI Official • TechCrunch • Reuters") in `#f1ebfc` with `#1e0a3c` hairline outlines.

### 4. Monocle-Style Live Radar / Audio Dispatch Card (Right Rail)

- **Layout:** 280–300px fixed right column filling the first fold.
- **Header:** Solid `#1e0a3c` strip with "NAKSHATRA DISPATCH" in white Satoshi 13px tracked uppercase.
- **Body:** Sits on `#fdfbe4` (Margin Tint) with a 1px left border in `#d9d9d9`.
- **Contents:**
  - Audio summary / Daily brief trigger with a solid `#120424` "LISTEN TO BRIEF" button containing a `#d91b74` sound wave glyph.
  - Live ingested paper list: 3–4 bulleted raw items from arXiv / Frontier Labs with timestamps and direct claim links.

### 5. Multi-Source Story Card (Secondary Grid)

- **Structure:** Vertical stack bounded by 1px `#d9d9d9` rules.
- **Top:** Category eyebrow + time-ago label + Risk tag ("LOW RISK: OFFICIAL RELEASE" or "HUMAN REVIEW CONFIRMED").
- **Headline:** 20px Satoshi or 21px Hind Siliguri (`#120424`).
- **Footer:** Reading time estimate (৩ মিনিট পাঠ), grounding score (98% VERIFIED), and clickable source count badge.

### 6. Evidence & Citations Sidebar Drawer

- **Role:** Deep verification slide-out or sticky right panel replacing inline hallucination risks.
- **Canvas:** `#ffffff` surface with `#f1ebfc` card insets and a 1px `#1e0a3c` structural frame.
- **Elements:**
  - Exact quoted claim from primary documentation.
  - Authority Tier Tag: "TIER 1: PRIMARY LAB ANNOUNCEMENT" (in Nocturne Plum) vs. "TIER 3: TECH JOURNALISM."
  - Direct external link with cryptographic hash and verification timestamp.

---

## Do's and Don'ts

### Do

- Preserve the broadsheet ink ratio: 90% of the page is black text, cream canvas (`#fdfcf3`), white cards, and grey hairline dividers.
- Strictly budget Signal Magenta (`#d91b74`): use it exclusively for the Subscribe action, the breaking badge, footnote indicators, and the live status pulse. If everything is pink, nothing is breaking.
- Honor Bengali typography constraints: always enforce `leading-[1.75]` on Bengali containers. Never apply negative letter-spacing to Hind Siliguri.
- Use structural hairline rules: separate columns, sidebar widgets, and section breaks with 1px solid `#d9d9d9`, broadsheet style.
- Keep border radii at 0px: buttons, tags, and inputs must use sharp rectangular geometry.

### Don't

- No drop shadows: never use `box-shadow` to elevate cards. Depth is created strictly through surface contrast (`#fdfcf3` vs `#ffffff` vs `#fdfbe4` vs `#f1ebfc`) and 1px borders.
- No pure white body backgrounds: do not change the overall page canvas from `#fdfcf3` to `#ffffff`. The warm cream signals paper lineage.
- No rounded pill buttons: do not use `rounded-full` on the Subscribe CTA or navigation items. Rectangular geometry is non-negotiable.
- No decorative gradients behind text: do not use purple-to-pink gradient fills behind news headlines or article text. Keep typography legible against flat broadsheet surfaces.
- No untracked ASCII slugs: URL slugs must remain clean Latin kebab-case (`/article/gpt-5-release-analysis`) even when headlines display in Bengali.

---

## Implementation Reference (Tailwind CSS v4 & CSS Tokens)

```css
:root {
  /* Colors */
  --color-signal-magenta: #d91b74;
  --color-nocturne-plum: #1e0a3c;
  --color-ink-black: #120424;
  --color-newsprint-cream: #fdfcf3;
  --color-broadsheet-white: #ffffff;
  --color-margin-tint: #fdfbe4;
  --color-evidence-plum: #f1ebfc;
  --color-rule-hairline: #d9d9d9;
  --color-caption-slate: #6e6e6e;
  --color-mute-slate: #b3b3b3;
  --color-signal-violet: #7b3fe4;

  /* Typography Families */
  --font-display: var(--font-satoshi), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-bengali: var(--font-hind-siliguri), "Noto Sans Bengali", sans-serif;
  --font-sans: var(--font-general-sans), Inter, system-ui, sans-serif;

  /* Typography Scale */
  --text-eyebrow: 13px;
  --leading-eyebrow: 1.2;
  --tracking-eyebrow: 0.075em;

  --text-body-en: 16px;
  --leading-body-en: 1.4;
  --text-body-bn: 17px;
  --leading-body-bn: 1.75;

  --text-headline-sm: 20px;
  --leading-headline-sm: 1.25;
  --text-headline-md: 24px;
  --leading-headline-md: 1.2;
  --text-headline-lg: 32px;
  --leading-headline-lg: 1.15;
  --text-display: 40px;
  --leading-display: 1.05;

  /* Layout & Geometry */
  --page-max-width: 1240px;
  --radius-chrome: 0px;
  --radius-card: 0px;
  --border-hairline: 1px solid var(--color-rule-hairline);
}

/* Language Dynamic Rules */
html[lang="bn"],
.lang-bn {
  font-family: var(--font-bengali);
  line-height: 1.75 !important;
}

html[lang="bn"] h1,
html[lang="bn"] h2,
html[lang="bn"] h3,
html[lang="bn"] .font-display {
  font-family: var(--font-bengali);
  letter-spacing: 0em !important;
}

html[lang="en"] .font-display {
  font-family: var(--font-display);
  letter-spacing: -0.02em;
}
```
