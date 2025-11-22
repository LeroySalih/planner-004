# Plan: Mobile-Friendly Layouts for Home, Pupil Lessons, and Unit Reports

## Problem Statement
The current layouts for `/`, `/pupil-lessons/[id]`, and `/reports/[id]/units/[unitId]` are optimized for desktop but do not adapt cleanly to smaller viewports. We need a mobile-specific experience that preserves the existing desktop UI while ensuring readability, navigation, and interaction on phones.

## Objectives
1. Keep the current desktop/tablet UI unchanged for wider screens.
2. Deliver mobile-friendly layouts across common phone widths (320px–430px) with accessible tap targets and readable typography.
3. Avoid client-side Supabase calls; rely on server-rendered data and existing actions.
4. Preserve established theming, Tailwind tokens, and Radix primitives.

## Approach
1. **Audit and breakpoints**
   - Inventory each page’s key sections (hero, navigation, cards, tables/forms) and identify elements that overflow or rely on fixed widths.
   - Confirm existing Tailwind breakpoints; standardize mobile-first adjustments targeting `sm`/`md` to leave desktop behavior untouched.
2. **Responsive layout patterns**
   - Wrap wide grids/tables with responsive stacks and horizontal scroll only when necessary; prefer cardized summaries on mobile.
   - Use flex/stack patterns with spacing tokens, ensuring headings and CTAs reflow without truncation.
   - Enforce min tap size (~44px) and readable text sizes; adjust padding/margins for 320px widths.
3. **Page-specific plans**
   - `/`: Reflow hero and CTA into a vertical stack, collapse any side-by-side feature panels into a single column, and ensure navigation is reachable (hamburger/drawer if present).
   - `/pupil-lessons/[id]`: Convert lesson summaries into vertical cards with key metrics up top; stack filters and action buttons; allow detail sections to collapse or scroll responsively.
   - `/reports/[id]/units/[unitId]`: Move unit metrics into stacked cards, make tables horizontally scrollable with sticky headers when needed, and keep charts/responsive grids to single-column on small screens.
4. **Guard desktop parity**
   - Gate new mobile styles behind mobile-first classes only; avoid altering existing `md+` layouts.
   - Preserve component contracts; reuse shared UI primitives and `cn` helper to merge responsive classes.
5. **Accessibility and interaction**
   - Verify focus states and keyboard navigation remain visible; ensure buttons/links keep contrast.
   - Maintain button loaders via `useActionState` patterns where applicable.
6. **Validation**
   - Manual passes at 320px, 360px, 390px, and 430px widths in dev tools for the three routes.
   - Add notes in a follow-up ticket if any sections need bespoke Playwright coverage or further refactors.

## Deliverables
1. Responsive layout updates for the three routes with desktop unaffected.
2. Notes on remaining gaps and any follow-up test coverage needed.
