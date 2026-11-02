"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./functions";
import { generateObjectWithFallback } from "./lib/aiModels";
import {
  NARRATION_VERSION,
  narrationPrompt,
  narrationSchema,
  narrationSource,
  validateNarration,
  validateNarrationInput,
} from "./lib/narration";
import { loadReaderAI } from "./lib/router";
import { providerObjectSchema } from "./lib/structuredOutput";
import { requireReaderLimit } from "./limits";

const RETRY = "This passage couldn't be prepared for listening. Retry.";
const ARTICLE = "This article isn't available for listening. Retry.";
const PLAN =
  "Listening preparation needs a capped AI model. Choose an API-key model for Quick tasks in Your account, then Retry.";
const KEY =
  "Listening preparation needs your own AI provider key. Add one in Your account, then Retry.";

export const prepare = action({
  args: {
    articleId: v.id("articles"),
    text: v.string(),
    kind: v.union(
      v.literal("prose"),
      v.literal("heading"),
      v.literal("list"),
      v.literal("table"),
      v.literal("code"),
      v.literal("image"),
    ),
    lang: v.optional(v.string()),
  },
  returns: v.object({ text: v.string(), version: v.string() }),
  handler: async (ctx, args): Promise<{ text: string; version: string }> => {
    const assertArticle = async () => {
      try {
        await ctx.runQuery(internal.speech.assertArticle, {
          articleId: args.articleId,
          userId: ctx.readerId,
        });
      } catch {
        throw new ConvexError(ARTICLE);
      }
    };
    // Authorization and input checks precede budgets, routing and key access.
    await assertArticle();
    let source: string;
    try {
      validateNarrationInput(args.text, args.lang);
      source = narrationSource(args.text, args.kind);
    } catch {
      throw new ConvexError(RETRY);
    }
    await requireReaderLimit(ctx, ctx.readerId, "speechPreparation");
    let text: string;
    try {
      const ai = await loadReaderAI(ctx, ctx.readerId, { roles: ["quick"] });
      const chain = ai.chain("quick");
      // Plan responses have no output cap. Never skip an explicitly selected
      // plan to spend an API key invisibly, even if its fallback has a cap.
      if (chain[0]?.provider === "chatgpt") throw new ConvexError(PLAN);
      const targets = chain.filter((target) => target.provider !== "chatgpt");
      if (!targets.length) throw new ConvexError(KEY);
      const result = await generateObjectWithFallback({
        schema: narrationSchema,
        providerSchemaForTarget: (modelId) =>
          providerObjectSchema(modelId, narrationSchema),
        ...narrationPrompt(source, args.kind, args.lang),
        targets: targets.slice(0, 2),
        maxParseAttempts: 1,
        maxOutputTokens: 1400,
        deadlineMs: 20_000,
        denyDataCollection: true,
      });
      // Revalidate even when a mocked or future generation helper skips parsing.
      text = validateNarration(source, result.object, args.kind);
    } catch (error) {
      // Only our fixed reader sentences may escape; upstream errors can contain
      // prompts, model prose and credentials. No raw-error/prose logging.
      if (
        error instanceof ConvexError &&
        (error.data === PLAN || error.data === KEY)
      )
        throw error;
      throw new ConvexError(RETRY);
    }
    await assertArticle();
    return { text, version: NARRATION_VERSION };
  },
});
