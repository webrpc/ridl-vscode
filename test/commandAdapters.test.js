const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeShowReferencesArguments } = require('../commandAdapters');

class FakeUri {
  constructor(value) {
    this.value = value;
    this.scheme = String(value).split(':', 1)[0] || '';
    this.path = String(value);
  }

  toString() {
    return this.value;
  }
}

class FakePosition {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class FakeRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class FakeLocation {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}

const fakeVscode = {
  Uri: {
    parse(value) {
      return new FakeUri(value);
    },
    from(value) {
      return new FakeUri(`${value.scheme}:${value.path}`);
    }
  },
  Position: FakePosition,
  Range: FakeRange,
  Location: FakeLocation
};

test('normalizeShowReferencesArguments converts raw command arguments to vscode shapes', () => {
  const normalized = normalizeShowReferencesArguments(fakeVscode, [
    'file:///tmp/models_common.ridl',
    { line: 4, character: 7 },
    [
      {
        uri: 'file:///tmp/models_common.ridl',
        range: {
          start: { line: 41, character: 24 },
          end: { line: 41, character: 28 }
        }
      }
    ]
  ]);

  assert.ok(normalized[0] instanceof FakeUri);
  assert.ok(normalized[1] instanceof FakePosition);
  assert.ok(normalized[2][0] instanceof FakeLocation);
});

test('normalizeShowReferencesArguments filters invalid locations and coerces numeric strings', () => {
  const normalized = normalizeShowReferencesArguments(fakeVscode, [
    { scheme: 'file', path: '/tmp/models_common.ridl' },
    { line: '4', character: '7' },
    [
      {
        uri: 'file:///tmp/models_common.ridl',
        range: {
          start: { line: '1', character: '2' },
          end: { line: '1', character: '6' }
        }
      },
      {
        uri: null,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 6 }
        }
      }
    ]
  ]);

  assert.ok(normalized[0] instanceof FakeUri);
  assert.ok(normalized[1] instanceof FakePosition);
  assert.equal(normalized[2].length, 1);
  assert.ok(normalized[2][0] instanceof FakeLocation);
});
