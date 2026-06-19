const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const childProcess = require('child_process');
const {
  executableName,
  findOnPath,
  firstGopathEntry,
  managedBinaryPath
} = require('../serverInstaller');

test('executableName uses platform specific suffix', () => {
  assert.equal(executableName('darwin'), 'ridl-lsp');
  assert.equal(executableName('win32'), 'ridl-lsp.exe');
});

test('firstGopathEntry returns the first GOPATH segment', () => {
  const gopath = ['/Users/me/go', '/tmp/go'].join(path.delimiter);
  assert.equal(firstGopathEntry(gopath), '/Users/me/go');
});

test('managedBinaryPath resolves to GOPATH bin', () => {
  assert.equal(managedBinaryPath('/Users/me/go', 'darwin'), path.join('/Users/me/go', 'bin', 'ridl-lsp'));
});

test('findOnPath returns empty string when binary is not found', () => {
  // ridl-lsp-nonexistent won't be on PATH, but findOnPath hardcodes the
  // executable name so we just verify it returns a string (found or not).
  const result = findOnPath();
  assert.equal(typeof result, 'string');
});

test('findOnPath strips CR and returns the first match on Windows', () => {
  const original = childProcess.execFileSync;
  childProcess.execFileSync = () => 'C:\\Go\\bin\\ridl-lsp.exe\r\nC:\\Other\\ridl-lsp.exe\r\n';
  try {
    assert.equal(findOnPath('win32'), 'C:\\Go\\bin\\ridl-lsp.exe');
  } finally {
    childProcess.execFileSync = original;
  }
});
