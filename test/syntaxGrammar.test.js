const test = require('node:test');
const assert = require('node:assert/strict');
const grammar = require('../syntaxes/ridl.tmLanguage.json');

test('error declarations capture quoted messages as string scopes', () => {
  const rule = grammar.repository.errorDecl.patterns[0];
  const regex = new RegExp(rule.match);
  const line = 'error 3000 NotFound "resource not found" HTTP 422';
  const match = regex.exec(line);

  assert.ok(match, 'expected error declaration to match');
  assert.equal(match[2], 'error');
  assert.equal(match[3], '3000');
  assert.equal(match[4], 'NotFound');
  assert.equal(match[5], '"resource not found"');
  assert.equal(match[6], 'HTTP');
  assert.equal(match[7], '422');
  assert.equal(rule.captures['5'].name, 'string.quoted.double.error-message.ridl');
});
