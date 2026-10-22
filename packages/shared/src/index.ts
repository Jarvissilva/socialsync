import { z } from "zod";

export const platformSchema = z.enum([
  "instagram",
  "facebook",
  "pinterest",
  "youtube",
]);
export type Platform = z.infer<typeof platformSchema>;
export const platforms = platformSchema.options;
export const platformNames: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
  youtube: "YouTube",
};
// Authorization providers are distinct from publishing destinations.
export const providerSchema = z.enum([
  "meta",
  "instagram",
  "facebook",
  "pinterest",
  "youtube",
]);
export type Provider = z.infer<typeof providerSchema>;
export const connectionProviders = ["meta", "pinterest", "youtube"] as const;
export const providerNames: Record<Provider, string> = {
  meta: "Facebook & Instagram",
  facebook: "Facebook",
  instagram: "Instagram",
  pinterest: "Pinterest",
  youtube: "YouTube",
};
export const formatSchema = z.enum([
  "text",
  "image",
  "carousel",
  "video",
  "reel",
  "story",
  "pin",
  "short",
]);
export type Format = z.infer<typeof formatSchema>;
export const formats: Record<Platform, Format[]> = {
  instagram: ["image", "carousel", "reel", "story"],
  facebook: ["text", "image", "carousel", "video", "reel", "story"],
  pinterest: ["pin", "video"],
  youtube: ["video", "short"],
};
export const idSchema = z.uuid();
export const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Choose a valid IANA time zone.");
export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: timeZoneSchema.default("Asia/Kolkata"),
});
export const projectSchema = projectInputSchema.extend({
  id: idSchema,
  createdAt: z.string(),
  accountCount: z.number(),
  scheduledCount: z.number(),
});
export type Project = z.infer<typeof projectSchema>;
export const accountSchema = z.object({
  provider: providerSchema,
  id: idSchema,
  platform: platformSchema,
  externalId: z.string(),
  name: z.string(),
  username: z.string(),
  status: z.enum(["connected", "disconnected", "expired"]),
  projectIds: z.array(idSchema),
  capabilities: z.array(formatSchema),
  createdAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;
export const mediaSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
});
export type Media = z.infer<typeof mediaSchema>;
export const targetInputSchema = z.object({
  accountId: idSchema,
  format: formatSchema,
  caption: z.string().max(63000).default(""),
  title: z.string().max(100).default(""),
  boardId: z.string().max(200).default(""),
  link: z.union([z.literal(""), z.url()]).default(""),
  privacy: z.enum(["public", "unlisted", "private"]).default("public"),
  madeForKids: z.boolean().default(false),
});
export type TargetInput = z.infer<typeof targetInputSchema>;
export const postInputSchema = z.object({
  title: z.string().trim().max(100).default(""),
  caption: z.string().max(63000).default(""),
  mediaIds: z.array(idSchema).max(20).default([]),
  targets: z.array(targetInputSchema).max(30).default([]),
});
export type PostInput = z.infer<typeof postInputSchema>;
export const jobStatusSchema = z.enum([
  "scheduled",
  "processing",
  "published",
  "failed",
  "needs_attention",
  "cancelled",
  "paused",
]);
export const targetSchema = targetInputSchema.extend({
  id: idSchema,
  platform: platformSchema,
  accountName: z.string(),
  status: jobStatusSchema,
  error: z.string().nullable(),
  remoteId: z.string().nullable(),
  url: z.string().nullable(),
  attempts: z.number(),
});
export const postSchema = postInputSchema.omit({ targets: true }).extend({
  id: idSchema,
  projectId: idSchema,
  state: z.enum([
    "draft",
    "scheduled",
    "processing",
    "published",
    "partial",
    "failed",
    "needs_attention",
    "cancelled",
    "paused",
  ]),
  scheduledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  targets: z.array(targetSchema),
});
export type Post = z.infer<typeof postSchema>;
export const providerStatusSchema = z.object({
  provider: providerSchema,
  configured: z.boolean(),
  missing: z.array(z.string()),
});
export const healthSchema = z.object({
  ok: z.boolean(),
  workerOnline: z.boolean(),
  publicMediaReady: z.boolean(),
});
export const connectInputSchema = z.object({
  projectId: idSchema.optional(),
  reconnectAccountId: idSchema.optional(),
});
export const candidateSchema = z.object({
  platform: platformSchema,
  externalId: z.string(),
  name: z.string(),
  username: z.string(),
  capabilities: z.array(formatSchema),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const discoverySchema = z.object({
  id: idSchema,
  provider: providerSchema,
  projectId: idSchema.nullable(),
  candidates: z.array(candidateSchema),
});
export const scheduleSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    immediate: z.boolean().default(false),
  })
  .refine(
    (v) => v.immediate || Boolean(v.scheduledAt),
    "Choose a publishing time.",
  );
export function validateContent(
  platform: Platform,
  target: TargetInput,
  media: Pick<Media, "mime" | "size">[],
  caption: string,
): string[] {
  const errors: string[] = [];
  if (!formats[platform].includes(target.format))
    errors.push("This format is not supported by this platform.");
  const text = target.caption || caption;
  const video = media.filter((m) => m.mime.startsWith("video/"));
  const images = media.filter((m) => m.mime.startsWith("image/"));
  if (target.format === "text" && !text.trim() && !target.link)
    errors.push("Add text or a link.");
  if (target.format === "text" && media.length)
    errors.push(
      "Choose a media format or remove the attached media for a text/link post.",
    );
  if (platform === "facebook" && target.format !== "text" && target.link)
    errors.push(
      "Facebook link attachments require the text format. Include the URL in your caption for media posts.",
    );
  if (target.format !== "text" && media.length === 0)
    errors.push("Add media for this format.");
  if (
    ["video", "reel", "short"].includes(target.format) &&
    (video.length !== 1 || media.length !== 1)
  )
    errors.push("Select exactly one video.");
  if (target.format === "image" && (images.length !== 1 || media.length !== 1))
    errors.push("Select exactly one image.");
  if (target.format === "pin" && (images.length !== 1 || media.length !== 1))
    errors.push("An image Pin requires exactly one image.");
  if (
    target.format === "carousel" &&
    (media.length < 2 || media.length > (platform === "instagram" ? 10 : 20))
  )
    errors.push(
      "Select between 2 and " +
        (platform === "instagram" ? 10 : 20) +
        " media items.",
    );
  if (platform === "facebook" && target.format === "carousel" && video.length)
    errors.push("Facebook multi-photo posts require images.");
  if (target.format === "story" && media.length !== 1)
    errors.push("A Story requires exactly one media item.");
  if (platform === "pinterest" && !target.boardId)
    errors.push("Select a Pinterest board.");
  if (platform === "youtube" && !target.title.trim())
    errors.push("Add a YouTube video title.");
  if (platform === "instagram" && text.length > 2200)
    errors.push("Instagram captions must be at most 2,200 characters.");
  if (platform === "pinterest" && text.length > 800)
    errors.push("Pinterest descriptions must be at most 800 characters.");
  if (platform === "youtube" && new TextEncoder().encode(text).length > 5000)
    errors.push("YouTube descriptions must be at most 5,000 bytes.");
  if (platform === "instagram" && images.some((m) => m.mime !== "image/jpeg"))
    errors.push("Instagram images must be JPEG.");
  return errors;
}
