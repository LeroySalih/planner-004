# Content-Disposition Non-ASCII Filename Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `TypeError: Cannot convert argument to a ByteString` caused by non-ASCII filenames (Arabic, Unicode spaces) being placed raw into `Content-Disposition` response headers.

**Architecture:** Add a single RFC 5987 filename-encoding helper in the file-serving route and apply it at all three `Content-Disposition` set calls. RFC 5987 uses a `filename*=UTF-8''<percent-encoded>` parameter for Unicode support alongside an ASCII `filename` fallback for old clients.

**Tech Stack:** Next.js 15 Route Handler, TypeScript, Node.js built-in `encodeURIComponent`.

---

## Files touched

| File | Change |
|------|--------|
| `src/app/api/files/[bucket]/[...filePath]/route.ts` | Add `buildContentDisposition()` helper; replace all three raw `Content-Disposition` set calls |

---

## Task 1: Encode filenames in Content-Disposition header

**Files:**
- Modify: `src/app/api/files/[bucket]/[...filePath]/route.ts`

- [ ] **Step 1: Read the file to understand current structure**

Read `src/app/api/files/[bucket]/[...filePath]/route.ts` lines 92–155 to confirm the three `headers.set("Content-Disposition", ...)` calls at lines 133, 143, and 152.

- [ ] **Step 2: Add the encoding helper near the top of the file (before the route handler)**

Find the first function or `export` in the file and insert the helper above it:

```typescript
/**
 * Build a Content-Disposition header value that is safe for all HTTP clients.
 *
 * HTTP headers are Latin-1 only (0–255). Filenames containing non-ASCII
 * characters (Arabic, Unicode spaces, emoji, etc.) throw a ByteString error
 * when placed raw into a header. RFC 5987 solves this:
 *   - `filename` = ASCII-safe fallback (non-ASCII replaced with "_")
 *   - `filename*` = percent-encoded UTF-8 name for modern clients
 */
function buildContentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_")
  const encoded = encodeURIComponent(fileName)
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}
```

- [ ] **Step 3: Replace the three raw Content-Disposition assignments**

**Line 133** (HEIC converted to JPEG, inline/attachment path):

Before:
```typescript
headers.set("Content-Disposition", `${shouldInline ? "inline" : "attachment"}; filename="${jpegFileName}"`)
```
After:
```typescript
headers.set("Content-Disposition", buildContentDisposition(shouldInline ? "inline" : "attachment", jpegFileName))
```

**Line 143** (HEIC conversion failed, serve original HEIC):

Before:
```typescript
headers.set("Content-Disposition", `attachment; filename="${fileName}"`)
```
After:
```typescript
headers.set("Content-Disposition", buildContentDisposition("attachment", fileName))
```

**Line 152** (all other file types):

Before:
```typescript
headers.set("Content-Disposition", `${shouldInline ? "inline" : "attachment"}; filename="${fileName}"`)
```
After:
```typescript
headers.set("Content-Disposition", buildContentDisposition(shouldInline ? "inline" : "attachment", fileName))
```

- [ ] **Step 4: Verify lint passes**

```bash
cd /Users/leroysalih/nodejs/planner-004 && pnpm lint
```

Pre-existing ESLint config warning (circular JSON) can be ignored. No new errors expected.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/files/[bucket]/[...filePath]/route.ts
git commit -m "fix(files): encode non-ASCII filenames in Content-Disposition header

Filenames with Arabic characters or Unicode spaces (e.g. U+202F, U+0644)
caused 'Cannot convert argument to a ByteString' when placed raw into HTTP
headers, which are Latin-1 only. Uses RFC 5987 encoding: ASCII fallback in
filename= and percent-encoded UTF-8 in filename*=."
```
