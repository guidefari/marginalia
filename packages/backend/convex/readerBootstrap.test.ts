/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
it("preserves authoritative saved text/HTML while excluding vectors and operational fields from the additive DTO", async () => {
  const f = await secondReaderTest(modules);
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "lean-fixture",
      url: "https://example.com/lean",
      title: "Saved extraction",
      content: "Saved text",
      contentHtml: "<p>Saved <em>HTML</em></p>",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      annotationRetries: 2,
      marginaliaSources: ["note:fixture:1"],
      embedding: Array.from({ length: 1536 }, () => 0.1),
      createdAt: Date.now(),
    }),
  );
  await f.owner.mutation(api.readingPages.initializeDay, {
    timeZone: "America/New_York",
  });
  const lean = await f.owner.query(api.readerBootstrap.get, { articleId });
  expect(lean).toMatchObject({
    readingTimeZone: "America/New_York",
    isBook: false,
    unitIndex: null,
    article: {
      content: "Saved text",
      contentHtml: "<p>Saved <em>HTML</em></p>",
    },
  });
  for (const key of [
    "embedding",
    "marginaliaSources",
    "annotationRetries",
    "userId",
    "guid",
  ])
    expect(lean?.article).not.toHaveProperty(key);
  expect(
    await f.owner.query(api.articles.getById, { articleId }),
  ).toHaveProperty("embedding");
  expect(
    await f.reader.query(api.readerBootstrap.get, { articleId }),
  ).toBeNull();
});
