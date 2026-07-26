---
name: prompt-change
description: Required procedure for changing any Claude prompt or model configuration in this repo. Use when editing docs/prompts/*, lib/claude/*, or the CLAUDE_*_MODEL env defaults.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Changing a Claude prompt

Prompts are production code. They are versioned, evaluated, and reviewed like any other change.

1. **Never edit a shipped prompt file in place.** Copy `docs/prompts/extraction.v3.md` to `.v4.md` and
   edit the copy. Bump the version constant in `lib/claude/prompts.ts`.
2. State the hypothesis at the top of the new file: what is failing today and what this change should fix.
3. Keep the output contract stable. If the JSON shape changes, the Zod schema, the review screen, and
   the iOS DTO change in the same PR.
4. Run the eval before and after: `npm run eval:extraction`. Use the `prompt-eval-runner` agent so the
   per-receipt output stays out of the main context.
5. Blocking thresholds: category accuracy and item recall may not drop more than 1 point; the
   schema-invalid rate may not rise; median tokens per receipt may not rise more than 10% without a
   stated reason.
6. If a fixture exposes a real failure the change doesn't fix, add it to `fixtures/receipts/` with a
   hand-written label. Growing the fixture set is always welcome. Editing an existing label to make an
   eval pass is never acceptable.
7. Record the result in `docs/prompts/CHANGELOG.md`: version, hypothesis, metric deltas, decision.
8. Model changes (`CLAUDE_EXTRACTION_MODEL`, `CLAUDE_ANALYSIS_MODEL`) go through the same eval, plus a
   cost note: tokens and price per receipt before and after.
