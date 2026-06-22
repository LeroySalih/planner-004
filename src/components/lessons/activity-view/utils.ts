import type {
  FeedbackActivityBody,
  FeedbackActivityGroupSettings,
  LessonActivity,
  LongTextActivityBody,
  ShortTextActivityBody,
  UploadSpreadsheetActivityBody,
  UploadUrlActivityBody,
} from "@/types";
import { marked } from "marked";

export interface VoiceBody {
  audioFile: string | null;
  mimeType?: string | null;
  duration?: number | null;
  size?: number | null;
  [key: string]: unknown;
}

export interface ImageBody {
  imageFile: string | null;
  imageUrl?: string | null;
  [key: string]: unknown;
}

export interface McqOptionBody {
  id: string;
  text: string;
  imageUrl?: string | null;
}

export interface McqBody {
  question: string;
  options: McqOptionBody[];
  correctOptionId: string;
  imageFile?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

export type ShortTextBody = ShortTextActivityBody;
export type LongTextBody = LongTextActivityBody;
export type UploadUrlBody = UploadUrlActivityBody;

const FEEDBACK_GROUP_DEFAULTS: FeedbackActivityGroupSettings = {
  isEnabled: false,
  showScore: false,
  showCorrectAnswers: false,
};

export function isAbsoluteUrl(value: string | null): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value) || value.startsWith("data:") ||
    value.startsWith("/");
}

export function getActivityTextValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return "";
  }
  const record = activity.body_data as Record<string, unknown>;
  const text = record.text;
  if (typeof text === "string") {
    return text;
  }
  const instructions = record.instructions;
  if (typeof instructions === "string") {
    return instructions;
  }
  return "";
}

export function getActivityFileUrlValue(activity: LessonActivity): string {
  if (typeof activity.body_data !== "object" || activity.body_data === null) {
    return "";
  }
  const record = activity.body_data as Record<string, unknown>;
  const fileUrl = record.fileUrl ?? record.file_url;
  return typeof fileUrl === "string" ? fileUrl : "";
}

export function getVoiceBody(activity: LessonActivity): VoiceBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { audioFile: null };
  }

  const body = activity.body_data as Record<string, unknown>;
  const audioFile = typeof body.audioFile === "string" ? body.audioFile : null;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
  const duration = typeof body.duration === "number" ? body.duration : null;
  const size = typeof body.size === "number" ? body.size : null;

  return {
    ...body,
    audioFile,
    mimeType,
    duration,
    size,
  };
}

export function getImageBody(activity: LessonActivity): ImageBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { imageFile: null, imageUrl: null };
  }

  const body = activity.body_data as Record<string, unknown>;
  const rawImageFile = typeof body.imageFile === "string"
    ? body.imageFile
    : body.image_file;
  const rawImageUrl = typeof body.imageUrl === "string"
    ? body.imageUrl
    : body.image_url;
  const rawFileUrl = typeof body.fileUrl === "string"
    ? body.fileUrl
    : body.file_url;

  const normalizedImageFile = typeof rawImageFile === "string"
    ? rawImageFile
    : null;
  const normalizedImageUrl = typeof rawImageUrl === "string"
    ? rawImageUrl
    : null;
  const normalizedFileUrl = typeof rawFileUrl === "string" ? rawFileUrl : null;

  let imageFile = normalizedImageFile;
  let imageUrl = normalizedImageUrl;

  if (!imageFile && normalizedFileUrl && !isAbsoluteUrl(normalizedFileUrl)) {
    imageFile = normalizedFileUrl;
  }

  if (!imageUrl && normalizedFileUrl && isAbsoluteUrl(normalizedFileUrl)) {
    imageUrl = normalizedFileUrl;
  }

  return {
    ...(body as ImageBody),
    imageFile,
    imageUrl: imageUrl ?? null,
  };
}

export function getMcqBody(activity: LessonActivity): McqBody {
  const defaultOptions: McqOptionBody[] = [
    { id: "option-a", text: "" },
    { id: "option-b", text: "" },
  ];

  if (!activity.body_data || typeof activity.body_data !== "object") {
    return {
      question: "",
      options: defaultOptions,
      correctOptionId: defaultOptions[0].id,
      imageFile: null,
      imageUrl: null,
      imageAlt: null,
    };
  }

  const record = activity.body_data as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : "";
  const correctOptionId = typeof record.correctOptionId === "string"
    ? record.correctOptionId
    : defaultOptions[0].id;
  const rawOptions = Array.isArray(record.options)
    ? record.options
    : defaultOptions;

  const options = rawOptions
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return { id: `option-${index + 1}`, text: "", imageUrl: null };
      }
      const option = item as Record<string, unknown>;
      const id = typeof option.id === "string" && option.id.trim() !== ""
        ? option.id.trim()
        : `option-${index + 1}`;
      const text = typeof option.text === "string" ? option.text : "";
      const imageUrl = typeof option.imageUrl === "string"
        ? option.imageUrl.trim() || null
        : null;
      return { id, text, imageUrl };
    }) as McqOptionBody[];

  const fallbackOptionId = options[0]?.id ?? defaultOptions[0].id;
  const normalizedCorrectOptionId =
    options.some((option) => option.id === correctOptionId)
      ? correctOptionId
      : fallbackOptionId;

  const imageFile = typeof record.imageFile === "string"
    ? record.imageFile.trim() || null
    : null;
  const imageUrl = typeof record.imageUrl === "string"
    ? record.imageUrl.trim() || null
    : null;
  const imageAlt = typeof record.imageAlt === "string"
    ? record.imageAlt.trim() || null
    : null;

  return {
    question,
    options: options.length > 0 ? options : defaultOptions,
    correctOptionId: normalizedCorrectOptionId,
    imageFile,
    imageUrl,
    imageAlt,
  };
}

export interface MatcherPairBody {
  id: string;
  term: string;
  definition: string;
}

export interface MatcherBody {
  pairs: MatcherPairBody[];
}

export function createMatcherPairId(used: Set<string>): string {
  let index = 1;
  let candidate = `pair-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `pair-${index}`;
  }
  return candidate;
}

export function createDefaultMatcherBody(): MatcherBody {
  return {
    pairs: [
      { id: "pair-1", term: "", definition: "" },
      { id: "pair-2", term: "", definition: "" },
    ],
  };
}

export function getMatcherBody(activity: LessonActivity): MatcherBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return createDefaultMatcherBody();
  }

  const record = activity.body_data as Record<string, unknown>;
  const rawPairs = Array.isArray(record.pairs) ? record.pairs : [];

  const used = new Set<string>();
  const pairs = rawPairs
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const pair = item as Record<string, unknown>;
      let id = typeof pair.id === "string" && pair.id.trim() !== "" ? pair.id.trim() : "";
      if (!id || used.has(id)) {
        id = createMatcherPairId(used);
      }
      used.add(id);
      const term = typeof pair.term === "string" ? pair.term : "";
      const definition = typeof pair.definition === "string" ? pair.definition : "";
      return { id, term, definition };
    })
    .filter((pair): pair is MatcherPairBody => pair !== null);

  return pairs.length > 0 ? { pairs } : createDefaultMatcherBody();
}

export interface GroupItemsGroupBody {
  id: string;
  name: string;
}

export interface GroupItemsItemBody {
  id: string;
  text: string;
  imageUrl: string | null;
  groupId: string;
}

export interface GroupItemsBody {
  groups: GroupItemsGroupBody[];
  items: GroupItemsItemBody[];
}

export function createGroupItemsGroupId(used: Set<string>): string {
  let index = 1;
  let candidate = `group-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `group-${index}`;
  }
  return candidate;
}

export function createGroupItemsItemId(used: Set<string>): string {
  let index = 1;
  let candidate = `item-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `item-${index}`;
  }
  return candidate;
}

export function createDefaultGroupItemsBody(): GroupItemsBody {
  return {
    groups: [
      { id: "group-1", name: "" },
      { id: "group-2", name: "" },
    ],
    items: [
      { id: "item-1", text: "", imageUrl: null, groupId: "group-1" },
      { id: "item-2", text: "", imageUrl: null, groupId: "group-2" },
    ],
  };
}

export function getGroupItemsBody(activity: LessonActivity): GroupItemsBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return createDefaultGroupItemsBody();
  }

  const record = activity.body_data as Record<string, unknown>;
  const rawGroups = Array.isArray(record.groups) ? record.groups : [];
  const rawItems = Array.isArray(record.items) ? record.items : [];

  const usedGroupIds = new Set<string>();
  const groups = rawGroups
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const group = entry as Record<string, unknown>;
      let id = typeof group.id === "string" && group.id.trim() !== "" ? group.id.trim() : "";
      if (!id || usedGroupIds.has(id)) {
        id = createGroupItemsGroupId(usedGroupIds);
      }
      usedGroupIds.add(id);
      const name = typeof group.name === "string" ? group.name : "";
      return { id, name };
    })
    .filter((group): group is GroupItemsGroupBody => group !== null);

  if (groups.length === 0) {
    return createDefaultGroupItemsBody();
  }

  const groupIds = new Set(groups.map((group) => group.id));
  const usedItemIds = new Set<string>();
  const items = rawItems
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      let id = typeof item.id === "string" && item.id.trim() !== "" ? item.id.trim() : "";
      if (!id || usedItemIds.has(id)) {
        id = createGroupItemsItemId(usedItemIds);
      }
      usedItemIds.add(id);
      const text = typeof item.text === "string" ? item.text : "";
      const imageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim() !== ""
        ? item.imageUrl
        : null;
      const rawGroupId = typeof item.groupId === "string" ? item.groupId : "";
      const groupId = groupIds.has(rawGroupId) ? rawGroupId : groups[0].id;
      return { id, text, imageUrl, groupId };
    })
    .filter((item): item is GroupItemsItemBody => item !== null);

  return items.length > 0 ? { groups, items } : createDefaultGroupItemsBody();
}

export function getShortTextBody(activity: LessonActivity): ShortTextBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "", modelAnswer: "" };
  }

  const record = activity.body_data as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : "";
  const modelAnswer = typeof record.modelAnswer === "string"
    ? record.modelAnswer
    : "";

  return {
    ...(record as Record<string, unknown>),
    question,
    modelAnswer,
  } as ShortTextBody;
}

export function getLongTextBody(activity: LessonActivity): LongTextBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "" };
  }

  const record = activity.body_data as Record<string, unknown>;
  const question = typeof record.question === "string"
    ? record.question
    : typeof record.text === "string"
    ? record.text
    : "";

  return {
    ...(record as Record<string, unknown>),
    question,
  } as LongTextBody;
}

export function getUploadSpreadsheetBody(activity: LessonActivity): UploadSpreadsheetActivityBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { task: "", markingGuidance: "" };
  }

  const record = activity.body_data as Record<string, unknown>;
  const task = typeof record.task === "string" ? record.task : "";
  const markingGuidance = typeof record.markingGuidance === "string"
    ? record.markingGuidance
    : "";

  return {
    ...(record as Record<string, unknown>),
    task,
    markingGuidance,
  } as UploadSpreadsheetActivityBody;
}

export function getUploadUrlBody(activity: LessonActivity): UploadUrlBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { question: "" };
  }

  const record = activity.body_data as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question : "";

  return {
    ...(record as Record<string, unknown>),
    question,
  } as UploadUrlBody;
}

export type {
  FeedbackActivityBody,
  FeedbackActivityGroupSettings,
} from "@/types";

export function getFeedbackBody(
  activity: LessonActivity,
): FeedbackActivityBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { groups: {} };
  }

  const record = activity.body_data as Record<string, unknown>;
  const { groups: rawGroups, ...rest } = record;
  const normalizedGroups: Record<string, FeedbackActivityGroupSettings> = {};

  if (rawGroups && typeof rawGroups === "object" && !Array.isArray(rawGroups)) {
    Object.entries(rawGroups as Record<string, unknown>).forEach(
      ([groupId, value]) => {
        const trimmedId = groupId.trim();
        if (!trimmedId) {
          return;
        }

        if (value && typeof value === "object") {
          const config = value as Record<string, unknown>;
          normalizedGroups[trimmedId] = {
            ...FEEDBACK_GROUP_DEFAULTS,
            isEnabled: config.isEnabled === true,
            showScore: config.showScore === true,
            showCorrectAnswers: config.showCorrectAnswers === true,
          };
        } else {
          normalizedGroups[trimmedId] = { ...FEEDBACK_GROUP_DEFAULTS };
        }
      },
    );
  }

  return {
    ...(rest as Record<string, unknown>),
    groups: normalizedGroups,
  } as FeedbackActivityBody;
}

export function getFlashcardsText(activity: LessonActivity): string {
  if (!activity.body_data || typeof activity.body_data !== "object") return ""
  const record = activity.body_data as Record<string, unknown>
  return typeof record.lines === "string" ? record.lines : ""
}

export function getRichTextMarkup(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    // Pre-process to unwrap HTML tags from the editor so markdown tables can be recognized
    // 1. Replace &nbsp; with space
    let cleaned = trimmed.replace(/&nbsp;/g, " ");

    // 2. Convert block-level tags (opening and closing) to newlines.
    //    Opening tags use \n so that content immediately after them starts on a new line
    //    (Chrome's contentEditable wraps subsequent lines in <div> with no preceding \n).
    cleaned = cleaned
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|p)>/gi, "\n")
      .replace(/<(div|p)[^>]*>/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Parse markdown (synchronous by default in newer marked versions,
    // but marked.parse can be async if extensions are used.
    // Usually it returns string if no async options are on).
    // We force it to be treated as string for safety or handle promise if needed.
    // Standard basic usage:
    const parsed = marked.parse(cleaned, { async: false, breaks: true }) as string;
    return parsed;
  } catch (error) {
    console.error("Failed to parse markdown:", error);
    // Fallback to basic escaping if markdown parsing fails
    return `<p>${escapeHtml(trimmed)}</p>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getYouTubeVideoId(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.slice(1) || null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments[0] === "embed" || segments[0] === "v") {
        return segments[1] ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function getYouTubeThumbnailUrl(
  url: string | null | undefined,
): string | null {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return null;
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export interface DisplaySectionBody {
  description: string;
}

export function getDisplaySectionBody(
  activity: LessonActivity,
): DisplaySectionBody {
  if (!activity.body_data || typeof activity.body_data !== "object") {
    return { description: "" };
  }
  const record = activity.body_data as Record<string, unknown>;
  const description = typeof record.description === "string"
    ? record.description
    : "";
  return { description };
}

export function computeSectionIndexMap(
  activities: LessonActivity[],
): Map<string, number> {
  const sorted = [...activities].sort(
    (a, b) => (a.order_by ?? 0) - (b.order_by ?? 0),
  );
  const map = new Map<string, number>();
  let index = 0;
  for (const activity of sorted) {
    if (activity.type === "display-section" && typeof activity.activity_id === "string") {
      index += 1;
      map.set(activity.activity_id, index);
    }
  }
  return map;
}
