# FlyEye Visual Design System

- Status: documented working direction; implementation deferred
- Scope: authenticated FlyEye PWA and authentication flows
- Companion guidance: [UI/UX Guidelines](07_UI_UX_GUIDELINES.md)

## 1. Purpose and authority

This document owns FlyEye's visual tokens, application-shell patterns, and reusable component presentation. The [UI/UX Guidelines](07_UI_UX_GUIDELINES.md) remain authoritative for workflow behavior, safety-aware interaction, accessibility, offline states, and UX evidence. Feature specifications own approved terms, states, permissions, and aviation rules. [Current State](CURRENT_STATE.md) distinguishes implemented behavior from this target direction.

FlyEye is a responsive PWA for one Philippine flight school per isolated deployment. It is not a shared multi-school application and has no school selector. The design must support the approved Student Pilot, Instructor Pilot, and Organization Admin access model without treating a role label or visible navigation as authorization.

The current checkpoint covers the product application, not a public marketing, pricing, or blog website. Those surfaces require separate product and commercial decisions if later needed.

This checkpoint is a reversible working reference, not a permanent commitment to the overall FlyEye interface. A later bounded redesign may supersede it when the Founder/Product Owner chooses to pursue a more distinctive product experience and the replacement preserves validated workflow, accessibility, safety, and authority requirements.

## 2. Reference boundary

ForeFlight and Navigraph may inform broad aviation-information patterns such as strong hierarchy, scan-friendly density, precise alignment, restrained color, and progressive disclosure. Do not copy their branding, trade dress, text, proprietary screens, navigation taxonomy, or operational claims. FlyEye's workflows, terminology, information hierarchy, and authority cues must come from FlyEye requirements and validated Philippine flight-school evidence.

## 3. Brand personality

FlyEye should feel **professional, calm, and trustworthy**.

- **Professional** means predictable hierarchy, exact labels, consistent components, and no novelty interaction that competes with the work.
- **Calm** means light surfaces, restrained teal accents, stable layouts, and urgency reserved for genuinely exceptional states.
- **Trustworthy** means honest status, visible source and time context, clear responsibility, preserved user work, and no claim beyond available evidence.

The aviation character is deliberately subtle. Express it through alignment, compact operational data, disciplined typography, and the existing FlyEye logo after its source asset is approved for repository use—not faux gauges, radar decoration, cockpit textures, horizon graphics, rivets, aircraft silhouettes, or entertainment-style motion.

### 3.1 Signature identity

Use a small set of recognizable elements consistently:

1. The existing FlyEye logo is intended to anchor sign-in and the top-left application shell, but implementation waits for a bounded asset task to record the approved source file, permitted variants, clear space, and accessible text treatment. Do not redraw, reinterpret, or generate a replacement.
2. Navy provides structure and primary-action emphasis; teal carried from the existing interface provides restrained brand emphasis. Semantic status colors remain separate.
3. Page headers use a consistent context line, title, supporting metadata, and optional thin teal keyline. Do not invent a different hero treatment per feature.
4. Operational identifiers, timestamps, measurements, and versions use the mono data style sparingly.
5. Selected navigation and focused controls share the same teal family, making orientation recognizable without turning entire surfaces teal.

These elements create identity through repetition. Do not add decorative variants merely to make a screen feel designed.

## 4. Design principles

1. **Workflow before dashboard polish.** Make the current task, responsible person, source, state, and permitted next action clear.
2. **Calm precision.** Prefer light surfaces, strong alignment, restrained color, and compact information density over decorative effects.
3. **State is explicit.** Pair color with a label and, where helpful, an icon. Show why an action is unavailable.
4. **Authority is visible but never implied.** Separate drafts, suggestions, submissions, and finalized records. UI visibility never replaces server authorization.
5. **Source and freshness stay near decisions.** Show source, timestamp or effective period, and stale/unavailable treatment where required.
6. **Responsive, not reduced.** Reorder and prioritize content on small screens without hiding required context or authority warnings.
7. **Progressive adoption.** Apply this system through bounded components and flows; do not perform an unverified app-wide visual rewrite.

## 5. Foundations

### 5.1 Color tokens

| Token | Value | Intended use |
|---|---:|---|
| `--color-navy-700` | `#0E2246` | Primary actions, application structure, strong headings |
| `--color-navy-800` | `#0B1B3D` | Primary hover/pressed state and rare dark utility surfaces |
| `--color-teal-700` | `#176C69` | Links, focus treatment, selected indicators on light surfaces |
| `--color-teal-500` | `#2B9B95` | Small brand accents or indicators on dark surfaces; not normal text on white |
| `--color-teal-50` | `#ECF8F7` | Subtle selected or highlighted surface |
| `--color-white` | `#FFFFFF` | Primary surface |
| `--color-slate-50` | `#F8F9FA` | Secondary surface and subtle grouping |
| `--color-slate-200` | `#E5E7EB` | Borders and dividers |
| `--color-slate-400` | `#9CA3AF` | Disabled decoration; not normal body text |
| `--color-slate-500` | `#6B7280` | Metadata on white where contrast is sufficient |
| `--color-slate-700` | `#374151` | Body text |
| `--color-slate-800` | `#1F2937` | Headings |
| `--color-positive-text` | `#166534` | Positive status text/icons |
| `--color-positive-bg` | `#F0FDF4` | Positive status tint |
| `--color-warning-text` | `#854D0E` | Attention status text/icons |
| `--color-warning-bg` | `#FFFBEB` | Attention status tint |
| `--color-danger-text` | `#B91C1C` | Error, destructive, or blocked status text/icons |
| `--color-danger-bg` | `#FEF2F2` | Error, destructive, or blocked status tint |

Teal is a brand and interaction color, not a success state. Semantic colors describe interface treatment, not aviation status. A feature specification must define whether a record is current, expired, blocked, eligible, approved, or otherwise operationally meaningful. Never use color alone, and verify WCAG 2.2 AA contrast in each rendered context.

No gradients, glow, aura, or decorative blur. Dark navy is reserved for controls or compact utility areas, not a default full-page surface.

### 5.2 Typography

- Display and headings: Archivo, weights 600 and 700.
- Body and controls: IBM Plex Sans, weights 400, 500, and 600.
- Operational data: IBM Plex Mono, weights 400 and 500, only for identifiers, timestamps, measurements, version values, and compact status metadata.

Target sizes are 40/48 px for the largest desktop page title, 28/34 px for section headings, 20/25 px for subsection headings, 16/26 px for body copy, and 13/20 px for supporting text. Responsive screens may reduce the largest title to 32/40 px.

Font assets must be licensed, locally served with the application where practical, and covered by the normal dependency/security review. Always define a system fallback stack so text remains available if a font asset fails. Do not use a decorative serif for operational headings.

### 5.3 Spacing and layout

- Base spacing unit: 8 px; 4 px is allowed only for tight inline relationships.
- Content width: up to 1200 px with 32 px desktop gutters, 24 px tablet gutters, and 16 px phone gutters.
- Use a 12-column desktop grid where it improves alignment; forms and detail views may use narrower readable measures.
- Initial responsive reference ranges: phone up to 640 px, tablet 641-1024 px, and desktop above 1024 px. Components must still respond to their available width rather than device labels alone.
- Non-inline interactive targets are at least 44 by 44 CSS px on phone and tablet. Dense desktop controls may be 32 px high, but their pointer target remains at least 24 by 24 CSS px or has sufficient spacing under WCAG 2.2 target-size exceptions. Inline text links are exempt from the box size but retain a visible focus treatment.
- Prefer left-aligned content, deliberate hierarchy, and asymmetric work areas. Centered layouts are appropriate for short authentication and terminal-state panels.

Reference viewport checks cover 320 px and 390 px phones, 768 px and 1024 px tablets, and 1280 px and 1440 px laptops/desktops. Also verify 200% browser zoom, portrait and landscape tablet use, touch and pointer input, software-keyboard obstruction, and safe-area insets. Brand-name devices are examples, not separate layouts.

### 5.4 Density

Instructor and administration work establish the baseline information density: compact enough for scanning lists and records, but never compressed below the target-size and readability rules. Student flows use the same components with fewer simultaneous controls, more guidance, and a clearer single next action. Do not add a user-selectable density mode until testing demonstrates a need.

### 5.5 Shape and depth

- Buttons, inputs, and compact controls: 8 px radius.
- Cards, panels, and dialogs: 12 px radius.
- Status badges: pill radius is allowed because the element is a compact label.
- Inline cards use a 1 px border and no shadow. Menus and dialogs that overlap content may use one restrained shadow.
- Do not animate or elevate non-interactive containers on hover.

### 5.6 Motion

Use a 150 ms ease-out transition for color, border, opacity, and small transforms. Avoid page-load animation, scroll reveals, autoplay, parallax, and decorative carousels. Respect `prefers-reduced-motion`; progress and state changes must remain understandable with motion disabled.

## 6. Application shell

### 6.1 Unauthenticated and recovery flows

Sign-in, invitation acceptance, password recovery, MFA enrollment, and access-denied states use a focused single-column shell. Show the school/deployment identity only when it comes from trusted configuration, and do not offer school selection. The [UI/UX Guidelines](07_UI_UX_GUIDELINES.md#5-form-behavior) and bounded feature specifications own form and error behavior.

### 6.2 Authenticated desktop and tablet

Use a stable application header plus a left navigation rail when module count justifies it. Follow the candidate areas and authorization boundary in [UI/UX navigation](07_UI_UX_GUIDELINES.md#3-navigation); only implemented and authorized areas appear.

The header may contain the current page context, connectivity/freshness indicators, notifications when implemented, and the user menu. Do not show an organization switcher.

### 6.3 Authenticated phone

Prioritize the current task, status, and primary action. Use a compact top bar and a labelled navigation drawer or similarly discoverable pattern. Avoid icon-only primary navigation and horizontal overflow for core workflows. Authority-bearing confirmation must remain fully visible without relying on hover.

## 7. Core page patterns

### 7.1 Home and work queue

Home is a role-sensitive work queue, not a generic metric dashboard. Lead visually with actionable items and required attention. Summary metrics are secondary and appear only when their definition and source are approved.

### 7.2 List and detail

Use a row-based list or data table for members, aircraft, documents, dispatch records, and assessments. Keep search, filters, sort, and result count in a predictable toolbar. On narrow screens, use prioritized columns or structured row cards while preserving status, key identifier, next action, and filter state. Follow [responsive table and report behavior](07_UI_UX_GUIDELINES.md#13-responsive-tables-and-reports).

A detail view shows identity, current state, source/freshness where applicable, relevant history, and permitted actions. Destructive or authority-bearing actions are visually separated from routine edits.

### 7.3 Forms and drafts

Break long forms into visually named sections with a progress or summary view. Use consistent label, helper, validation, and read-only presentation. The [form behavior](07_UI_UX_GUIDELINES.md#5-form-behavior) and [offline interaction](07_UI_UX_GUIDELINES.md#9-offline-interaction) sections own validation, preservation, autosave, and sync rules.

### 7.4 Review and transition

Before a protected transition, present the target record, current state, resulting state, material warnings, and required reason or acknowledgement in one scannable confirmation surface. Follow the canonical [status and state-transition behavior](07_UI_UX_GUIDELINES.md#6-status-and-state-transitions); feature specifications own protected workflow requirements.

### 7.5 Source, freshness, and AI

Source panels place provenance and freshness near the dependent decision. AI output, if later enabled, is visually separated from source and user text. Follow the canonical [source and freshness](07_UI_UX_GUIDELINES.md#7-source-and-freshness) and [AI interaction](07_UI_UX_GUIDELINES.md#8-ai-interaction) behavior.

## 8. Reusable components

Build FlyEye components around consistent semantics rather than one-off feature styling:

```text
FlyEyeAppShell          FlyEyePageHeader
FlyEyeFormSection       FlyEyeTextField
FlyEyeSelect            FlyEyeDateTimeField
FlyEyeDataTable         FlyEyeStatusBadge
FlyEyeSourcePanel       FlyEyeValidationSummary
FlyEyeConfirmDialog     FlyEyeAuditTimeline
FlyEyeOfflineIndicator  FlyEyeEmptyState
FlyEyeErrorState        FlyEyeUnauthorizedState
```

### 8.1 Buttons and links

- One primary action per local decision area.
- Primary: navy background, white text, no shadow.
- Secondary: white or transparent surface, slate border, dark text.
- Destructive: danger treatment plus explicit text; never red icon alone.
- Disabled controls remain readable and include an adjacent or discoverable reason when the action matters.
- Active press movement may be at most 1 px and must not shift surrounding layout.

### 8.2 Inputs

Inputs use a visible label, supporting text only when useful, 1 px border, and a clear 2 px teal focus ring on light surfaces. Dark surfaces use the light teal token or another verified high-contrast treatment. Placeholder text is never the only label or instruction. Validation messages identify the problem and corrective action; the top summary links to affected fields.

### 8.3 Status badges

Status badges use short plain-language labels with semantic tint, text, and an optional consistent icon. Do not force all statuses into positive/warning/danger; neutral and informational states are valid. Status vocabulary comes from the bounded feature specification.

### 8.4 Icons

Use one reviewed, accessible icon family after normal package evaluation. No icon package is selected by this document. Icons supplement text, have accessible names where needed, and never use emoji as operational controls.

## 9. Required states and accessibility

Use the reusable state components in this document to present every state required by the bounded feature. The [UI/UX Guidelines](07_UI_UX_GUIDELINES.md#10-accessibility) own accessibility behavior and evidence. This visual system adds measurable target sizes in [Spacing and layout](#53-spacing-and-layout), a visible focus treatment, contrast verification for every token pairing, reflow without horizontal page scrolling at 320 CSS px, and no color-only meaning.

## 10. Product voice

FlyEye sounds professional, calm, direct, and respectful. “Easy to use” and “intuitive” are design outcomes, not phrases the interface should use to praise itself. Follow the canonical [content style and voice examples](07_UI_UX_GUIDELINES.md#12-content-style) and the active [product-language scope](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#product-and-commercial-direction).

Preferred words describe observable actions: save draft, submit for review, return with reason, confirm role change, view source, retry sync. Avoid words such as seamless, unified, empower, elevate, revolutionize, and intelligent when they obscure what the product actually does.

### 10.1 Anti-template check

A screen should fail design review if it relies on several of these patterns without a workflow reason:

- oversized centered headings above routine application work;
- many floating cards with identical visual weight;
- excessive pills, gradients, shadows, rounded containers, or decorative charts;
- generic sparkle, robot, rocket, shield, or aircraft icons used as decoration;
- invented metrics, testimonials, or reassuring claims;
- stock aviation imagery inside authenticated workflows;
- different accent colors or component treatments introduced feature by feature;
- placeholder copy that could belong to any SaaS product.

Use real FlyEye field names and states with synthetic values. A polished screen should still look specific to flight-school operations when its logo is temporarily hidden.

## 11. Adoption and verification

The existing interface predates these tokens and contains legacy color, typography, shadow, gradient, and radius choices. This document records a working reference; it does not claim current conformance or require implementation before the next business-logic specification.

If this system is adopted before a later redesign supersedes it, use bounded follow-up work:

1. Complete one bounded adoption slice for tokens, focus treatment, shared primitives, and an existing authentication shell without changing authority or workflow behavior.
2. Use that verified slice as the visual baseline for later interface implementation; business-logic specification may proceed independently.
3. Migrate remaining existing flows only through separately scoped follow-up work or when a feature is otherwise touched; a full retrospective migration is not a Stage 2 prerequisite.
4. For each slice, verify its applicable states and desktop/phone behavior and retain before/after evidence where authorized.
5. Run automated accessibility checks plus keyboard and screen-reader workflow review. Formal WCAG evidence and pilot-user validation remain separate qualified gates.
