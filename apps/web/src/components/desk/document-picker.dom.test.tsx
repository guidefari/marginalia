// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentPickerButton } from "./document-picker";

let root: Root;
let files: File[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  files = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root.render(
      <DocumentPickerButton onFile={(file) => files.push(file)}>
        Choose a file
      </DocumentPickerButton>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("offers both formats and delivers repeat selections of the same EPUB", () => {
  const input = document.querySelector("input");
  if (!input) throw new Error("Missing file picker");
  expect(input.accept).toBe("application/pdf,.pdf,application/epub+zip,.epub");
  const file = new File(["book"], "book.epub", {
    type: "application/epub+zip",
  });
  Object.defineProperty(input, "files", { value: [file] });
  for (let i = 0; i < 2; i++) {
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(input.value).toBe("");
  }
  expect(files).toEqual([file, file]);
});

it("ignores a cancelled selection", () => {
  const input = document.querySelector("input");
  if (!input) throw new Error("Missing file picker");
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(files).toEqual([]);
});
