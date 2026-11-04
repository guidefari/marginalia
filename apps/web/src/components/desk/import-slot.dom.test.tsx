// @vitest-environment happy-dom

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { convexTest } from "convex-test";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberedTitle } from "@/lib/title-handoff";
import schema from "../../../../../packages/backend/convex/schema";
import { ImportView } from "./import-slot";

type Latest = NonNullable<ComponentProps<typeof ImportView>["latest"]>;
let ready: Latest;
let failed: Latest;

let root: Root;
let client: ConvexReactClient;
const navigations: string[] = [];
const dismissals: string[] = [];
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push(href) {
    navigations.push(href);
  },
  replace() {},
  prefetch() {},
  bfcacheId: "desk",
};
const view = (latest: Latest, autoOpen: boolean) =>
  act(() =>
    root.render(
      <ConvexProvider client={client}>
        <AppRouterContext.Provider value={router}>
          <ImportView
            latest={latest}
            autoOpen={autoOpen}
            upload={null}
            problem={null}
            onFile={() => {}}
            onClearProblem={() => {}}
            onDismiss={(id) => dismissals.push(id)}
          >
            <p>resting</p>
          </ImportView>
        </AppRouterContext.Provider>
      </ConvexProvider>,
    ),
  );

beforeEach(async () => {
  navigations.length = 0;
  dismissals.length = 0;
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  const ids = await t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId: "reader",
      guid: "book",
      url: "https://example.com/book",
      title: "On Cows",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["%PDF-"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName: "book.pdf",
      status: "ready",
      step: "point",
      createdAt: 0,
      updatedAt: 0,
    });
    return { articleId, importId };
  });
  ready = {
    _id: ids.importId,
    fileName: "book.pdf",
    status: "ready",
    step: "point",
    articleId: ids.articleId,
    title: "On Cows",
    pages: 12,
    minutes: 9,
    units: undefined,
    firstUnitTitle: undefined,
    firstUnitMinutes: undefined,
    failure: undefined,
  };
  failed = { ...ready, status: "failed", step: "text", failure: "scanned" };
  client = new ConvexReactClient("https://fixture.convex.cloud");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  act(() => root.unmount());
  await client.close();
  document.body.innerHTML = "";
});

describe("an imported PDF that becomes readable", () => {
  it("opens the reader straight away when the reader is still waiting on the desk", () => {
    view(ready, true);
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
    expect(rememberedTitle(String(ready.articleId))).toBe("On Cows");
    expect(dismissals).toEqual([ready._id]);
  });

  it("opens only once however often the desk re-renders", () => {
    view(ready, true);
    view({ ...ready }, true);
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
  });

  it("stays at the Ready card when the reader has moved on", () => {
    view(ready, false);
    expect(navigations).toEqual([]);
    expect(document.body.textContent).toContain("Ready to read");
    expect(document.body.textContent).toContain("Start reading");
  });

  it("leaves a scanned refusal in place and opens nothing", () => {
    view(failed, true);
    expect(navigations).toEqual([]);
    expect(document.body.textContent).toContain(
      "This PDF is scanned pages, with no text to read.",
    );
  });

  it.each([
    ["protected", "This file is protected and can't be read."],
    ["not_epub", "This file isn't a valid EPUB."],
  ] satisfies ReadonlyArray<
    readonly [NonNullable<Latest["failure"]>, string]
  >)("renders the %s refusal safely for a legacy row", (failure, sentence) => {
    view({ ...failed, failure }, true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      sentence,
    );
    expect(document.body.textContent).toContain(
      "Nothing was added to your library.",
    );
    expect(navigations).toEqual([]);
  });

  it("keeps the unreadable fallback when no failure is present", () => {
    view({ ...failed, failure: undefined }, false);
    expect(document.body.textContent).toContain(
      "Marginalia couldn't open this PDF.",
    );
  });

  it("still shows explicitly tagged PDFs", () => {
    view({ ...ready, format: "pdf" }, false);
    expect(document.body.textContent).toContain("Ready to read");
    expect(document.body.textContent).toContain("On Cows");
  });

  it.each(["reading", "failed", "ready"] satisfies ReadonlyArray<
    Latest["status"]
  >)("excludes a %s EPUB even while auto-open is armed", (status) => {
    view(
      {
        ...ready,
        format: "epub",
        fileName: "book.epub",
        status,
        failure: "protected",
      },
      true,
    );
    expect(document.body.textContent).toBe("resting");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    expect(navigations).toEqual([]);
    expect(dismissals).toEqual([]);
  });
});
