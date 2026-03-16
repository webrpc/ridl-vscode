const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function withMocks(mocks, loadModule) {
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return loadModule();
  } finally {
    Module._load = originalLoad;
  }
}

function createHarness() {
  let binaryInstalled = false;
  const warningMessages = [];
  const infoMessages = [];
  const watchers = [];
  const createdClients = [];
  const commandCalls = [];

  class FakeLanguageClient {
    constructor() {
      this.startCalls = 0;
      this.stopCalls = 0;
      this.traceValues = [];
      createdClients.push(this);
    }

    async start() {
      this.startCalls += 1;
    }

    async stop() {
      this.stopCalls += 1;
    }

    async setTrace(value) {
      this.traceValues.push(value);
    }
  }

  const fakeFs = {
    existsSync(targetPath) {
      return targetPath === '/tmp/go/bin/ridl-lsp' ? binaryInstalled : false;
    }
  };

  const fakeChildProcess = {
    execFile(command, args, options, callback) {
      if (typeof options === 'function') {
        callback = options;
      }

      if (command !== 'go') {
        callback(new Error(`unexpected command ${command}`));
        return;
      }

      if (args[0] === 'env' && args[1] === 'GOPATH') {
        callback(null, '/tmp/go\n', '');
        return;
      }

      if (args[0] === 'install') {
        binaryInstalled = true;
        callback(null, '', '');
        return;
      }

      callback(new Error(`unexpected args ${args.join(' ')}`));
    }
  };

  const fakeVscode = {
    ProgressLocation: {
      Notification: 'notification'
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
    Uri: {
      file(value) {
        return { scheme: 'file', path: value, toString: () => `file:${value}` };
      },
      parse(value) {
        return { scheme: String(value).split(':', 1)[0], path: value, toString: () => value };
      },
      from(value) {
        return value;
      }
    },
    window: {
      createOutputChannel() {
        return {
          appendLine() {},
          dispose() {}
        };
      },
      async showWarningMessage(message, ...items) {
        warningMessages.push(message);
        return items.includes('Install') ? 'Install' : undefined;
      },
      async showInformationMessage(message) {
        infoMessages.push(message);
        return undefined;
      },
      async showErrorMessage(message) {
        throw new Error(`unexpected showErrorMessage: ${message}`);
      },
      async withProgress(_options, task) {
        return task();
      }
    },
    commands: {
      registerCommand() {
        return { dispose() {} };
      },
      async executeCommand(command, ...args) {
        commandCalls.push([command, ...args]);
        return undefined;
      }
    },
    workspace: {
      textDocuments: [],
      getConfiguration() {
        return {
          get(key, defaultValue) {
            if (key === 'languageServer.path') {
              return '';
            }
            if (key === 'languageServer.promptToInstall') {
              return true;
            }
            if (key === 'languageServer.importPath') {
              return defaultValue;
            }
            if (key === 'languageServer.trace.server') {
              return 'off';
            }
            return defaultValue;
          }
        };
      },
      createFileSystemWatcher() {
        const watcher = {
          disposed: false,
          dispose() {
            watcher.disposed = true;
          }
        };
        watchers.push(watcher);
        return watcher;
      },
      onDidOpenTextDocument() {
        return { dispose() {} };
      }
    }
  };

  const extension = withMocks(
    {
      vscode: fakeVscode,
      fs: fakeFs,
      child_process: fakeChildProcess
    },
    () => {
      delete require.cache[require.resolve('../extension')];
      return require('../extension');
    }
  );

  extension.__test.resetState();
  extension.__test.setClientModuleForTests({
    LanguageClient: FakeLanguageClient,
    TransportKind: { stdio: 'stdio' },
    Trace: {
      Off: 'off',
      fromString(value) {
        return value;
      }
    }
  });

  return {
    extension,
    state: {
      get binaryInstalled() {
        return binaryInstalled;
      },
      warningMessages,
      infoMessages,
      watchers,
      createdClients,
      commandCalls
    }
  };
}

async function withTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), 200);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

test('ensureLanguageServerStarted installs and starts once when prompted on first run', async () => {
  const { extension, state } = createHarness();
  const context = { subscriptions: [] };

  await withTimeout(
    extension.__test.ensureLanguageServerStarted(context, true),
    'ensureLanguageServerStarted timed out'
  );

  assert.equal(state.binaryInstalled, true);
  assert.equal(state.createdClients.length, 1);
  assert.equal(state.createdClients[0].startCalls, 1);
  assert.deepEqual(state.createdClients[0].traceValues, ['off']);
  assert.equal(state.warningMessages.length, 1);
  assert.equal(state.infoMessages.length, 1);
  assert.equal(state.watchers.length, 1);
  assert.equal(context.subscriptions.length, 1);
});

test('installManagedLanguageServer still restarts an existing client by default', async () => {
  const { extension, state } = createHarness();
  const context = { subscriptions: [] };
  const existingClient = {
    stopCalls: 0,
    async stop() {
      this.stopCalls += 1;
    }
  };

  extension.__test.setClientForTests(existingClient);

  const installed = await extension.__test.installManagedLanguageServer(context, false);

  assert.equal(installed, true);
  assert.equal(existingClient.stopCalls, 1);
  assert.equal(state.createdClients.length, 1);
  assert.equal(state.createdClients[0].startCalls, 1);
});
