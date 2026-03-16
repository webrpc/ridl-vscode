function normalizeShowReferencesArguments(vscode, args) {
  if (!Array.isArray(args)) {
    return args;
  }

  const [uri, position, locations, ...rest] = args;
  return [
    toUri(vscode, uri),
    toPosition(vscode, position),
    toLocations(vscode, locations),
    ...rest
  ];
}

function toUri(vscode, value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return vscode.Uri.parse(value);
  }
  if (typeof value.with === 'function' && typeof value.scheme === 'string') {
    return value;
  }
  if (typeof value === 'object' && typeof value.scheme === 'string') {
    if (typeof vscode.Uri.from === 'function') {
      return vscode.Uri.from(value);
    }
    if (typeof value.toString === 'function') {
      return vscode.Uri.parse(value.toString());
    }
  }
  return undefined;
}

function toPosition(vscode, value) {
  if (!value) {
    return undefined;
  }
  if (value instanceof vscode.Position) {
    return value;
  }

  const line = toNumber(value.line);
  const character = toNumber(value.character);
  if (line === undefined || character === undefined) {
    return undefined;
  }

  return new vscode.Position(line, character);
}

function toLocations(vscode, value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((location) => toLocation(vscode, location)).filter(Boolean);
}

function toLocation(vscode, value) {
  if (!value) {
    return undefined;
  }
  if (value instanceof vscode.Location) {
    return value;
  }

  const uri = toUri(vscode, value.uri);
  const start = toPosition(vscode, value.range && value.range.start);
  const end = toPosition(vscode, value.range && value.range.end);
  if (!uri || !start || !end) {
    return undefined;
  }

  return new vscode.Location(uri, new vscode.Range(start, end));
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

module.exports = {
  normalizeShowReferencesArguments
};
