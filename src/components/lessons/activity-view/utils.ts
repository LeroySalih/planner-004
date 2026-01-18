import type {
  FeedbackActivityBody,
  FeedbackActivityGroupSettings,
  LessonActivity,
  LongTextActivityBody,
  ShortTextActivityBody,
  UploadUrlActivityBody,
} from "@/types";

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

export function getRichTextMarkup(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed;
  }

  const escaped = escapeHtml(trimmed);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, "<br />"))
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");

  return paragraphs || `<p>${escaped}</p>`;
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
