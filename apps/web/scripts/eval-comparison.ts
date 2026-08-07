// Regression gate for the comparison prompt (see the prompt-change skill). Mirrors
// eval-extraction.ts's shape — until fixtures exist there's nothing to score.
import { readdirSync } from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dirname, "..", "fixtures", "comparisons");

function main() {
  const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );

  if (fixtures.length === 0) {
    console.log("eval:comparison — no fixtures in fixtures/comparisons/ yet. Nothing to score.");
    return;
  }

  console.log(
    `eval:comparison — found ${fixtures.length} fixture(s), scoring not implemented yet.`,
  );
}

main();
