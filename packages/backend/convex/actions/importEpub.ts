"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { WORDS_PER_MINUTE } from "../lib/constants";
import { rasterType, replaceEpubImages } from "../lib/epub/images";
import { parseEpub } from "../lib/epub/parse";
import { excerptOf, fitsInStorage } from "../lib/importContent";

export const run = internalAction({
  args: { importId: v.id("documentImports") },
  handler: async (ctx, args): Promise<void> => {
    const row: Doc<"documentImports"> | null = await ctx.runMutation(
      internal.documentImports.claim,
      args,
    );
    if (!row || row.format !== "epub") return;
    let articleId: Id<"articles"> | null = null;
    try {
      const file = await ctx.storage.get(row.storageId);
      const parsed = file
        ? parseEpub(new Uint8Array(await file.arrayBuffer()))
        : null;
      if (!parsed?.ok) {
        await ctx.runMutation(internal.documentImports.fail, {
          importId: args.importId,
          failure: parsed?.reason ?? "unreadable",
        });
        return;
      }
      const book = parsed.value;
      const first = book.units[0];
      if (!first) {
        await ctx.runMutation(internal.documentImports.fail, {
          ...args,
          failure: "empty",
        });
        return;
      }
      const live: boolean = await ctx.runMutation(
        internal.documentImports.setProgress,
        {
          ...args,
          step: "sections",
          units: book.units.length,
        },
      );
      if (!live) return;
      const wordCount = book.units.reduce(
        (sum, unit) => sum + unit.wordCount,
        0,
      );
      const title = book.metadata.title.toWellFormed();
      const article = {
        ...args,
        userId: row.userId,
        guid: `upload:${args.importId}`,
        title,
        author: book.metadata.creators.join(", ").toWellFormed() || undefined,
        excerpt: excerptOf(first.content),
        fileName: row.fileName,
        wordCount,
        estimatedReadMinutes: Math.max(
          1,
          Math.ceil(wordCount / WORDS_PER_MINUTE),
        ),
        outline: book.units.map((unit) => ({
          title: unit.title,
          minutes: unit.estimatedReadMinutes,
        })),
      };
      if (new TextEncoder().encode(JSON.stringify(article)).length >= 900_000) {
        await ctx.runMutation(internal.documentImports.fail, {
          ...args,
          failure: "too_long",
        });
        return;
      }
      articleId = await ctx.runMutation(
        internal.books.createBookArticle,
        article,
      );
      if (!articleId) return;
      const urls = new Map<string, string>();
      for (const image of book.images) {
        const type = rasterType(image.bytes, image.mediaType);
        if (
          !type ||
          !book.units.some((unit) =>
            unit.contentHtml.includes(
              `data-epub-image="${encodeURIComponent(image.href)}"`,
            ),
          )
        )
          continue;
        const storageId = await ctx.storage.store(
          new Blob([Uint8Array.from(image.bytes)], { type }),
        );
        const url: string | null = await ctx.runMutation(
          internal.bookImages.register,
          {
            ...args,
            articleId,
            storageId,
            href: image.href,
          },
        );
        if (!url) {
          await ctx.storage.delete(storageId);
          await ctx.runMutation(internal.books.discardBook, {
            ...args,
            userId: row.userId,
            articleId,
          });
          return;
        }
        urls.set(image.href, url);
      }
      for (let at = 0; at < book.units.length; at += 1) {
        const units = book.units.slice(at, at + 1).map((unit, index) => ({
          ...unit,
          index: at + index,
          sourceSpans: [...unit.sourceSpans],
          contentHtml: replaceEpubImages(unit.contentHtml, urls),
        }));
        if (
          units.some(
            (unit) => !fitsInStorage(unit.contentHtml, unit.content),
          ) ||
          new TextEncoder().encode(JSON.stringify(units)).length >= 950_000
        ) {
          await ctx.runMutation(internal.documentImports.fail, {
            ...args,
            failure: "too_long",
          });
          return;
        }
        const written: boolean = await ctx.runMutation(
          internal.books.addUnits,
          {
            ...args,
            userId: row.userId,
            articleId,
            units,
          },
        );
        if (!written) {
          await ctx.runMutation(internal.books.discardBook, {
            ...args,
            userId: row.userId,
            articleId,
          });
          return;
        }
      }
      const finished: boolean = await ctx.runMutation(
        internal.books.finishBook,
        {
          ...args,
          userId: row.userId,
          articleId,
          title,
          units: book.units.length,
          firstUnitTitle: first.title,
          firstUnitMinutes: first.estimatedReadMinutes,
        },
      );
      if (!finished)
        await ctx.runMutation(internal.books.discardBook, {
          ...args,
          userId: row.userId,
          articleId,
        });
    } catch {
      await ctx.runMutation(internal.documentImports.fail, {
        ...args,
        failure: "unreadable",
      });
      if (articleId)
        await ctx.runMutation(internal.books.discardBook, {
          ...args,
          userId: row.userId,
          articleId,
        });
    }
  },
});
