import { describe, expect, it } from 'vitest';

import { fingerprint, parseUnifiedDiff } from '../../src/core/diff.js';

describe('parseUnifiedDiff', () => {
  it('parses modified file', () => {
    const result = parseUnifiedDiff(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const before = true;
-old value
+new value
 const after = true;
@@ -10,2 +10,3 @@ function later() {
 context line
+inserted line
 closing line
`);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('modified');
    expect(result[0]?.hunks).toHaveLength(2);
    expect(result[0]?.hunks[0]).toMatchObject({
      added: ['new value'],
      removed: ['old value'],
      newStart: 1,
      contextBefore: ['const before = true;'],
      contextAfter: ['const after = true;'],
    });
  });

  it('captures span with interior context', () => {
    const [file] = parseUnifiedDiff(`diff --git a/code.ts b/code.ts
--- a/code.ts
+++ b/code.ts
@@ -1,5 +1,5 @@
-const a = 1
+const a = 2
 const keep = 0
-const b = 1
+const b = 2
 const end = 0
`);

    expect(file?.hunks[0]?.span).toEqual([
      { text: 'const a = 2', added: true },
      { text: 'const keep = 0', added: false },
      { text: 'const b = 2', added: true },
    ]);
  });

  it('uses an empty span for deletion-only hunks', () => {
    const [file] = parseUnifiedDiff(`diff --git a/code.ts b/code.ts
--- a/code.ts
+++ b/code.ts
@@ -1,2 +1 @@
-first
 second
`);

    expect(file?.hunks[0]?.span).toEqual([]);
  });

  it('preserves changes that resemble file headers', () => {
    const [file] = parseUnifiedDiff(`diff --git a/src/headings.ts b/src/headings.ts
--- a/src/headings.ts
+++ b/src/headings.ts
@@ -1,2 +1,2 @@
--- old heading
+++ new heading
 unchanged
`);

    expect(file?.oldPath).toBe('src/headings.ts');
    expect(file?.newPath).toBe('src/headings.ts');
    expect(file?.hunks[0]?.removed).toEqual(['-- old heading']);
    expect(file?.hunks[0]?.added).toEqual(['++ new heading']);
  });
  it('parses new file', () => {
    const [file] = parseUnifiedDiff(`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+first
+second
`);

    expect(file).toMatchObject({
      oldPath: null,
      newPath: 'src/new.ts',
      status: 'added',
    });
  });

  it('parses deleted file', () => {
    const [file] = parseUnifiedDiff(`diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-first
-second
`);

    expect(file).toMatchObject({
      oldPath: 'src/old.ts',
      newPath: null,
      status: 'deleted',
    });
    expect(file?.hunks[0]?.file).toBe('src/old.ts');
  });

  it('parses rename with edits', () => {
    const [file] = parseUnifiedDiff(`diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-old name
+new name
`);

    expect(file).toMatchObject({
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      status: 'renamed',
    });
    expect(file?.hunks[0]?.file).toBe('src/new.ts');
  });

  it('marks binary', () => {
    const [file] = parseUnifiedDiff(`diff --git a/x.png b/x.png
index 1111111..2222222 100644
Binary files a/x.png and b/x.png differ
`);

    expect(file?.binary).toBe(true);
    expect(file?.hunks).toEqual([]);
  });

  it('strips CRLF', () => {
    const [file] = parseUnifiedDiff([
      'diff --git a/src/crlf.ts b/src/crlf.ts',
      '--- a/src/crlf.ts',
      '+++ b/src/crlf.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\r\n'));

    expect(file?.hunks[0]?.added).toEqual(['new']);
    expect(file?.hunks[0]?.removed).toEqual(['old']);
  });

  it('handles 中文 path', () => {
    const [file] = parseUnifiedDiff(`diff --git a/src/中文.ts b/src/中文.ts
--- a/src/中文.ts
+++ b/src/中文.ts
@@ -1 +1 @@
-舊
+新
`);

    expect(file).toMatchObject({
      oldPath: 'src/中文.ts',
      newPath: 'src/中文.ts',
    });
    expect(file?.hunks[0]?.file).toBe('src/中文.ts');
  });
});

describe('fingerprint', () => {
  it('ignores whitespace and blank lines', () => {
    expect(fingerprint(['  a ', '', 'b'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['a', 'c']));
    expect(fingerprint(['a', 'b'])).toBe('fcd127ffa1016069006ad91f3f361248f9bdf272');
  });
});