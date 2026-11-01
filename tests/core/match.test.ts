import { describe, expect, it } from 'vitest';

import { classify, matchHunk } from '../../src/core/match.js';

const hunk = (added: string[], removed: string[] = []) => ({ added, removed });

describe('classify', () => {
  it('uses the default threshold boundaries', () => {
    expect(classify(0.9)).toBe('present');
    expect(classify(0.8999)).toBe('partial');
    expect(classify(0.1)).toBe('partial');
    expect(classify(0.0999)).toBe('gone');
  });
});

describe('matchHunk', () => {
  it('is present when the hunk is intact among other code', () => {
    expect(matchHunk(hunk(['const one = 1;', 'const two = 2;', 'return one + two;']), [
      'function before() {}',
      '',
      'const one = 1;',
      'const two = 2;',
      'return one + two;',
      'function after() {}',
    ].join('\n'))).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: 3,
      endLine: 5,
    });
  });

  it('is partial when the middle line was edited', () => {
    const added = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);
    const fileLines = [...added];
    fileLines[5] = 'edited line';

    expect(matchHunk(hunk(added), fileLines.join('\n'))).toEqual({
      ratio: 0.5,
      existence: 'partial',
      startLine: 1,
      endLine: 5,
    });
  });

  it('is gone when the hunk was replaced', () => {
    expect(matchHunk(hunk(['recorded one', 'recorded two']), 'replacement\ncontent')).toEqual({
      ratio: 0,
      existence: 'gone',
      startLine: null,
      endLine: null,
    });
  });

  it('ignores indentation and CRLF', () => {
    expect(matchHunk(
      hunk(['  if (ready) {', '  run();', '  }']),
      ['before();', '    if (ready) {', '    run();', '    }', 'after();'].join('\r\n'),
    )).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: 2,
      endLine: 4,
    });
  });

  it('reports original line numbers while ignoring blank lines', () => {
    expect(matchHunk(hunk(['alpha', '', 'beta']), 'before\n\nalpha\n\n beta \nafter')).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: 3,
      endLine: 5,
    });
  });

  it('chooses the earliest file run when equal-length runs tie', () => {
    expect(matchHunk(hunk(['alpha', 'beta']), 'beta\nother\nalpha')).toEqual({
      ratio: 0.5,
      existence: 'partial',
      startLine: 1,
      endLine: 1,
    });
  });

  it('interleaved context hunk is present when unchanged', () => {
    const interleaved = {
      added: ['const a = 2', 'const b = 2'],
      removed: ['const a = 1', 'const b = 1'],
      span: [
        { text: 'const a = 2', added: true },
        { text: 'const keep = 0', added: false },
        { text: 'const b = 2', added: true },
      ],
    };

    expect(matchHunk(interleaved, 'const a = 2\nconst keep = 0\nconst b = 2\nconst end = 0\n')).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: 1,
      endLine: 3,
    });
  });

  it('editing one added line in an interleaved hunk is partial', () => {
    const interleaved = {
      added: ['const a = 2', 'const b = 2'],
      removed: [],
      span: [
        { text: 'const a = 2', added: true },
        { text: 'const keep = 0', added: false },
        { text: 'const b = 2', added: true },
      ],
    };

    expect(matchHunk(interleaved, 'const a = 2\nconst keep = 0\nconst b = 3\n')).toEqual({
      ratio: 0.5,
      existence: 'partial',
      startLine: 1,
      endLine: 2,
    });
  });

  it('editing an interior context line counts against the run', () => {
    const interleaved = {
      added: ['const a = 2', 'const b = 2'],
      removed: [],
      span: [
        { text: 'const a = 2', added: true },
        { text: 'const keep = 0', added: false },
        { text: 'const b = 2', added: true },
      ],
    };

    const result = matchHunk(interleaved, 'const a = 2\nconst keep = 1\nconst b = 2\n');

    expect(result.ratio).toBeLessThan(1);
    expect(result).toMatchObject({ ratio: 0.5, startLine: 1, endLine: 1 });
  });

  it('legacy hunk without span keeps old behavior', () => {
    expect(matchHunk(
      hunk(['const a = 2', 'const b = 2']),
      'const a = 2\nconst keep = 0\nconst b = 2\nconst end = 0\n',
    )).toEqual({
      ratio: 0.5,
      existence: 'partial',
      startLine: 1,
      endLine: 1,
    });
  });

  it('handles deletion-only hunks', () => {
    const deletion = hunk([], ['deleted one', 'deleted two']);

    expect(matchHunk(deletion, 'unrelated content')).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: null,
      endLine: null,
    });
    expect(matchHunk(deletion, 'before\ndeleted one\ndeleted two\nafter')).toEqual({
      ratio: 0,
      existence: 'gone',
      startLine: null,
      endLine: null,
    });
  });

  it('treats an empty hunk as present', () => {
    expect(matchHunk(hunk(['', '  ']), 'anything')).toEqual({
      ratio: 1,
      existence: 'present',
      startLine: null,
      endLine: null,
    });
  });

  it('is gone when the file is missing', () => {
    expect(matchHunk(hunk(['recorded']), null)).toEqual({
      ratio: 0,
      existence: 'gone',
      startLine: null,
      endLine: null,
    });
  });

  it('stays fast with span on repetitive input', () => {
    const lines = Array.from({ length: 2_000 }, () => '}');
    const span = lines.map((text) => ({ text, added: true }));
    const startedAt = performance.now();

    const result = matchHunk({ added: lines, removed: [], span }, lines.join('\n'));
    const elapsed = performance.now() - startedAt;

    expect(result.ratio).toBe(1);
    expect(elapsed).toBeLessThan(200);
  });

  it('stays fast on repetitive input', () => {
    const lines = Array.from({ length: 2_000 }, () => '}');
    const startedAt = performance.now();

    const result = matchHunk(hunk(lines), lines.join('\n'));
    const elapsed = performance.now() - startedAt;

    expect(result.ratio).toBe(1);
    expect(elapsed).toBeLessThan(200);
  });
});
