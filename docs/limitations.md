# Known limitations

These remain after the polish pass. They are not reasons to replace settled UI decisions or silently migrate the user's data.

## Resolve before a confidential or multi-user release

- **Credential verification pending:** owner-only authentication is deployed, anonymous access is denied, and the owner confirmed library access and passkey enrollment. Passkey sign-in after sign-out, authenticator enrollment, token refresh and phone/PWA sign-in still need testing. Follow the [account verification steps](operations.md#roll-out-owner-authentication).
- **AI quotas:** authentication blocks anonymous requests, but there is no owner spending quota. Authorized reading, re-annotation, sync and companion requests can still incur provider spend. Saving a key also starts a paced [catch-up](operations.md#catching-up-after-a-key-is-saved) of work skipped without one, which spends on that reader's key.
- **Older skipped articles:** articles skipped for lack of a key before skip reasons were recorded aren't caught up automatically; use **Re-annotate** on each.
- **Shared dev/live backend:** the existing production web app uses a Convex development deployment also used locally. Separate it with an explicit backup/migration plan.
- **External providers:** articles, selections, stored context and indexed notes may be sent to OpenRouter/model providers. Readwise receives linked reading/highlight changes. Consent/retention policy has not been formalized.

See [operations](operations.md#access-control) before deploying sensitive content. None of these is fixed by hiding the frontend URL.

## Reliability and scale

- **Deep Study model compatibility:** the ChatGPT-plan deep model currently fails before evidence retrieval with `model_output_limit_unavailable` because its adapter cannot enforce the output cap. Configure a compatible API deep model and select the passage again. Automated checks and independent review do not replace the signed-in [release checks](operations.md#deploy).
- **Study evidence:** pinned datasets and retrieved citations are shown with their limits, but source validation cannot certify every free-form claim. Deep Study uses one adapted study-note corpus and bounded original-language and printed-edition samples; it does not establish broad scholarly consensus or English-to-original-language alignment.
- **Study cancellation and cost:** closing a pending run fences publication and further retrieval after admission/cancellation acknowledgement. A model request already dispatched cannot be recalled and may still incur provider cost.

- Notes have in-memory retry and a best-effort tab-close warning, not an offline outbox or durable local draft backup. Navigation away from the reader can still lose unsaved text.
- PWA installation adds a standalone launcher and an offline fallback, not downloaded articles, offline writes or background sync. Physical phone installation, native text selection and resume/keyboard behaviour still need device checks; see [the phone guide](mobile-and-pwa.md).
- iPhone touch feedback uses a deployed best-effort Safari native-switch fallback, not a general vibration API. It still needs a physical-phone check; simulated switch toggles cannot prove the device produced a tap.
- Some collections are bounded recent views. Reading reports cap each input dataset at 5,001 rows and explicitly label partial totals, with the 25 most recent articles shown. There is no full pagination/large-library performance contract yet.
- Reader sync checks all pages of Inbox, Later and Shortlist with leased/resumable pacing. Archive is only checked for documents updated since the last sync, to mark matching articles as read; archived documents are never imported. Feed, unsupported formats, missing text and oversized documents remain excluded; it is not a complete mirror of Reader.
- Active reading estimates do not measure comprehension. Historical unrecorded time cannot be reconstructed. Checkpoint retries retain at most 64 visit/day snapshots in local storage; cleared, unavailable or full storage can lose unsent activity. Notes do not use that outbox.
- Natural Listen voices need the reader's own OpenRouter key and work paragraph by paragraph. They do not always say units and abbreviations the way a person would (Kokoro spells out "km" and "bn" letter by letter), and a clip can fail on a slow or unavailable provider. The device voice is a separate choice, and its voices and availability vary by device. Publisher extraction and AI provider availability vary too. A saved URL does not guarantee successful article extraction.
- Vault indexing excludes some paths and files over 100KB, may omit small multi-section content and does not split huge single paragraphs. Empty notes do not clear a prior nonempty index. Hashes track file content, so chunker/model changes require an explicit reindex strategy.
- The vault removal list is derived from eligible local files, not a separate explicit deletion manifest. Always dry-run, especially when switching paths or scanner rules.

Verify changes with [development](development.md#make-a-safe-change); do not use personal content as a disposable fixture.

## EPUB backend import, not deployed

- The backend import path exists locally, but the desk picker/drop flow remains PDF-only. EPUB import events are excluded from that slot until the format-aware UI ships. Token book-upload endpoints and the Apple Books CLI are not implemented.
- DRM-protected publications are refused. Publisher scripts, styles, remote images and embedded active content are not enabled. Meaningful publisher layout, semantic footnotes, covers and annotation placement remain separate work.
- Parser ceilings are 32 MiB of ZIP input, 64 MiB total expanded data, 8 MiB per archive entry, and 2,000 spine items/units. Unpacked-map input uses the expanded-byte ceilings, not the ZIP-byte ceiling. These are implementation safeguards, not approved production account/storage allowances.
- Supported raster resources become owned storage URLs; missing, unsupported or refused resources fall back to escaped alt text. AVIF is not stored by this import path. Image checks do not promise full decoder validation or safe dimensions on every browser.
- Source ranges describe normalized spine text. They do not yet resolve Apple Books CFIs or guarantee browser paragraph/fragment navigation. The source EPUB is removed after successful import, as with the PDF upload lifecycle; later source-location recovery needs its own reviewed contract.
- Automated tests use local Convex test/storage seams. They do not prove native production action scheduling, provider behavior or browser reading fidelity. No backend deployment or private-book cloud upload is part of this work.

## Tooling and verification

- There is no CI: checks run locally before a push.
- React Doctor reports legacy patterns elsewhere in the reader, plus non-blocking warnings in changed files. The pass removes reported changed-file errors and adds regression coverage rather than rewriting every hook; see [verification](verification.md).
- Next/Turbopack may emit parser warnings for valid `::highlight(...)` CSS. Keep browser verification of saved marks; do not replace the selectors with invalid pseudo-classes to silence a warning.
- There is no browser end-to-end suite in CI. Component/static markup tests and pure/mutation tests do not prove focus/layout across every device.

Use [the decisions record](decisions.md#decisions-still-needed) to turn these into deliberate follow-up work.
