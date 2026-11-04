// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentDrop } from "./document-drop";

let root: Root;
const onFile = vi.fn();

beforeEach(() => {
  onFile.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<DocumentDrop onFile={onFile} />));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const drag = (type: string, files: File[] = [], withFiles = true) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: withFiles ? ["Files"] : ["text/plain"], files },
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};
const pdf = new File(["%PDF-"], "book.pdf", { type: "application/pdf" });

describe("dropping a document on the desk", () => {
  it("takes the first EPUB from a mixed drop without skipping to a later PDF", () => {
    const epub = new File(["book"], "Book.EPUB");
    const png = new File(["image"], "cover.png", { type: "image/png" });
    drag("dragenter", [png, epub, pdf]);
    drag("drop", [png, epub, pdf]);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(epub);
    expect(document.body.textContent).not.toContain("Drop to read");
  });
  it("shows one calm target while a file is dragged over", () => {
    expect(document.body.textContent).not.toContain("Drop to read");
    drag("dragenter", [pdf]);
    expect(document.body.textContent).toContain("Drop to read");
    expect(document.body.textContent).toContain(
      "Add a PDF or EPUB to your library",
    );
  });

  it("ignores text or a link dragged across the page", () => {
    drag("dragenter", [], false);
    expect(document.body.textContent).not.toContain("Drop to read");
  });

  it("hands the PDF on when it is dropped, and hides the target", () => {
    drag("dragenter", [pdf]);
    const event = drag("drop", [pdf]);
    expect(onFile).toHaveBeenCalledWith(pdf);
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).not.toContain("Drop to read");
  });

  it("hides the target when the drag leaves the page", () => {
    drag("dragenter", [pdf]);
    drag("dragenter", [pdf]);
    drag("dragleave", [pdf]);
    expect(document.body.textContent).toContain("Drop to read");
    drag("dragleave", [pdf]);
    expect(document.body.textContent).not.toContain("Drop to read");
  });

  it("passes on a file that is not a PDF, so the import can say so", () => {
    const png = new File(["x"], "a.png", { type: "image/png" });
    drag("dragenter", [png]);
    drag("drop", [png]);
    expect(onFile).toHaveBeenCalledWith(png);
  });
});
