// Writes the phase-0 sample document to out/spike.docx for manual opening in Word/LibreOffice.
import { writeFileSync } from "node:fs";
import { writeDocx } from "@texdocx/docx";
import { sampleDocument } from "../../../tests/fixtures/sample-model.ts";

writeFileSync("out/spike.docx", writeDocx(sampleDocument()));
console.log("wrote out/spike.docx");
