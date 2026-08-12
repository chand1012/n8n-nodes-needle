# n8n-nodes-needle

Run [Cactus Needle 2](https://github.com/cactus-compute/needle) locally in n8n. The package bundles the official WebAssembly engine and default `.cact` model, so inference runs without an API key or network request.

## Nodes

### Needle

The standard workflow node supports function call selection with user-defined function schemas. It accepts a prompt and an explicit list of callable functions, then returns Needle's selected function names and arguments on its normal workflow output.

Every result includes Needle's confidence score. The node can mark, return, suppress, or throw on a result below the configured threshold. Runtime metrics are optional.

For **Function Call Selection**, define every function that Needle is allowed to call in **Functions (JSON)**. Each entry contains a function name, an optional description, and the JSON Schema for its arguments:

```json
[
  {
    "name": "get_weather",
    "description": "Get the current weather for a city",
    "parameters": {
      "type": "object",
      "properties": {
        "city": { "type": "string", "description": "City name" }
      },
      "required": ["city"]
    }
  }
]
```

The standalone node returns the selected name and arguments in `functionCalls` on its normal main output. It declares callable functions for Needle; it is not exposed as an AI Agent tool.

### Needle Text Classifier

The classifier accepts the same core workflow inputs as n8n's Text Classifier: text plus a user-defined list of category names and descriptions. Each category becomes a named main output branch. Needle receives one `classify(text, category)` function whose `category` argument is a grammar-constrained JSON Schema enum—the direct equivalent of Python's `Literal[...]` or `Annotated[str, needle.Field(enum=...)]`. The function description includes every category and its description, and the original item is routed according to the selected literal; no AI model subnode is required.

Enable **Allow Multiple Classes To Be True** to route a copy of the item to every selected category branch. **Minimum Confidence** controls when a result counts as a clear match. A result below the threshold, or a result with no category call, can either be discarded or sent through an extra **Other** branch.

Choose **Custom CACT File** to use a model under `N8N_NEEDLE_MODEL_DIRECTORY`. Enable **Include Tool Calls in Output** to attach a portable synthetic-data record containing the input, generated function schemas, returned calls, and confidence. Once tool-call output is enabled, **Include Metrics** can add runtime and throughput measurements to that same record. By default the record is written to `needleClassification`.

### Needle Chat Model

Connect this subnode to an n8n AI Agent through the `AiLanguageModel` connection. LangChain tools are converted to Needle JSON Schema tools, and Needle calls are returned as standard LangChain `AIMessage.tool_calls` for the Agent to execute.

Needle is a compact tool-calling model, not a general conversational LLM. It is best used for local tool routing and local-first escalation workflows.

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

The project pins Node.js with [mise](https://mise.jdx.dev/). Install the configured runtime and dependencies, then run the checks:

```sh
mise install
mise exec -- npm install
mise exec -- npm test
mise exec -- npm run lint
mise exec -- npm run build
```

The WASM integration test performs real local inference using the bundled engine and model.

Start an isolated local n8n editor with the package symlinked for live development:

```sh
mise exec -- npm run dev
```

When startup completes, open `http://localhost:5678` or press `o` in the development runner. TypeScript changes rebuild automatically. Run `mise exec -- npm run build` before restarting the runner after changing bundled WASM or model assets.

If a newly linked node does not appear in the node picker, disable n8n's experimental browser-side node catalog for the local origin. In the browser developer console for `http://localhost:5678`, run:

```js
localStorage.removeItem('N8N_DATA_WORKER');
location.reload();
```

The development runner's server catalog is hot-reloaded, but the experimental data worker can retain a catalog created before the package was linked.

## Licenses

The integration is MIT licensed. Bundled Needle 2 artifacts are distributed under Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
