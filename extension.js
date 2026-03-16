const childProcess = require('child_process');
const fs = require('fs');
const vscode = require('vscode');
const {
  managedBinaryPath
} = require('./serverInstaller');
const {
  normalizeShowReferencesArguments
} = require('./commandAdapters');

const commandInstall = 'ridl.installLanguageServer';
const commandUpdate = 'ridl.updateLanguageServer';
const commandRestart = 'ridl.restartLanguageServer';
const commandShowReferences = 'ridl.showReferences';

const defaultImportPath = 'github.com/webrpc/ridl-lsp/cmd/ridl-lsp';
const outputChannelName = 'RIDL Language Server';
const traceOutputChannelName = 'RIDL Language Server Trace';

let client;
let clientModule;
let outputChannel;
let traceOutputChannel;
let startingPromise;

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel(outputChannelName);
  traceOutputChannel = vscode.window.createOutputChannel(traceOutputChannelName);

  context.subscriptions.push(
    outputChannel,
    traceOutputChannel,
    vscode.commands.registerCommand(commandInstall, () => installManagedLanguageServer(context, false)),
    vscode.commands.registerCommand(commandUpdate, () => installManagedLanguageServer(context, true)),
    vscode.commands.registerCommand(commandRestart, () => restartLanguageServer(context)),
    vscode.commands.registerCommand(commandShowReferences, (...args) => showReferences(...args))
  );

  if (hasRIDLOpen()) {
    await ensureLanguageServerStarted(context, true);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (document.languageId === 'ridl') {
        await ensureLanguageServerStarted(context, true);
      }
    })
  );
}

async function deactivate() {
  if (!client) {
    return;
  }
  const current = client;
  client = undefined;
  await current.stop();
}

function hasRIDLOpen() {
  return vscode.workspace.textDocuments.some((document) => document.languageId === 'ridl');
}

function configuration() {
  return vscode.workspace.getConfiguration('ridl');
}

async function ensureLanguageServerStarted(context, promptOnMissing) {
  if (client) {
    return;
  }

  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    try {
      const serverPath = await resolveLanguageServerPath(context, promptOnMissing);
      if (!serverPath) {
        return;
      }
      await startLanguageServer(context, serverPath);
    } finally {
      startingPromise = undefined;
    }
  })();

  return startingPromise;
}

async function startLanguageServer(context, serverPath) {
  const module = await loadLanguageClientModule();
  if (!module) {
    return;
  }

  const { LanguageClient, TransportKind, Trace } = module;
  const traceValue = configuration().get('languageServer.trace.server', 'off');
  const trace = typeof Trace?.fromString === 'function' ? Trace.fromString(traceValue) : Trace.Off;

  const serverOptions = {
    command: serverPath,
    transport: TransportKind.stdio,
    options: {
      env: process.env
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ridl');

  appendOutputLine(`Starting ridl-lsp from ${serverPath}`);

  client = new LanguageClient(
    'ridl',
    outputChannelName,
    serverOptions,
    {
      documentSelector: [
        { scheme: 'file', language: 'ridl' },
        { scheme: 'untitled', language: 'ridl' }
      ],
      synchronize: {
        fileEvents: watcher
      },
      outputChannel,
      traceOutputChannel
    }
  );

  try {
    await client.start();
    context.subscriptions.push(watcher);
  } catch (error) {
    client = undefined;
    watcher.dispose();
    throw error;
  }

  await client.setTrace(trace);
}

async function restartLanguageServer(context) {
  appendOutputLine('Restarting ridl-lsp');

  if (client) {
    const current = client;
    client = undefined;
    await current.stop();
  }

  await ensureLanguageServerStarted(context, false);
}

async function showReferences(...args) {
  const normalizedArgs = normalizeShowReferencesArguments(vscode, args);
  appendOutputLine(`Showing references for ${String(normalizedArgs?.[0] ?? 'unknown document')}`);
  return vscode.commands.executeCommand('editor.action.showReferences', ...normalizedArgs);
}

async function loadLanguageClientModule() {
  if (clientModule) {
    return clientModule;
  }

  try {
    clientModule = require('vscode-languageclient/node');
    return clientModule;
  } catch (error) {
    const selection = await vscode.window.showErrorMessage(
      'The RIDL extension needs the vscode-languageclient dependency. Run `npm install` in the extension folder before local development.',
      'Open Extension Folder'
    );
    if (selection === 'Open Extension Folder') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(__dirname), true);
    }
    return null;
  }
}

async function resolveLanguageServerPath(context, promptOnMissing) {
  const configuredPath = configuration().get('languageServer.path', '').trim();
  if (configuredPath) {
    if (fs.existsSync(configuredPath)) {
      return configuredPath;
    }
    void vscode.window.showWarningMessage(`Configured RIDL language server was not found: ${configuredPath}`);
    return '';
  }

  const goEnv = await readGoEnv();
  if (!goEnv.gopath) {
    void vscode.window.showWarningMessage('RIDL could not determine GOPATH, so the managed ridl-lsp binary location is unknown.');
    return '';
  }

  const binaryPath = managedBinaryPath(goEnv.gopath);
  if (binaryPath && fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (promptOnMissing && configuration().get('languageServer.promptToInstall', true)) {
    const choice = await vscode.window.showWarningMessage(
      'ridl-lsp was not found in GOPATH/bin. Install it now?',
      'Install',
      'Not Now'
    );

    if (choice === 'Install') {
      const installed = await installManagedLanguageServer(context, false, { restart: false });
      return installed ? binaryPath : '';
    }
  }

  return '';
}

async function installManagedLanguageServer(context, isUpdate, options = {}) {
  const goEnv = await readGoEnv();
  if (!goEnv.gopath) {
    void vscode.window.showErrorMessage('RIDL could not determine GOPATH.');
    return false;
  }

  const importPath = configuration().get('languageServer.importPath', defaultImportPath).trim() || defaultImportPath;
  const label = isUpdate ? 'Updating ridl-lsp' : 'Installing ridl-lsp';
  appendOutputLine(`${label} via go ${['install', `${importPath}@latest`].join(' ')}`);
  const ok = await runGoInstall(label, ['install', `${importPath}@latest`]);
  if (!ok) {
    return false;
  }

  const binaryPath = managedBinaryPath(goEnv.gopath);
  appendOutputLine(`RIDL language server is ready at ${binaryPath}`);
  await vscode.window.showInformationMessage(`RIDL language server is ready at ${binaryPath}.`);
  if (options.restart !== false) {
    await restartLanguageServer(context);
  }
  return true;
}

async function readGoEnv() {
  try {
    const output = await execFile('go', ['env', 'GOPATH']);
    return { gopath: output.trim() };
  } catch (error) {
    return { gopath: '' };
  }
}

async function runGoInstall(title, args, cwd) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false
    },
    async () => {
      try {
        await execFile('go', args, {
          cwd,
          timeout: 120_000,
          env: {
            ...process.env,
            GOBIN: ''
          }
        });
        return true;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        appendOutputLine(`${title} failed: ${message}`);
        void vscode.window.showErrorMessage(`${title} failed: ${message}`);
        return false;
      }
    }
  );
}

function appendOutputLine(message) {
  if (outputChannel) {
    outputChannel.appendLine(message);
  }
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const details = stderr || stdout || error.message;
        reject(new Error(details.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = {
  activate,
  deactivate,
  __test: {
    ensureLanguageServerStarted,
    installManagedLanguageServer,
    restartLanguageServer,
    resetState() {
      client = undefined;
      clientModule = undefined;
      outputChannel = undefined;
      traceOutputChannel = undefined;
      startingPromise = undefined;
    },
    setClientModuleForTests(module) {
      clientModule = module;
    },
    setClientForTests(nextClient) {
      client = nextClient;
    }
  }
};
