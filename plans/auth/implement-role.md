# Plan: Implement Multi-Role Authorization

## Objective
Replace the binary `is_teacher` flag with a flexible, multi-role system. This will allow users to hold multiple roles (e.g., "pupil", "teacher", "technician") simultaneously. Authorization checks throughout the application will be updated to verify specific role membership. **Roles are strictly independent; there is no implicit hierarchy (e.g., an Admin does not automatically inherit Teacher permissions).**

## 1. Database Schema Changes

We will introduce a normalized schema to manage roles and user assignments.

### New Tables
1.  **`roles`**
    *   `role_id` (text, PK): Unique identifier (e.g., "teacher", "pupil").
    *   `description` (text): Optional description of the role's capabilities.
    *   `created_at` (timestamp).

2.  **`user_roles`**
    *   `user_id` (text, FK -> `profiles.user_id`): The user.
    *   `role_id` (text, FK -> `roles.role_id`): The assigned role.
    *   `assigned_at` (timestamp).
    *   Primary Key: `(user_id, role_id)`.

### Migrations
*   Create migration files in `/src/migrations` (e.g., `029-create-roles-tables.sql`).
*   Create `roles` and `user_roles` tables.
*   Seed initial roles: `teacher`, `pupil`, `technician`, `admin`.
*   **Data Migration**:
    *   Insert `(user_id, 'teacher')` into `user_roles` for all profiles where `is_teacher = true`.
    *   Insert `(user_id, 'pupil')` into `user_roles` for all profiles where `is_teacher = false`.
*   **Cleanup**: Remove `is_teacher` column from `profiles` table (or mark deprecated).

## 2. Server-Side Logic Updates (`src/lib/auth.ts`)

### Type Definitions
Update `AuthenticatedProfile` and `ProfileSchema` in `src/types/index.ts`:
```typescript
export type AuthenticatedProfile = {
  userId: string
  email: string | null
  // isTeacher: boolean // DEPRECATED -> Computed getter or removed
  roles: string[] // NEW
  firstName?: string | null
  lastName?: string | null
}
```

### Auth Functions
1.  **`readProfile`**: Update the SQL query to join with `user_roles` and aggregate roles into an array.
2.  **`getAuthenticatedProfile`**: Ensure the session hydration includes the new `roles` array.
3.  **Helper Functions**:
    *   `hasRole(profile: AuthenticatedProfile, role: string): boolean`
    *   `requireRole(role: string): Promise<AuthenticatedProfile>`
4.  **`requireTeacherProfile` Refactor**:
    *   Update implementation to call `requireRole('teacher')`.
    *   This preserves the existing function signature for backward compatibility while switching the logic.

## 3. Application Logic Refactoring

### Search & Replace `is_teacher` / `isTeacher`
Scan the codebase for all usages of the teacher flag.
*   **Server Actions**: Update permission checks in `src/lib/server-actions/*.ts`.
    *   Example: Replace `if (!profile.isTeacher)` with `if (!hasRole(profile, 'teacher'))`.
*   **UI Components**: Update conditional rendering in `src/components/*.tsx`.
    *   Example: `profile.isTeacher ? <TeacherView /> : <PupilView />` becomes `profile.roles.includes('teacher') ? ...`.

### Key Areas to Update
*   `src/lib/server-actions/groups.ts`: Group creation/management permissions.
*   `src/lib/server-actions/lessons.ts`: Lesson editing permissions.
*   `src/app/reports/page.tsx`: Access control for reports.
*   `src/components/assignment-manager`: Teacher-specific views.

## 4. Administration Features

### New Server Actions
*   `readAllProfilesAction()`: Returns list of all users with their roles (admin only).
*   `createRoleAction(roleId: string, description: string)`
*   `deleteRoleAction(roleId: string)`
*   `assignRoleAction(userId: string, roleId: string)`
*   `removeRoleAction(userId: string, roleId: string)`

### User Signup
*   Update `signupAction` to automatically assign the `pupil` role to all new registrations.

### Admin UI
*   Create a new directory `src/app/admin` with a `layout.tsx` that calls `requireRole('admin')` to protect all sub-routes.
*   Create `src/app/admin/page.tsx` as a landing page for administrative tasks.
*   Create a new route `/admin/roles` for managing user-to-role assignments.
*   **Role Manager Component**: Create `src/components/admin/role-manager.tsx`.
    *   Fetch all users via `readAllProfilesAction`.
    *   Render a table listing users (Name, Email).
    *   For each user, display their current roles as badges.
    *   Provide an "Edit Roles" dialog or inline multi-select (e.g., using `shadcn/ui` checkboxes) to toggle `teacher`, `technician`, `admin`, `pupil`.
    *   Optimistic updates for immediate feedback when toggling roles.
*   **Role Definition**: Simple form to add new role definitions (ID, Description) if needed, though standard roles are seeded.

### Role-Based Access Mapping

| Role | Permitted Areas / Links |
| :--- | :--- |
| **Pupil** | My Units, Dashboard |
| **Technician** | Queue |
| **Teacher** | Curriculum, Units, SoW (Assignments), Groups, Reports |
| **Admin** | Role Administration, User Management |

## 5. Migration Strategy

1.  **Phase 1: Database & Seed (Non-breaking)**
    *   Deploy schema changes.
    *   Run migration script to populate `user_roles` based on `is_teacher`.
    *   **Bootstrap Initial Admin**: Assign the `admin` role to user with email `leroysalih@bisak.org`.
    *   Codebase continues to read `is_teacher`.

2.  **Phase 2: Dual-Read**
    *   Update `readProfile` to fetch both `is_teacher` column AND `user_roles`.
    *   Ensure `AuthenticatedProfile.roles` is populated.

3.  **Phase 3: Codebase Cutover**
    *   Replace logic to rely on `roles.includes(...)`.
    *   Update `requireTeacherProfile` to check roles.

4.  **Phase 4: Cleanup**
    *   Drop `is_teacher` column.

## Open Questions
*No open questions at this time.*

