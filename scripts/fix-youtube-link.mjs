// One-time admin script — run via: vercel env run -- node scripts/fix-youtube-link.mjs
// Finds every broken/missing YouTube URL in templates + workout-data and prints a report.

const USER_ID = "26cdb4b3-c5aa-4c49-a8b5-58c800ca11a0";
const CORRECT_URL = "https://www.youtube.com/watch?v=xT7TkTHHWJI";

const kvUrl   = process.env.KV_REST_API_URL   || process.env.STORAGE_KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;

if (!kvUrl || !kvToken) {
  console.error("Missing KV credentials. Run with: vercel env run -- node scripts/fix-youtube-link.mjs");
  process.exit(1);
}

async function kvGet(key) {
  const res = await fetch(kvUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${kvToken}` },
    body: JSON.stringify(["GET", key]),
  });
  if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
  const { result } = await res.json();
  if (!result) return null;
  try { return JSON.parse(result); } catch { return result; }
}

async function kvSet(key, value) {
  const res = await fetch(kvUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${kvToken}` },
    body: JSON.stringify(["SET", key, JSON.stringify(value)]),
  });
  if (!res.ok) throw new Error(`KV SET failed: ${res.status}`);
}

function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/.test(url);
}

async function main() {
  const templatesKey = `sync:${USER_ID}:templates`;
  const workoutKey   = `sync:${USER_ID}:workout-data`;

  const [templateDoc, workoutDoc] = await Promise.all([
    kvGet(templatesKey),
    kvGet(workoutKey),
  ]);

  // --- Inspect templates ---
  console.log("\n=== TEMPLATES ===");
  let templateDirty = false;
  const templates = templateDoc?.templates ?? templateDoc ?? {};

  for (const [session, tpl] of Object.entries(templates)) {
    // Session-level videoUrl
    if (tpl.videoUrl) {
      const valid = isValidYouTubeUrl(tpl.videoUrl);
      console.log(`  [${session}] session.videoUrl = "${tpl.videoUrl}"  ${valid ? "✓" : "✗ BROKEN"}`);
    }
    // Per-item videoUrls
    for (const section of ["warmup", "main"]) {
      for (const item of (tpl[section] ?? [])) {
        if (item.videoUrl) {
          const valid = isValidYouTubeUrl(item.videoUrl);
          console.log(`  [${session}] ${section}/"${item.text}" videoUrl = "${item.videoUrl}"  ${valid ? "✓" : "✗ BROKEN"}`);
          if (!valid) {
            item.videoUrl = CORRECT_URL;
            templateDirty = true;
            console.log(`    → fixed to "${CORRECT_URL}"`);
          }
        }
      }
    }
  }

  if (templateDirty) {
    const nextDoc = templateDoc?.templates
      ? { ...templateDoc, templates }
      : templates;
    await kvSet(templatesKey, nextDoc);
    console.log("\n✅ Templates written back to KV.");
  } else {
    console.log("\n(no broken template links)");
  }

  // --- Inspect workout-data ---
  console.log("\n=== WORKOUT DATA ===");
  let workoutDirty = false;
  const days = workoutDoc?.days ?? workoutDoc ?? {};

  for (const [date, day] of Object.entries(days)) {
    for (const section of ["warmup", "main"]) {
      for (const item of (day[section] ?? [])) {
        if (item.videoUrl) {
          const valid = isValidYouTubeUrl(item.videoUrl);
          console.log(`  [${date}] ${section}/"${item.text}" videoUrl = "${item.videoUrl}"  ${valid ? "✓" : "✗ BROKEN"}`);
          if (!valid) {
            item.videoUrl = CORRECT_URL;
            workoutDirty = true;
            console.log(`    → fixed to "${CORRECT_URL}"`);
          }
        }
      }
    }
  }

  if (workoutDirty) {
    const nextDoc = workoutDoc?.days
      ? { ...workoutDoc, days }
      : days;
    await kvSet(workoutKey, nextDoc);
    console.log("\n✅ Workout data written back to KV.");
  } else {
    console.log("\n(no broken workout-data links)");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
