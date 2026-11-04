import { ConvexError, v } from "convex/values";
import { mutation, query } from "./functions";
import {
  availableModels,
  MODEL_ROLES,
  type ModelRole,
  selectModel,
} from "./lib/providers";
import {
  readerProviders,
  savedModelChoices,
  settingsField,
  settingsRow,
} from "./lib/readerAI";
import {
  findSpeechVoice,
  resolveSpeechVoice,
  SPEECH_VOICES,
} from "./lib/speechVoices";

const role = v.union(
  v.literal("annotations"),
  v.literal("quick"),
  v.literal("deep"),
);

/**
 * The reader's model per role, from the models their own keys reach. A choice
 * whose key was removed falls back to a default; null means no key at all.
 */
export const getModels = query({
  args: {},
  returns: v.object({
    selected: v.object({
      annotations: v.union(v.string(), v.null()),
      quick: v.union(v.string(), v.null()),
      deep: v.union(v.string(), v.null()),
    }),
    available: v.array(
      v.object({ id: v.string(), name: v.string(), provider: v.string() }),
    ),
  }),
  handler: async (ctx) => {
    const { providers, chatgptModels } = await readerProviders(
      ctx,
      ctx.readerId,
    );
    const chosen = await savedModelChoices(ctx, ctx.readerId);
    const selected = Object.fromEntries(
      MODEL_ROLES.map((r) => [
        r,
        selectModel(chosen[r], r, providers, chatgptModels)?.id ?? null,
      ]),
    ) as Record<ModelRole, string | null>;
    return {
      selected,
      available: availableModels(providers, chatgptModels).map(
        ({ id, name, provider }) => ({
          id,
          name,
          provider,
        }),
      ),
    };
  },
});

export const setModel = mutation({
  args: { role, model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { providers, chatgptModels } = await readerProviders(
      ctx,
      ctx.readerId,
    );
    if (
      !availableModels(providers, chatgptModels).some(
        (m) => m.id === args.model,
      )
    )
      throw new ConvexError(
        "That model isn't available with your saved keys. Add its provider in Your account.",
      );
    const row = await settingsRow(ctx, ctx.readerId);
    const patch = {
      [settingsField(args.role)]: args.model,
      updatedAt: Date.now(),
    };
    if (row) {
      await ctx.db.patch("userSettings", row._id, patch);
    } else {
      await ctx.db.insert("userSettings", {
        userId: ctx.readerId,
        ...patch,
      });
    }
    return null;
  },
});

/** The voice Listen reads in, and the voices the reader can choose from. */
export const getSpeechVoice = query({
  args: {},
  returns: v.object({
    selected: v.string(),
    voices: v.array(
      v.object({ id: v.string(), name: v.string(), character: v.string() }),
    ),
  }),
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.readerId);
    return {
      selected: resolveSpeechVoice(row?.speechVoice).id,
      voices: SPEECH_VOICES.map(({ id, name, character }) => ({
        id,
        name,
        character,
      })),
    };
  },
});

export const setSpeechVoice = mutation({
  args: { voice: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!findSpeechVoice(args.voice))
      throw new ConvexError("That voice isn't available.");
    const row = await settingsRow(ctx, ctx.readerId);
    const patch = { speechVoice: args.voice, updatedAt: Date.now() };
    if (row) await ctx.db.patch("userSettings", row._id, patch);
    else
      await ctx.db.insert("userSettings", { userId: ctx.readerId, ...patch });
    return null;
  },
});
