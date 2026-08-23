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

### Needle Tool Calling

The **Needle Tool Calling** node turns the AI tools connected to its **Tools** input into Needle schemas, plans one or more calls, executes them, and feeds each ordered result batch back into the same local Needle session. This supports dependent chains such as creating a record first and using its returned ID in a later tool call. Connect any ordinary n8n AI Tool or MCP tool that an Agent could use; toolkits are expanded into their individual tools.

The node accepts normal workflow items on its main input and evaluates its configured **Prompt** for each item, so expressions can reference upstream data. Its main output always includes:

- Needle's final response envelope.
- `definedTools`, containing the exact generated schemas for copying into a fine-tuning dataset.
- `results`, containing every successful tool result in execution order.
- `stopReason`, which is `completed`, `lowConfidence`, or `maxSteps`.

Needle executes calls in model order. A call batch below **Minimum Confidence** is returned without executing any call in that batch. Tool errors stop the node immediately. Advanced controls are hidden under **Options**: **Max Steps** defaults to 1, **Max New Tokens** to 256, and metrics and detailed output are disabled. Increase Max Steps only when later calls must consume earlier tool results through additional Needle rounds. Enable **Detailed Output** to add the original query and every model round with its calls, arguments, results, reasoning, confidence, and optional metrics.

```json
{
  "type": "respond",
  "success": true,
  "functionCalls": [],
  "confidence": 0.97,
  "definedTools": [
    {
      "name": "create_album",
      "description": "Create a photo album",
      "parameters": {
        "type": "object",
        "properties": { "name": { "type": "string" } },
        "required": ["name"]
      }
    }
  ],
  "results": [{ "albumId": 42 }, { "moved": 8 }],
  "stopReason": "completed"
}
```

Human-approval/HITL-gated tools are not supported inside the nested Needle loop in this release. Keep those tools directly connected to an n8n Agent so the Agent can surface the approval flow.

### Needle Tool Calling Tool

The **Needle Tool Calling Tool** exposes the same orchestrator as one AI Tool for a parent n8n Agent. Connect the tools Needle may use to its **Tools** input, then connect its **Tool** output to the Agent. Its shared Needle settings are identical to the standalone node, including expression support for **Prompt**, **System Facts**, model settings, confidence, and advanced options. For **Prompt**, you can also click the sparkle button and choose **Let the model define this parameter**. When AI filling is enabled, its configured name and description become the Agent-facing tool schema; fixed prompts are not exposed as Agent arguments. **Tool Name** and **Tool Description** remain fixed because they define how the parent Agent discovers the tool.

Use **Tool Name** and **Tool Description** to tell the parent Agent when to delegate. Each invocation and result is recorded in n8n's AI execution data, and the returned JSON uses the same output contract as the standalone Needle Tool Calling node.

### Needle Text Classifier

The classifier accepts the same core workflow inputs as n8n's Text Classifier: text plus a user-defined list of category names and descriptions. Each category becomes a named main output branch. Needle receives one `classify(text, category)` function whose `category` argument is a grammar-constrained JSON Schema enum—the direct equivalent of Python's `Literal[...]` or `Annotated[str, needle.Field(enum=...)]`. The function description includes every category and its description, and the original item is routed according to the selected literal; no AI model subnode is required.

Enable **Allow Multiple Classes To Be True** to route a copy of the item to every selected category branch. **Minimum Confidence** controls when a result counts as a clear match. A result below the threshold, or a result with no category call, can either be discarded or sent through an extra **Other** branch.

Choose **Custom CACT File** to use a model under `N8N_NEEDLE_MODEL_DIRECTORY`. Enable **Include Tool Calls in Output** to attach a portable synthetic-data record containing the input, generated function schemas, returned calls, and confidence. Once tool-call output is enabled, **Include Metrics** can add runtime and throughput measurements to that same record. By default the record is written to `needleClassification`.

### Needle Sentiment Analysis

The sentiment node analyzes text entirely through the bundled Needle 2 model and routes each item to a **Positive**, **Neutral**, or **Negative** output. It uses Needle's native `classify_sentiment` example schema, which grammar-constrains the model to `positive`, `negative`, `neutral`, or `mixed`; both `neutral` and `mixed` are routed to the **Neutral** output.

The original item is preserved and receives a `sentimentAnalysis.category` field containing the routed category. Enable **Include Detailed Results** to also add `sentimentAnalysis.confidence` and `sentimentAnalysis.strength`; both use Needle's learned confidence score because Needle does not produce a separate sentiment-strength value. No AI model subnode, API key, or network request is required.

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
- Prompts and tool results are never written to Needle runtime logs. Set `N8N_NEEDLE_DEBUG=true` for lifecycle timing only; normal n8n execution data still records Agent Tool inputs and outputs.
- Chained calls share one logical session and execute serially in the order returned by Needle.
- The WASM engine is process-global, so a chained run holds the Needle session lock until its tool loop finishes.

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
