/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

it("includes only the article's owned feed and stops offering unsubscribe once removed", async () => {
  const f = await secondReaderTest(modules);
  const feedId = await f.owner.mutation(api.feeds.add, {
    title: "The Weekly Letter",
    url: "https://example.com/weekly.xml",
  });
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      feedId,
      guid: "source-fixture",
      url: "https://example.com/post",
      title: "A newsletter post",
      content: "Saved text",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    }),
  );
  expect(
    (await f.owner.query(api.readerBootstrap.get, { articleId }))?.feed,
  ).toEqual({ _id: feedId, title: "The Weekly Letter", isActive: true });
  expect(
    await f.reader.query(api.readerBootstrap.get, { articleId }),
  ).toBeNull();

  await f.owner.mutation(api.feeds.toggleActive, { feedId });
  expect(
    (await f.owner.query(api.readerBootstrap.get, { articleId }))?.feed,
  ).toMatchObject({ _id: feedId, isActive: false });

  // A mismatched relationship must not reveal another library's source.
  await f.t.run((ctx) => ctx.db.patch(feedId, { userId: f.readerLibraryId }));
  expect(
    (await f.owner.query(api.readerBootstrap.get, { articleId }))?.feed,
  ).toBeNull();
  await f.t.run((ctx) => ctx.db.patch(feedId, { userId: "default_user" }));

  await f.owner.mutation(api.feeds.remove, { feedId, articles: "keep" });
  const retained = await f.owner.query(api.readerBootstrap.get, { articleId });
  expect(retained?.article?.title).toBe("A newsletter post");
  expect(retained?.feed).toBeNull();
});

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
    feed: null,
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
