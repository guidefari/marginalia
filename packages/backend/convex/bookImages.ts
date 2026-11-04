import { v } from "convex/values";
import { internal } from "./_generated/api";
import { deleteFile, liveImport } from "./documentImports";
import { internalMutation, type MutationCtx } from "./functions";

export const register = internalMutation({
  args: {
    importId: v.id("documentImports"),
    articleId: v.id("articles"),
    storageId: v.id("_storage"),
    href: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await liveImport(ctx, args.importId);
    const article = await ctx.db.get(args.articleId);
    if (
      !row ||
      row.partialArticleId !== args.articleId ||
      article?.userId !== row.userId ||
      article.extractionStatus !== "pending"
    )
      return null;
    const existing = await ctx.db
      .query("bookImages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const upload = await ctx.db
      .query("documentImports")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    const file = await ctx.db.system.get(args.storageId);
    if (
      existing ||
      upload ||
      !file ||
      (file.contentType !== undefined &&
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.contentType,
        ))
    )
      return null;
    await ctx.db.insert("bookImages", {
      userId: row.userId,
      articleId: args.articleId,
      storageId: args.storageId,
      href: args.href,
    });
    return ctx.storage.getUrl(args.storageId);
  },
});

export async function purgeImages(ctx: MutationCtx, userId: string) {
  const images = await ctx.db
    .query("bookImages")
    .withIndex("by_userId_and_articleId", (q) => q.eq("userId", userId))
    .take(50);
  for (const image of images) {
    await deleteFile(ctx, image.storageId);
    await ctx.db.delete(image._id);
  }
  return images.length;
}

export const discard = internalMutation({
  args: { userId: v.string(), articleId: v.id("articles") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.articleId)) return;
    const images = await ctx.db
      .query("bookImages")
      .withIndex("by_userId_and_articleId", (q) =>
        q.eq("userId", args.userId).eq("articleId", args.articleId),
      )
      .take(50);
    for (const image of images) {
      await deleteFile(ctx, image.storageId);
      await ctx.db.delete(image._id);
    }
    if (images.length === 50)
      await ctx.scheduler.runAfter(0, internal.bookImages.discard, args);
  },
});
