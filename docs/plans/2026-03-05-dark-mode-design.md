# Dark Mode Design

Date: 2026-03-05

## Summary

Introduce dark mode support using the existing `next-themes` infrastructure and CSS token definitions already present in the codebase.

## Current State

- `globals.css` already defines both `:root` (light) and `.dark` CSS variable sets
- `src/components/theme-provider.tsx` exists with `next-themes` wrapper but is not used
- The root layout has no `ThemeProvider`, so theming is non-functional
- No toggle UI exists

## Approach

System preference auto-detection (`defaultTheme="system"`) with a manual override toggle placed inside the user dropdown menu.

## Changes Required

### 1. `src/app/layout.tsx`

- Import and wrap the layout with `<ThemeProvider defaultTheme="system" enableSystem attribute="class">`
- Add `suppressHydrationWarning` to `<html>` (required by next-themes to suppress expected hydration mismatch)

### 2. `src/components/navigation/user-nav.tsx`

- Import `useTheme` from `next-themes` and `Sun`/`Moon` from lucide-react
- Add a `DropdownMenuItem` inside the existing dropdown (above the separator) that:
  - Shows `Moon` icon + "Dark mode" when currently in light mode
  - Shows `Sun` icon + "Light mode" when currently in dark mode
  - Calls `setTheme()` to toggle between `"light"` and `"dark"`
- Only appears when a user profile is loaded (already inside the signed-in branch)

## Out of Scope

- No toggle on the sign-in/public pages (OS preference applies there automatically)
- No third "system" option in the UI (system is the default, user can override to light or dark)
- No persistence beyond what next-themes provides (localStorage by default)
