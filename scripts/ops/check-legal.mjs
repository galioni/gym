#!/usr/bin/env node
/**
 * Pre-launch check: the Terms of Use and Privacy Policy pages (public/terms.html, public/privacy.html) must name who is
 * responsible for them before they are shown to the stores or to people. Fails while any [PLACEHOLDER] is left.
 *
 *   npm run check:legal
 *
 * Not part of CI on purpose: the pages ship with placeholders until the operator's details are filled in.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pages = ["public/terms.html", "public/privacy.html"];
const placeholder = /\[(OPERATOR NAME|OPERATOR ADDRESS|CONTACT EMAIL)\]/g;

let failed = false;
for (const page of pages) {
  const text = readFileSync(resolve(process.cwd(), page), "utf8");
  const found = [...new Set(text.match(placeholder) ?? [])];
  if (found.length > 0) {
    failed = true;
    console.error(`${page}: still contains ${found.join(", ")}`);
  } else {
    console.log(`${page}: ok`);
  }
}

if (failed) {
  console.error("\nFill these in (search and replace in both files) before submitting to the App Store or Google Play.");
  process.exit(1);
}
