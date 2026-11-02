/**
 * Whether a keydown Escape in the reader should go back to the origin room.
 * Escape belongs to whatever is open first: menus and popovers, margin notes,
 * the notes pane, text fields, a live selection and the passage menu.
 */

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const OPEN_OVERLAY = [
  "[role=menu]",
  "[role=listbox]",
  "[role=dialog]",
  "[data-reader-overlay]",
  "dialog[open]",
  "[aria-modal='true']",
  "[data-radix-popper-content-wrapper]",
  "[role=toolbar][aria-label='Passage actions']",
].join(",");

export interface EscapeEvent {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

export interface EscapeState {
  /** The reader has something of its own open: a margin note, a companion answer, the notes pane or Ask. */
  readerPanelOpen: boolean;
  /** A text selection is live, so Escape belongs to the passage menu. */
  selectionActive: boolean;
}

export function escapeGoesBack(
  event: EscapeEvent,
  state: EscapeState,
  doc: Document,
): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return false;
  if (state.readerPanelOpen || state.selectionActive) return false;
  if (doc.querySelector(OPEN_OVERLAY)) return false;
  if (event.target instanceof Element && event.target.closest(EDITABLE))
    return false;
  return true;
}
