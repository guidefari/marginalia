export type EpubFailure =
  | "not_epub"
  | "protected"
  | "empty"
  | "too_long"
  | "unreadable";

export type EpubResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: EpubFailure };

export type ManifestItem = {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
};

export type EpubPackage = {
  readonly title: string;
  readonly creators: readonly string[];
  readonly identifier: string | undefined;
  readonly language: string | undefined;
  readonly manifest: readonly ManifestItem[];
  readonly spine: readonly ManifestItem[];
  readonly ncxId: string | undefined;
};

export type SourceSpan = {
  readonly spineIndex: number;
  readonly start: number;
  readonly end: number;
};

export type EpubBlock = {
  readonly html: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export type EpubSpineItem = {
  readonly href: string;
  readonly xhtml: string;
  readonly title: string;
  readonly text: string;
  readonly blocks: readonly EpubBlock[];
};

export type EpubUnit = {
  readonly title: string;
  readonly content: string;
  readonly contentHtml: string;
  readonly wordCount: number;
  readonly estimatedReadMinutes: number;
  readonly sourceSpans: readonly SourceSpan[];
};

export type EpubOutlineEntry = {
  readonly title: string;
  readonly href: string;
  readonly depth: number;
};

export type ParsedEpub = {
  readonly metadata: Omit<EpubPackage, "manifest" | "spine" | "ncxId">;
  readonly manifest: readonly ManifestItem[];
  readonly images: readonly {
    readonly href: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }[];
  readonly spine: readonly EpubSpineItem[];
  readonly outline: readonly EpubOutlineEntry[];
  readonly units: readonly EpubUnit[];
};
