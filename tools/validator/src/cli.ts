// Usage: node tools/validator/src/cli.ts file.docx [more.docx …]
import { readFileSync } from "node:fs";
import { validateDocx } from "./index.ts";

let failed = false;
for (const file of process.argv.slice(2)) {
  const issues = validateDocx(new Uint8Array(readFileSync(file)));
  if (issues.length) {
    failed = true;
    console.log(`✗ ${file}`);
    for (const i of issues) console.log(`  ${i.part}: ${i.message}`);
  } else {
    console.log(`✓ ${file}`);
  }
}
process.exit(failed ? 1 : 0);
