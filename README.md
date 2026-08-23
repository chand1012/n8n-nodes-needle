# n8n-nodes-needle

Run [Cactus Needle 2](https://github.com/cactus-compute/needle) locally in n8n. The package bundles the official WebAssembly engine and default `.cact` model, so inference runs without an API key or network request.

## Nodes

| Node | Use it when | Inputs | Outputs |
| --- | --- | --- | --- |
| **Needle** | You already have function schemas and want Needle to select calls without executing them | Main | Main |
| **Needle Tool Calling** | A workflow should let Needle select and execute connected n8n or MCP tools | Main, required Tools | Main |
| **Needle Tool Calling Tool** | An n8n Agent should delegate tool selection and execution to Needle | Required Tools | Tool |
| **Needle Text Classifier** | Items need to be routed into user-defined category branches | Main | One branch per category, plus optional Other |
| **Needle Sentiment Analysis** | Items need to be routed by positive, neutral, or negative sentiment | Main | Positive, Neutral, Negative |

### Needle

The **Needle** node performs schema-constrained function call selection. It tells you which functions Needle would call and with which arguments, but it does not execute those functions. Use **Needle Tool Calling** instead when the functions are real n8n tools that should run.

#### Connections

- **Main input:** Processes every incoming item independently. Expressions in **Prompt**, **Functions (JSON)**, and other fields are evaluated for that item.
- **Main output:** Returns one result for each input item and preserves n8n item pairing.

#### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| **Model** | Built-In Needle 2 | Uses the bundled model or a custom `.cact` model. |
| **Custom Model Path** | Empty | Absolute path under `N8N_NEEDLE_MODEL_DIRECTORY`. Only shown for a custom model. |
| **Prompt** | `={{ $json.message }}` | Request from which Needle extracts function calls. Plain text and expressions are supported. |
| **Functions (JSON)** | `[]` | Required array of allowed function definitions. At least one function is required. |
| **System Facts** | Empty | Optional facts such as the date, locale, device, or user. Plain text and expressions are supported. |
| **Minimum Confidence** | `0.8` | Score below which the selected **Below Threshold** policy applies. |
| **Below Threshold** | Mark Low Confidence | Controls whether a low-confidence result is marked, returned unchanged, replaced with an empty item, or raised as an error. |
| **Include Metrics** | Off | Adds local runtime, model-load, throughput, and tool-count metrics. |
| **Max New Tokens** | `256` | Maximum tokens Needle may generate, from 1 to 2048. |

The four low-confidence policies are:

- **Mark Low Confidence:** Return the response with `belowThreshold: true`.
- **Return Empty:** Return an empty JSON item.
- **Return Normally:** Return the native response without adding a low-confidence marker.
- **Throw Error:** Stop the node with a confidence error. This can still be handled with n8n's **Continue On Fail** setting.

#### Function schema format

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

Names must be non-empty and `parameters` must be a JSON object. Nested properties, enums, required fields, descriptions, and other JSON Schema constraints are passed to Needle.

#### Output

```json
{
  "type": "call",
  "success": true,
  "error": null,
  "errorCode": null,
  "functionCalls": [
    {
      "name": "get_weather",
      "arguments": { "city": "Boston" }
    }
  ],
  "reasoning": "The user requested current weather for Boston.",
  "confidence": 0.96,
  "belowThreshold": false
}
```

`response` is included when Needle returns natural-language content. `metrics` is included only when enabled. This node declares functions for selection only; it is not an AI Agent tool and has no Tools connector.

### Needle Tool Calling

The **Needle Tool Calling** node converts connected AI tools into Needle schemas, asks Needle which calls are needed, and executes the selected calls locally through n8n. Its default one-step behavior matches the Needle homepage: one inference may select an ordered batch of multiple calls, every call in that batch runs serially, and the node returns the compiled results without an extra inference.

Increase **Max Steps** only for a dependent chain in which a later inference needs the result of an earlier batch, such as creating a record and then using its returned ID.

#### Connections

- **Main input:** Processes every incoming item. This lets the prompt and settings reference upstream JSON with expressions.
- **Tools input:** Required AI Tool connection. Any number of ordinary n8n tools, MCP tools, or toolkits may be connected.
- **Main output:** Returns the Needle response, generated tool schemas, and ordered execution results.

#### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| **Prompt** | Empty | Required request to complete with the connected tools. Plain text and expressions are supported. |
| **Model** | Built-In Needle 2 | Uses the bundled model or a custom `.cact` model. |
| **Custom Model Path** | Empty | Absolute path under `N8N_NEEDLE_MODEL_DIRECTORY`. Only shown for a custom model. |
| **System Facts** | Empty | Optional date, locale, device, user, or other context. Plain text and expressions are supported. |
| **Minimum Confidence** | `0.8` | Stops before side effects when a selected call batch is below this score. |

Advanced controls are hidden under **Options**:

| Option | Default | Description |
| --- | --- | --- |
| **Max Steps** | `1` | Number of tool-call batches Needle may execute, from 1 to 32. A value of 1 still permits multiple calls in the first batch. |
| **Max New Tokens** | `256` | Maximum tokens generated during each Needle inference, from 1 to 2048. |
| **Include Metrics** | Off | Adds metrics to response envelopes. |
| **Detailed Output** | Off | Adds the original query and a complete ordered trace of inference rounds and tool executions. |

#### Connected tool conversion

- Structured Zod and JSON Schema tools retain their argument constraints and descriptions.
- Schema-less string tools receive a required `input` string property.
- Toolkits, including MCP tool collections, are expanded into individual tools.
- Every tool must be callable and have a non-empty, unique name.
- Invalid schemas and duplicate names fail before inference, so no connected tool is executed.
- Tool results must be JSON-serializable. JSON strings are parsed; other strings are preserved as strings.

#### Execution and safety behavior

Calls returned in the same batch execute serially in model order. A low-confidence batch stops before any call in that batch is run. An unknown tool, invalid arguments, invocation error, `undefined` result, or non-serializable result stops immediately with the step, call number, and tool name in the error.

With **Max Steps** above 1, the ordered JSON result array from a completed batch is sent back to the same Needle session. If Needle requests another batch after the configured execution limit, that batch is not executed and `stopReason` is `maxSteps`.

#### Default output

Every output includes:

- Needle's final response envelope.
- `definedTools`, containing the exact generated schemas for copying into a fine-tuning dataset.
- `results`, containing every successful tool result in execution order.
- `stopReason`, which is `completed`, `lowConfidence`, or `maxSteps`.

```json
{
  "type": "call",
  "success": true,
  "error": null,
  "errorCode": null,
  "functionCalls": [
    {
      "name": "create_album",
      "arguments": { "name": "Summer 2026" }
    },
    {
      "name": "move_photos",
      "arguments": {
        "album": "Summer 2026",
        "filter": "last weekend"
      }
    }
  ],
  "reasoning": "Create the album, then move the requested photos.",
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
    },
    {
      "name": "move_photos",
      "description": "Move matching photos into an album",
      "parameters": {
        "type": "object",
        "properties": {
          "album": { "type": "string" },
          "filter": { "type": "string" }
        },
        "required": ["album", "filter"]
      }
    }
  ],
  "results": [{ "albumId": 42 }, { "moved": 8 }],
  "stopReason": "completed"
}
```

The top-level envelope uses the repository's camelCase field names: `errorCode`, `functionCalls`, and `belowThreshold`. `belowThreshold` appears on a low-confidence response. `metrics` appears only when enabled.

With **Detailed Output**, the node also returns `query`, `finalResponse`, and `rounds`. Each round contains `step`, the exact `input` sent to Needle, the model `response`, and `executions`; every execution associates a tool `name` and `arguments` with its `result`.

#### Copying schemas for training

Run the node once with the intended tools connected and copy `definedTools` from its execution output. This is the exact normalized schema array Needle received at runtime, including schemas generated from MCP and Zod tools, so it can be used when preparing a fine-tuning dataset.

#### Limitations

Human-approval/HITL-gated tools are not supported inside the nested Needle loop in this release. Keep those tools directly connected to an n8n Agent so the Agent can surface the approval flow. Because the Needle WASM runtime has process-global session state, chained runs are serialized; a high step limit can therefore delay concurrent executions.

### Needle Tool Calling Tool

The **Needle Tool Calling Tool** wraps the same tool adapter, orchestrator, options, safety checks, output formatter, and chained execution behavior as **Needle Tool Calling**, but supplies them as a single tool to a parent n8n Agent. It is useful when the Agent's chat model should make one simple delegation call and Needle should perform the schema-constrained tool selection.

#### Connections

- **Tools input:** Required. Connect every n8n or MCP tool that Needle may execute.
- **Tool output:** Connect to the **Tool** input of an n8n Agent.
- There is no main workflow connection in normal Agent use. n8n invokes the supplied LangChain tool when the parent Agent selects it.

#### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| **Tool Name** | `needle_tool_calling` | Fixed alphanumeric name exposed to the parent Agent. Expressions and AI filling are intentionally disabled. |
| **Tool Description** | Plan and execute one or more connected tools for the supplied prompt. | Fixed instructions telling the parent Agent when to delegate. Expressions and AI filling are intentionally disabled. |
| **Prompt** | Empty | Request Needle will execute. It may be fixed text, an n8n expression, or a string field filled by the parent Agent. |
| **Model** | Built-In Needle 2 | Uses the bundled model or a custom `.cact` model. |
| **Custom Model Path** | Empty | Absolute path under `N8N_NEEDLE_MODEL_DIRECTORY`. |
| **System Facts** | Empty | Optional context. Like the standalone node, it accepts either a plain string or an expression. |
| **Minimum Confidence** | `0.8` | Stops before executing a low-confidence call batch. |

The **Options** collection is identical to the standalone node: **Max Steps** defaults to 1, **Max New Tokens** defaults to 256, and **Include Metrics** and **Detailed Output** default to off. The parent Agent cannot override these settings.

#### Configuring the Agent input

The Prompt field follows the same n8n experience as other Agent tools:

1. Enter fixed text or an expression when every invocation should use a prompt determined by the workflow.
2. Click the sparkle beside **Prompt** and choose **Let the model define this parameter** when the parent Agent should generate it.
3. Set the AI-filled field's name and description so the parent Agent knows what string to provide.

When Prompt is fixed, the Agent sees a parameterless tool and Needle uses the configured value. When Prompt is AI-filled, the Agent sees exactly one required string property with the configured name and description. Extra bookkeeping fields from n8n are ignored before strict schema validation.

#### Invocation output and observability

The tool returns the same default or detailed result structure as **Needle Tool Calling**, serialized as a JSON string for the parent Agent. Every invocation prompt, output, and error is recorded through n8n's AI tool execution hooks, so the nested run remains visible in execution data.

All connected-tool conversion rules, confidence safeguards, step behavior, serialization requirements, MCP compatibility, and HITL limitations documented for **Needle Tool Calling** also apply here.

### Needle Text Classifier

The **Needle Text Classifier** routes items into categories you define. Each category becomes a named main output. Internally, Needle receives one `classify(text, category)` function whose `category` property is constrained to a JSON Schema enum, and the function description includes every category description.

#### Connections and routing

- **Main input:** Processes every incoming item independently.
- **Category outputs:** One dynamic main output is created for each configured category, in the same order as the category list.
- **Other output:** Added only when **When No Clear Match** is set to the extra Other branch.

The original JSON and binary data are preserved. In multi-class mode, independent copies of the item are sent to every selected category output.

#### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| **Text to Classify** | Empty | Required text. Static text and expressions are supported. |
| **Categories** | Empty | Required list of category names and optional descriptions. At least one non-empty category is required. |
| **Model** | Built-In Needle 2 | Uses the bundled model or a custom `.cact` model. |
| **Custom Model Path** | Empty | Absolute path under `N8N_NEEDLE_MODEL_DIRECTORY`. |

Classifier controls are under **Options**:

| Option | Default | Description |
| --- | --- | --- |
| **Allow Multiple Classes To Be True** | Off | Allows Needle to select more than one category and route a copy to every match. |
| **Include Tool Calls in Output** | Off | Adds a portable synthetic-data record to each routed item. |
| **Include Metrics** | Off | Adds metrics to that synthetic-data record. Only available when tool-call output is enabled. |
| **Max New Tokens** | `256` | Maximum generated tokens, from 1 to 2048. |
| **Minimum Confidence** | `0.3` | Treats lower-confidence results as no clear match. |
| **Tool Calls Output Field** | `needleClassification` | JSON field that receives the synthetic-data record. |
| **When No Clear Match** | Discard Item | Drops the item or routes it through an additional **Other** output. |

#### Optional synthetic-data record

With **Include Tool Calls in Output** enabled, the configured field contains:

```json
{
  "input": "The customer wants a refund",
  "tools": [
    {
      "name": "classify",
      "description": "Classifies text into a category...",
      "parameters": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "category": {
            "type": "string",
            "enum": ["Billing", "Technical Support"]
          }
        },
        "required": ["text", "category"],
        "additionalProperties": false
      }
    }
  ],
  "toolCalls": [
    {
      "name": "classify",
      "arguments": {
        "text": "The customer wants a refund",
        "category": "Billing"
      }
    }
  ],
  "confidence": 0.94,
  "belowThreshold": false
}
```

`metrics` is added to this record only when enabled. The record is designed for inspecting the exact schema and call or collecting synthetic training data; normal branch routing works without it.

### Needle Sentiment Analysis

The **Needle Sentiment Analysis** node analyzes text with the bundled Needle 2 model and routes each item to one of three fixed outputs. It uses Needle's native `classify_sentiment` schema, constrained to `positive`, `negative`, `neutral`, or `mixed`; both `neutral` and `mixed` route to **Neutral**.

#### Connections and parameters

- **Main input:** Processes every incoming item independently.
- **Positive**, **Neutral**, and **Negative** outputs: Receive the original item on the selected branch.
- **Text to Analyze:** Required static text or expression.
- **Options → Include Detailed Results:** Off by default. Adds confidence estimates to the result.

This node always uses the built-in model and does not require a chat model, API key, Tools connection, or custom model path.

#### Output

The routed item preserves its original JSON and binary data and adds:

```json
{
  "sentimentAnalysis": {
    "category": "Positive"
  }
}
```

With detailed results enabled, it also includes `sentimentAnalysis.confidence` and `sentimentAnalysis.strength`. Both currently use Needle's learned confidence score because Needle does not produce a separate sentiment-strength value. These values are model-generated estimates and should be treated as rough indicators, not statistically rigorous measurements.

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
