# Peer Review: Share My Work & Review Others' Work

## Overview

Two new activity types that enable anonymous peer review within a lesson. Pupils share their work through a "Share My Work" activity, then review and comment on classmates' work through a linked "Review Others' Work" activity. All shared work is presented anonymously -- reviewers do not see the author's name.

---

## Activity Type: `share-my-work`

### Purpose

Allows a pupil to upload, reorder, and remove files to share with classmates for peer review.

### Category

Non-scorable. No teacher marking. `is_summative` must be `false`.

### Teacher Configuration

When creating this activity, the teacher provides:

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Display title (e.g. "Share My Work") |
| `name` | `string` | Yes | A unique identifier within the lesson (e.g. "poster-draft"). Used to label the shared work collection. Must be unique among all `share-my-work` activities in the same lesson. |

### `body_data` structure

```json
{
  "name": "poster-draft"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `name` | `string` | Yes | min 1 char, unique within lesson | Identifies this shared work collection within the lesson |

### Pupil Interaction

1. Pupil opens the activity and sees an image upload area.
2. Pupil can upload one or more image files (accepted types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`).
3. Pupil can reorder uploaded images via drag-and-drop.
4. Pupil can remove images they have uploaded.
5. Pupil submits when they are happy with their selection.

### Submission body

```json
{
  "files": [
    { "fileId": "uuid-1", "fileName": "sketch-v2.png", "mimeType": "image/png", "order": 0 },
    { "fileId": "uuid-2", "fileName": "photo.jpg", "mimeType": "image/jpeg", "order": 1 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `files` | `array` | Ordered list of uploaded image files |
| `files[].fileId` | `string` | UUID referencing the stored file |
| `files[].fileName` | `string` | Original file name |
| `files[].mimeType` | `string` | MIME type (must be `image/png`, `image/jpeg`, `image/gif`, or `image/webp`) |
| `files[].order` | `number` | Display order (0-based) |

---

## Activity Type: `review-others-work`

### Purpose

Allows pupils to browse work shared by classmates (via a linked `share-my-work` activity) and leave comments for peer review.

### Category

Non-scorable. No teacher marking. `is_summative` must be `false`.

### Teacher Configuration

When creating this activity, the teacher provides:

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Display title (e.g. "Review Others' Work") |
| `shareActivityId` | `string` | Yes | The `activity_id` of the `share-my-work` activity whose submissions pupils will review. Must reference a `share-my-work` activity in the same lesson. |

### `body_data` structure

```json
{
  "shareActivityId": "uuid-of-share-my-work-activity"
}
```

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `shareActivityId` | `string` | Yes | Must reference a valid `share-my-work` activity in the same lesson | Links this review activity to the shared work it reviews |

### Pupil Interaction

1. Pupil opens the activity and sees a list of anonymous submissions from classmates (the pupil's own work is excluded from the list). Each submission is labelled generically (e.g. "Submission 1", "Submission 2") -- the author's name is never shown.
2. Pupil selects a submission to review.
3. Pupil views the submitted images (in the order the author set).
4. Pupil can leave one or more comments on the work.
5. Pupil can review multiple classmates' work.

### Submission body

No traditional submission. Comments are stored separately (see Comments section below).

---

## Comments

### Storage

Comments are stored in a new `peer_review_comments` table.

| Column | Type | Default | Description |
|---|---|---|---|
| `comment_id` | `text` | `gen_random_uuid()` | Primary key |
| `review_activity_id` | `text` | -- | Foreign key to `activities.activity_id` (the `review-others-work` activity) |
| `author_user_id` | `text` | -- | The pupil who wrote the comment |
| `target_user_id` | `text` | -- | The pupil whose work is being commented on |
| `comment_text` | `text` | -- | The comment content |
| `created_at` | `timestamptz` | `now()` | When the comment was posted |
| `is_flagged` | `boolean` | `false` | Whether the work author has flagged this comment as inappropriate |
| `flagged_at` | `timestamptz` | `null` | When the comment was flagged |

### Anonymity

- Comments are displayed without showing the commenter's name to other pupils.
- The `author_user_id` is stored in the database for teacher moderation but is never exposed to the pupil UI.
- Teachers can see the real identity of both the work author and comment author.

### Flagging

- Only the **work author** (the pupil whose work received the comment, i.e. `target_user_id`) can flag a comment as inappropriate.
- Flagging sets `is_flagged = true` and records `flagged_at`.
- Flagged comments remain visible but are highlighted for teacher review.
- Teachers can see all flagged comments across the class from the activity's teacher view, along with the real identities of both parties.

---

## Validation Rules

1. A `share-my-work` activity's `name` must be unique within its lesson.
2. A `review-others-work` activity's `shareActivityId` must reference an existing `share-my-work` activity in the same lesson.
3. Pupils cannot comment on their own work.
4. Only the `target_user_id` (work author) can flag a comment.

---

## Out of Scope (Initial Release)

- Scoring or marking of shared work or reviews (to be considered later).
- Reply threads on comments (comments are flat).
- Revealing reviewer identity to pupils.
- Non-image file types (PDFs, documents, etc.).
- Teacher commenting through this activity (teachers use existing feedback tools).
