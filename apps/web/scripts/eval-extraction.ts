// Regression gate for the extraction prompt (see the prompt-change skill). Extraction itself
// ships in M1 — until then there are no fixtures to score, so this reports that and exits clean.
import { readdirSync } from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dirname, "..", "fixtures", "receipts");

function main() {
  const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );

  if (fixtures.length === 0) {
    console.log(
      "eval:extraction — no fixtures in fixtures/receipts/ yet (extraction ships in M1). Nothing to score.",
    );
    return;
  }

  console.log(
    `eval:extraction — found ${fixtures.length} fixture(s), scoring not implemented yet.`,
  );
}

main();
