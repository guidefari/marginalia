import { emitCommand } from "./shortcuts";

let pending = false;

/** Keep a Search tap until the lazy desk can receive it. Page memory only. */
export function requestFinder() {
  pending = true;
  emitCommand("open-finder");
}

export function consumeFinderRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}
