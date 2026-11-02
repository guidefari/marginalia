import { expect, it, vi } from "vitest";
import { createFollower } from "./listen-follow";

it("can be created during server rendering without reading browser globals", () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  try {
    expect(() => createFollower(() => {})).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
