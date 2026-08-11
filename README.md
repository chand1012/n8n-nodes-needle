# n8n-nodes-needle

Run [Cactus Needle 2](https://github.com/cactus-compute/needle) locally in n8n. The package bundles the official WebAssembly engine and default `.cact` model, so inference runs without an API key or network request.

## Nodes

### Needle

The standard workflow node supports:

- Tool Selection
- Structured Extraction with JSON Schema
- Classification with fixed labels
- Direct completion

Every result includes Needle's confidence score. The node can mark, return, suppress, or throw on a result below the configured threshold. Runtime metrics are optional.

### Needle Chat Model

Connect this subnode to an n8n AI Agent through the `AiLanguageModel` connection. LangChain tools are converted to Needle JSON Schema tools, and Needle calls are returned as standard LangChain `AIMessage.tool_calls` for the Agent to execute.

Needle is a compact tool-calling model, not a general conversational LLM. It is best used for local tool routing, structured extraction, and local-first escalation workflows.

## Installation

Install `n8n-nodes-needle` as an n8n community node package, or install it in the custom nodes directory:

```sh
cd ~/.n8n/nodes
npm install n8n-nodes-needle
```

The built-in model works immediately.

## Custom models

Set the directory from which `.cact` files may be loaded:

```sh
N8N_NEEDLE_MODEL_DIRECTORY=/models/needle
```

Then mount models read-only in Docker:

```yaml
volumes:
  - /mnt/user/appdata/n8n/needle:/models/needle:ro
environment:
  - N8N_NEEDLE_MODEL_DIRECTORY=/models/needle
```

Paths are canonicalized before validation. Symlinks and traversal outside the configured directory are rejected. For development only, unrestricted paths can be explicitly enabled with `N8N_NEEDLE_ALLOW_UNRESTRICTED_MODELS=true`.

## Runtime behavior

- Initialization is lazy.
- Model bytes are cached by canonical path, size, and modification time.
- Every workflow execution gets a fresh logical session.
- The official WASM engine currently exposes process-global session state, so inference is serialized to prevent state leaking between concurrent workflows.
- Prompts and tool results are never logged. Set `N8N_NEEDLE_DEBUG=true` for lifecycle timing only.

## Development

Use a Node version supported by n8n, then run:

```sh
npm install
npm test
npm run lint
npm run build
```

The WASM integration test performs real local inference using the bundled engine and model.

## Licenses

The integration is MIT licensed. Bundled Needle 2 artifacts are distributed under Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
