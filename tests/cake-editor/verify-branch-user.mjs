// E2E verification for the cake print editor feature.
// Authenticates as a restricted branch user and verifies storage RLS + Edge Function.
// Run from project root: node tests/cake-editor/verify-branch-user.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nlklndgmtmwoacipjyek.supabase.co';
const SUPABASE_ANON = 'sb_publishable_uMtPcUxfJEdYzzjMv1LeCw_dLW2FM9A';

const EMAIL = 'avraham_avinu@martin.local';
const PASSWORD = 'martin1234';

const BUCKET = 'cake-designs';

// Fetch a real 200x200 JPEG (~5–10 KB) at runtime so Anthropic vision has actual content.
// Falls back to a smaller embedded JPEG only if the fetch fails.
const FALLBACK_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEB' +
  'AxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9' +
  'AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip' +
  'qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9k=';

async function loadTestJpeg() {
  // picsum.photos gives a stable random-but-valid JPEG; follow redirects.
  try {
    const res = await fetch('https://picsum.photos/seed/cake/200/200.jpg', {
      redirect: 'follow',
    });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0xff && buf[1] === 0xd8) {
        return buf;
      }
    }
  } catch {}
  return Uint8Array.from(Buffer.from(FALLBACK_JPEG_B64, 'base64'));
}

const tinyJpegBytes = await loadTestJpeg();
console.log(`Using test JPEG of ${tinyJpegBytes.length} bytes`);

const results = [];
let passed = 0;
function record(num, label, ok, detail = '') {
  results.push({ num, label, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`Test ${num} (${label}): ${tag}${detail ? ' — ' + detail : ''}`);
  if (ok) passed += 1;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ts = Date.now();
const ownPath = `1/test_${ts}.jpg`;
const otherPath = `2/test_${ts}.jpg`;
const otherProbePath = `2/probe_${ts}.jpg`;

// ---------- 1) Sign in ----------
{
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) {
    record(1, 'Sign in', false, `auth error: ${error.message}`);
    console.log('\nCannot proceed without auth. Stopping per instructions.');
    console.log(`\nSummary: ${passed}/7 passed`);
    process.exit(1);
  }
  record(1, 'Sign in', true, `user.id=${data.user?.id}`);
}

// ---------- 2) Upload to OWN branch folder ----------
{
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ownPath, tinyJpegBytes, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  record(2, 'Upload to own branch (1/)', !error, error ? `error: ${error.message}` : `path=${ownPath}`);
}

// ---------- 3) Upload to OTHER branch folder (must be denied) ----------
{
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(otherPath, tinyJpegBytes, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  // PASS if it FAILS with RLS / permission error.
  if (error) {
    record(3, 'Upload to other branch (2/) blocked', true, `correctly denied: ${error.message}`);
  } else {
    record(3, 'Upload to other branch (2/) blocked', false, 'upload SUCCEEDED — RLS leak!');
    // Best-effort cleanup of an unexpected upload.
    await supabase.storage.from(BUCKET).remove([otherPath]);
  }
}

// ---------- 4) Create signed URL for own upload ----------
let ownSignedUrl = null;
{
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(ownPath, 300);
  if (error || !data?.signedUrl) {
    record(4, 'Signed URL for own upload', false, `error: ${error?.message ?? 'no url'}`);
  } else {
    ownSignedUrl = data.signedUrl;
    record(4, 'Signed URL for own upload', true, `url len=${data.signedUrl.length}`);
  }
}

// ---------- 5) Read other branch's file (negative) ----------
{
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(otherProbePath, 60);
  // PASS if it errors (404 or permission denied).
  if (error || !data?.signedUrl) {
    record(5, 'Other branch read denied/missing', true, `expected error: ${error?.message ?? 'no url'}`);
  } else {
    record(5, 'Other branch read denied/missing', false, `got URL for ${otherProbePath} — leak!`);
  }
}

// ---------- 6) Edge Function: cake-design-suggest ----------
const allowedFonts = ['heebo', 'rubik', 'frank', 'suez', 'karantina', 'assistant'];
const allowedStyles = ['classic', 'gold', 'pink', 'neon', 'navy', 'green', 'burgundy', 'shadow'];
let aiReasoning = null;
{
  if (!ownSignedUrl) {
    record(6, 'cake-design-suggest', false, 'no signed URL from step 4 to feed in');
  } else {
    const { data, error } = await supabase.functions.invoke('cake-design-suggest', {
      body: {
        imageUrl: ownSignedUrl,
        text: 'מזל טוב',
        preset: 'round_medium',
        fontKeys: allowedFonts,
        styleKeys: allowedStyles,
      },
    });

    if (error) {
      // Try to read response body for more detail.
      let extra = '';
      try {
        if (error.context && typeof error.context.text === 'function') {
          extra = ' body=' + (await error.context.text());
        }
      } catch {}
      record(6, 'cake-design-suggest', false, `invoke error: ${error.message}${extra}`);
    } else {
      const required = ['font', 'style', 'sizeKey', 'position', 'reasoning'];
      const allowedSizes = ['small', 'medium', 'large', 'huge'];
      const allowedPositions = [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ];
      const missing = required.filter((k) => !(k in (data ?? {})));
      const fontOk = allowedFonts.includes(data?.font);
      const styleOk = allowedStyles.includes(data?.style);
      const sizeOk = allowedSizes.includes(data?.sizeKey);
      const posOk = allowedPositions.includes(data?.position);
      const reasoningOk = typeof data?.reasoning === 'string' && data.reasoning.length > 0;
      const isFallback = data?.fallback === true;
      const allOk = missing.length === 0 && fontOk && styleOk && sizeOk && posOk && reasoningOk && !isFallback;
      aiReasoning = data?.reasoning ?? null;

      const detail = allOk
        ? `font=${data.font} style=${data.style} sizeKey=${data.sizeKey} position=${data.position}`
        : `missing=${missing.join(',')} fontOk=${fontOk} styleOk=${styleOk} sizeOk=${sizeOk} posOk=${posOk} reasoningOk=${reasoningOk} fallback=${isFallback} err=${data?.error ?? ''} raw=${JSON.stringify(data).slice(0, 400)}`;

      record(6, 'cake-design-suggest', allOk, detail);
    }
  }
}

// ---------- 7) Cleanup own upload from step 2 ----------
{
  const { error } = await supabase.storage.from(BUCKET).remove([ownPath]);
  record(7, 'Cleanup own upload', !error, error ? `error: ${error.message}` : `removed ${ownPath}`);
}

// ---------- Final report ----------
console.log('\n=== Cake Editor E2E Verification ===');
for (const r of results) {
  console.log(` ${r.ok ? 'PASS' : 'FAIL'}  Test ${r.num} — ${r.label}${r.detail ? ' :: ' + r.detail : ''}`);
}
if (aiReasoning) {
  console.log('\nClaude reasoning (Hebrew):');
  console.log(aiReasoning);
}
console.log(`\nSummary: ${passed}/7 passed`);

await supabase.auth.signOut();
process.exit(passed === 7 ? 0 : 2);
