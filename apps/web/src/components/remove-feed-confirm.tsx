"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { confirmControl, quietControl } from "./settings-controls";

type Choice = "keep" | "unread" | "all";

const plural = (n: number, partial: boolean) =>
  `${n}${partial ? "+" : ""} article${n === 1 && !partial ? "" : "s"}`;

const alsoInReader = (n: number) =>
  n ? `, ${n} of them also from Readwise Reader` : "";

/**
 * Asks what happens to a feed's articles before unsubscribing, in place under
 * its row. Keep closes it without changing anything.
 */
export function RemoveFeedConfirm({
  feed,
  onClose,
  onRemovingChange,
}: {
  feed: { _id: Id<"feeds">; title: string };
  onClose: () => void;
  onRemovingChange?: (removing: boolean) => void;
}) {
  const preview = useQuery(api.feeds.removalPreview, { feedId: feed._id });
  const removeFeed = useMutation(api.feeds.remove);
  const [choice, setChoice] = useState<Choice>("keep");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  const partial = preview?.partial ?? false;
  const options: { value: Choice; label: string; detail: string }[] = [
    {
      value: "keep",
      label: "Keep its articles",
      detail: preview
        ? `${plural(preview.total, partial)} stay in your library.`
        : "Everything already imported stays in your library.",
    },
    {
      value: "unread",
      label: "Remove the ones I haven't opened",
      detail: preview
        ? `Removes ${plural(preview.unread, partial)}${alsoInReader(preview.unreadInReader)}. Anything you've opened, saved, loved or marked stays.`
        : "Anything you've opened, saved, loved or marked stays.",
    },
    {
      value: "all",
      label: "Remove all its articles",
      detail: preview
        ? `Removes ${plural(preview.all, partial)}${alsoInReader(preview.allInReader)}. Articles with your highlights or notes stay.`
        : "Articles with your highlights or notes stay.",
    },
  ];

  const confirm = async () => {
    setRemoving(true);
    onRemovingChange?.(true);
    setError("");
    try {
      await removeFeed({ feedId: feed._id, articles: choice });
      toast.success(
        choice === "keep"
          ? `Unsubscribed from ${feed.title}`
          : `Unsubscribed from ${feed.title}. Removing its articles…`,
      );
      onClose();
    } catch {
      setError("Couldn't remove the feed. Try again.");
      setRemoving(false);
    } finally {
      onRemovingChange?.(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 border-b border-[var(--reader-border)] py-3 text-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !removing) onClose();
      }}
    >
      <p className="text-sm">
        <span className="font-medium">Remove this feed?</span>{" "}
        <span className="text-[var(--reader-muted)]">
          No new posts will arrive. What should happen to the ones already here?
        </span>
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Its articles</legend>
        {options.map((option) => (
          <label key={option.value} className="flex gap-3 text-sm">
            <input
              type="radio"
              name="feed-articles"
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="mt-1 accent-[var(--reader-fg)]"
            />
            <span>
              <span className="block">{option.label}</span>
              <span className="block text-xs text-[var(--reader-muted)]">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={removing}
          className={confirmControl}
        >
          {removing ? "Removing…" : "Remove"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={removing}
          className={quietControl}
        >
          Keep
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
