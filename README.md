# RIDL for VS Code

RIDL adds first-class editor support for `.ridl` files used by webrpc schemas.

## Features

- syntax highlighting tailored for RIDL declarations, annotations, metadata, fields, and enum members
- language server integration powered by `ridl-lsp`
- go to definition, type definition, find references, rename, hover, code lens, and document links
- commands to install or update `ridl-lsp` into `$GOPATH/bin`

## Requirements

- VS Code `1.90+`
- Go installed locally if you want the extension to install or update `ridl-lsp` for you

## Getting Started

Open any `.ridl` file. If `ridl-lsp` is not available in `$GOPATH/bin`, the extension can prompt to install it.

You can also manage the language server manually from the Command Palette:

- `RIDL: Install Language Server`
- `RIDL: Update Language Server`
- `RIDL: Restart Language Server`

## Install From Repo

If you want to build and install the latest extension from the repository without cloning it first, stream the installer directly.

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/webrpc/ridl-vscode/master/install.sh | bash
```

Windows PowerShell:

```powershell
Invoke-RestMethod https://raw.githubusercontent.com/webrpc/ridl-vscode/master/install.ps1 | Invoke-Expression
```

Requirements:

- `git`
- `npm`
- the VS Code `code` CLI available in `PATH`

Both scripts clone the repo into a temporary directory, build the extension, install it into VS Code, and remove the temporary checkout when they finish.

If you prefer to run the installer from a local checkout instead:

```bash
./install.sh
```

```powershell
.\install.ps1
```

To install from a different repo URL, set `RIDL_VSCODE_REPO` before running the script.

## Configuration

- `ridl.languageServer.path`: absolute path to a `ridl-lsp` binary to use instead of the managed one
- `ridl.languageServer.importPath`: Go import path used when installing or updating the managed server
- `ridl.languageServer.promptToInstall`: whether to prompt to install `ridl-lsp` when opening RIDL files
- `ridl.languageServer.trace.server`: trace level forwarded to the language client

## Managed Binary Location

The extension manages `ridl-lsp` in `$GOPATH/bin`, similar to common Go tooling workflows.

If you want to override that, set `ridl.languageServer.path` to an explicit binary path.

## Development

```bash
cd ridl-vscode
npm install
npm test
```

Then open `ridl-vscode` in VS Code and launch the extension host.

## Packaging

```bash
cd ridl-vscode
npm test
npm run package
```

This produces a versioned `.vsix` file like `ridl-vscode-<version>.vsix` that you can install locally with:

```bash
code --install-extension ridl-vscode-<version>.vsix --force
```

Or run the packaged install workflow directly:

```bash
npm run install:local
```

## Publishing

Once the publisher is configured in the Visual Studio Marketplace:

```bash
cd ridl-vscode
npm test
npm run publish:vsce
```

The publish command uses `vsce`, so you will need a Marketplace personal access token configured for that environment.
