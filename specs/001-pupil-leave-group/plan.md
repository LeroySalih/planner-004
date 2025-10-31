# Implementation Plan: Pupil Self-Removal from Groups

**Branch**: `[001-pupil-leave-group]` | **Date**: 2025-10-31 | **Spec**: [link](./spec.md)
**Input**: Feature specification from `/specs/001-pupil-leave-group/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Empower pupils to leave optional groups on their own while preserving audit visibility for teachers and preventing departures from mandatory cohorts. The implementation will extend existing Next.js 15 App Router flows, Supabase-backed group membership records, and established server action patterns to support self-service removal, confirmation messaging, and teacher notifications.

## Technical Context

**Language/Version**: TypeScript (Next.js 15 App Router, React 19)  
**Primary Dependencies**: Supabase server actions, Zod validation, Tailwind CSS v4, Radix UI primitives, Sonner toasts  
**Storage**: Supabase Postgres (groups, memberships, assignments)  
**Testing**: Playwright end-to-end flows (no unit harness yet)  
**Target Platform**: Web application (teachers and pupils)  
**Project Type**: Web app with server/client components under `src/app`  
**Performance Goals**: Responsive membership updates reflected within the active session (<1s perceived delay for UI refresh)  
**Constraints**: Uphold existing authorization guards (`requireTeacherProfile`, `requireAuthenticatedProfile`), reuse `createSupabaseServerClient` patterns, no new external services  
**Scale/Scope**: Classroom-sized cohorts (tens of groups per teacher, hundreds of pupils) with immediate effect on assignment access

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Current constitution file contains only placeholders and no enforceable principles; no gates triggered. Proceed with standard due diligence and document any emergent constraints during research.

## Project Structure

### Documentation (this feature)

```text
specs/001-pupil-leave-group/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── actions/
├── app/
│   ├── assignments/
│   └── (route components and layouts)
├── components/
│   ├── assignment-manager/
│   └── ui/
├── lib/
│   ├── supabase/
│   └── server-actions/
└── types/

specs/
└── 001-pupil-leave-group/

tests/
└── sign-in/
```

**Structure Decision**: Leverage existing Next.js monorepo layout—feature work touches server actions under `src/lib`, UI components under `src/components`, and routing within `src/app`; tests remain in Playwright suite under `tests/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
