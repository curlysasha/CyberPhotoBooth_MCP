#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MODELS = {
  "edit2_text": {
    name: "Flux Klein",
    description: "Default model. High quality, detailed image generation.",
    default: true,
    ratios: ["1:1", "2:3", "3:4", "5:8", "9:16", "9:19", "9:21", "3:2", "4:3", "8:5", "16:9", "19:9", "21:9"] as const,
  },
  "nano-banana_text": {
    name: "Nano Banana",
    description: "Alternative model. Fast generation, good for quick iterations.",
    default: false,
    ratios: ["1:1", "2:3", "3:4", "4:5", "9:16", "3:2", "4:3", "5:4", "16:9", "21:9"] as const,
  },
} as const;

type ModelMode = keyof typeof MODELS;
const ALL_RATIOS = [...new Set(Object.values(MODELS).flatMap((m) => [...m.ratios]))] as string[];
const RATIO_DESCRIPTIONS: Record<string, string> = {
  "1:1": "Square",
  "2:3": "Portrait (vertical)",
  "3:4": "Portrait (vertical, less tall)",
  "4:5": "Portrait (close to square)",
  "5:8": "Tall portrait",
  "9:16": "Phone screen vertical",
  "9:19": "Extra tall vertical",
  "9:21": "Ultra tall vertical",
  "3:2": "Landscape (classic photo)",
  "4:3": "Landscape (standard)",
  "5:4": "Landscape (close to square)",
  "8:5": "Wide landscape",
  "16:9": "Widescreen",
  "19:9": "Ultra wide",
  "21:9": "Cinematic ultra wide",
};

const PROMPT_SYSTEM = `You help write prompts for Flux Klein image generation model. Prompts are always in English.

## Critical
FLUX.2 [klein] does NOT improve prompts automatically. What you write is exactly what the model gets. Be maximally descriptive.

## Rules
1. Write as prose, NOT comma-separated tags. Describe the scene as flowing text with sentences.
2. Structure: Subject → Setting → Details → Lighting → Atmosphere
3. Lighting is the MOST important element. Describe it like a professional photographer: source, quality, direction, temperature, interaction.
4. Word order matters — put the most important thing first. Main subject → Key action → Style → Context → Secondary details.
5. Include sensory details: textures, reflections, atmospheric elements.
6. Add style/mood annotations at the end when appropriate: "Style: ...", "Mood: ...", "Shot on ..."
7. Every sentence must add visual information — no filler.
8. The prompt must be universal — do NOT mention number of people or gender.
9. Always output the prompt in English.

## Prompt length guide
- Short (10-30 words): quick concepts, style exploration
- Medium (30-80 words): most working tasks
- Long (80-300+ words): complex editorial shoots, detailed product photos

## For image editing (when reference images are involved)
Focus on what should CHANGE, not what things look like. Patterns: "Turn into [style]", "Replace [element] with [new element]", "Add [element] to [location]", "Change [aspect] to [new state]".`;

const API_SUBMIT_URL = "https://api.cyberphotobooth.ru/api/async/submit";
const API_STATUS_URL = "https://api.cyberphotobooth.ru/api/async/status";

const server = new McpServer({
  name: "budka-mcp",
  version: "1.0.0",
});

// Tool: get available models
server.registerTool(
  "get_models",
  {
    title: "Get Models",
    description:
      "Returns the list of available image generation models. Use this when user asks which models are available.",
  },
  async () => {
    const models = Object.entries(MODELS).map(([mode, info]) => ({
      mode,
      name: info.name,
      description: info.description,
      default: info.default,
      supported_ratios: [...info.ratios],
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ models }, null, 2),
        },
      ],
    };
  }
);

// Tool: get available aspect ratios
server.registerTool(
  "get_aspect_ratios",
  {
    title: "Get Aspect Ratios",
    description:
      "Returns the list of available aspect ratios for image generation. Pass a mode to get ratios for a specific model, or omit to see all ratios grouped by model.",
    inputSchema: z.object({
      mode: z
        .enum(["edit2_text", "nano-banana_text"])
        .optional()
        .describe("Model mode. If provided, returns only ratios supported by this model."),
    }),
  },
  async ({ mode }) => {
    if (mode) {
      const model = MODELS[mode];
      const ratios = model.ratios.map((r) => ({ ratio: r, description: RATIO_DESCRIPTIONS[r] ?? r }));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ model: model.name, mode, ratios }, null, 2),
        }],
      };
    }

    const byModel = Object.entries(MODELS).map(([m, info]) => ({
      model: info.name,
      mode: m,
      ratios: info.ratios.map((r) => ({ ratio: r, description: RATIO_DESCRIPTIONS[r] ?? r })),
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ models: byModel }, null, 2),
      }],
    };
  }
);

// Tool: create prompt using the system prompt guidelines
server.registerTool(
  "create_prompt",
  {
    title: "Create Image Prompt",
    description:
      "Generates an optimized English prompt for Flux Klein image generation model based on your description. Describe what you want (theme, style, mood) and get back a well-structured prompt following best practices. The prompt will be universal (no gender/count specifics).",
    inputSchema: z.object({
      description: z
        .string()
        .describe(
          "Describe what you want to generate: theme, style, mood, setting. Can be in any language."
        ),
      length: z
        .enum(["short", "medium", "long"])
        .default("medium")
        .describe(
          "Prompt length: short (10-30 words) for quick concepts, medium (30-80 words) for most tasks, long (80-300 words) for complex scenes"
        ),
    }),
  },
  async ({ description, length }) => {
    const lengthGuide = {
      short: "Write a SHORT prompt (10-30 words). Quick concept, essential details only.",
      medium:
        "Write a MEDIUM prompt (30-80 words). Good balance of detail and conciseness.",
      long: "Write a LONG prompt (80-300 words). Rich detail, complex scene description, detailed lighting and atmosphere.",
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Use the following system instructions to create an image generation prompt.

${PROMPT_SYSTEM}

---

Length requirement: ${lengthGuide[length]}

User request: ${description}

Generate the prompt now. Output ONLY the English prompt text, nothing else.`,
        },
      ],
    };
  }
);

// Tool: check job status
server.registerTool(
  "check_job",
  {
    title: "Check Job Status",
    description:
      "Check the status of a previously submitted image generation job. Use this if generate_image timed out or was interrupted, to retrieve the result without creating a new job.",
    inputSchema: z.object({
      job_id: z
        .string()
        .describe("The job ID returned by generate_image."),
    }),
  },
  async ({ job_id }) => {
    const apiKey = process.env["BUDKA_API_KEY"];
    if (!apiKey) {
      return {
        content: [{ type: "text" as const, text: "Error: BUDKA_API_KEY is not set." }],
        isError: true,
      };
    }

    try {
      const statusRes = await fetch(`${API_STATUS_URL}/${job_id}`, {
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!statusRes.ok) {
        return {
          content: [{ type: "text" as const, text: `Status check failed: ${statusRes.status} ${statusRes.statusText}` }],
          isError: true,
        };
      }

      const data = (await statusRes.json()) as {
        job_id?: string;
        status?: string;
        processing_time_ms?: number;
        results?: { images?: string[]; videos?: string[] };
        s3_urls?: { output?: string[] };
        result?: string[];
      };

      if (data.status === "completed") {
        const images = data.results?.images ?? data.result ?? [];
        const outputUrls = data.s3_urls?.output ?? [];
        const imageUrl = outputUrls[0];
        const base64 = images[0];

        const info = [
          `Job ${job_id}: completed`,
          imageUrl ? `URL: ${imageUrl}` : null,
          data.processing_time_ms ? `Processing: ${(data.processing_time_ms / 1000).toFixed(1)}s` : null,
        ].filter(Boolean).join("\n");

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/jpeg" }> = [
          { type: "text" as const, text: info },
        ];

        if (base64) {
          content.push({ type: "image" as const, data: base64, mimeType: "image/jpeg" as const });
        }

        return { content };
      }

      return {
        content: [{ type: "text" as const, text: `Job ${job_id}: ${data.status ?? "unknown"}\n\nFull response: ${JSON.stringify(data).slice(0, 1000)}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Request failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// Tool: generate image via API
server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generates an image using the Budka (CyberPhotoBooth) API. Async: submits a job then polls for result. Statuses: queued → processing → completed/failed. If timed out or interrupted, use check_job with the job_id to retrieve the result without creating a new job. Requires BUDKA_API_KEY.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "The image generation prompt in English. Use create_prompt tool first to craft an optimal prompt."
        ),
      ratio: z
        .string()
        .default("1:1")
        .describe(
          "Aspect ratio for the generated image. IMPORTANT: supported ratios differ by model. Use get_aspect_ratios(mode) or get_models to check. Flux Klein: 1:1,2:3,3:4,5:8,9:16,9:19,9:21,3:2,4:3,8:5,16:9,19:9,21:9. Nano Banana: 1:1,2:3,3:4,4:5,9:16,3:2,4:3,5:4,16:9,21:9."
        ),
      mode: z
        .enum(["edit2_text", "nano-banana_text"])
        .default("edit2_text")
        .describe(
          "Generation mode. edit2_text (default) — Flux Klein model. nano-banana_text — Nano Banana model, use when specifically requested."
        ),
    }),
  },
  async ({ prompt, ratio, mode }) => {
    const apiKey = process.env["BUDKA_API_KEY"];
    if (!apiKey) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: BUDKA_API_KEY environment variable is not set. Please set it in your MCP server configuration.",
          },
        ],
        isError: true,
      };
    }

    // Validate ratio for selected model
    const modelInfo = MODELS[mode as ModelMode];
    const supportedRatios = modelInfo.ratios as readonly string[];
    if (!supportedRatios.includes(ratio)) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ratio "${ratio}" is not supported by ${modelInfo.name} (${mode}).\n\nSupported ratios: ${supportedRatios.join(", ")}`,
        }],
        isError: true,
      };
    }

    const log: string[] = [];
    const startTime = Date.now();
    const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1);
    const headers = {
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    try {
      // Step 1: Submit async job
      const params: Record<string, string> =
        mode === "nano-banana_text"
          ? { Prompt: prompt, aspect_ratio: ratio }
          : { Prompt: prompt, ratio: ratio };

      const requestBody = {
        mode: mode,
        style: "custom",
        params,
      };

      log.push(`[${new Date().toISOString()}] Request: mode=${mode}, ratio=${ratio}`);
      log.push(`[${elapsed()}s] Submitting async job...`);

      const submitRes = await fetch(API_SUBMIT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!submitRes.ok) {
        const body = await submitRes.text().catch(() => "");
        log.push(`[${elapsed()}s] Submit failed: ${submitRes.status} ${submitRes.statusText}`);
        log.push(`[${elapsed()}s] Body: ${body.slice(0, 500)}`);
        return {
          content: [{ type: "text" as const, text: `Submit error: ${submitRes.status} ${submitRes.statusText}\n\n--- Log ---\n${log.join("\n")}` }],
          isError: true,
        };
      }

      const submitData = (await submitRes.json()) as {
        job_id?: string;
        status?: string;
        estimated_wait_time_seconds?: number;
      };

      const jobId = submitData.job_id;
      if (!jobId) {
        log.push(`[${elapsed()}s] No job_id in response: ${JSON.stringify(submitData)}`);
        return {
          content: [{ type: "text" as const, text: `No job_id returned.\n\n--- Log ---\n${log.join("\n")}` }],
          isError: true,
        };
      }

      log.push(`[${elapsed()}s] Job submitted: ${jobId} (status: ${submitData.status}, ETA: ${submitData.estimated_wait_time_seconds}s)`);

      // Step 2: Poll for result
      const maxPollTime = 360_000; // 6 minutes
      const pollInterval = 3_000; // 3 seconds
      let pollCount = 0;

      while (Date.now() - startTime < maxPollTime) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollCount++;

        const statusRes = await fetch(`${API_STATUS_URL}/${jobId}`, { headers });

        if (!statusRes.ok) {
          log.push(`[${elapsed()}s] Poll #${pollCount} failed: ${statusRes.status}`);
          continue;
        }

        const statusData = (await statusRes.json()) as {
          job_id?: string;
          status?: string;
          processing_time_ms?: number;
          results?: { images?: string[]; videos?: string[] };
          s3_urls?: { output?: string[] };
          result?: string[];
        };

        const status = statusData.status;
        log.push(`[${elapsed()}s] Poll #${pollCount}: ${status}`);

        if (status === "queued" || status === "processing") {
          continue;
        }

        if (status === "failed") {
          log.push(`[${elapsed()}s] Job failed. Response: ${JSON.stringify(statusData).slice(0, 500)}`);
          return {
            content: [{ type: "text" as const, text: `Generation failed.\n\n--- Log ---\n${log.join("\n")}` }],
            isError: true,
          };
        }

        if (status === "completed") {
          const images = statusData.results?.images ?? statusData.result ?? [];
          const outputUrls = statusData.s3_urls?.output ?? [];
          const processingTime = statusData.processing_time_ms ? `${(statusData.processing_time_ms / 1000).toFixed(1)}s` : "unknown";

          log.push(`[${elapsed()}s] Completed! Processing: ${processingTime}, images: ${images.length}, s3_urls: ${outputUrls.length}`);

          const imageUrl = outputUrls[0];
          const base64 = images[0];

          const info = [
            "Image generated successfully!",
            "",
            imageUrl ? `URL: ${imageUrl}` : null,
            `Prompt: ${prompt}`,
            `Ratio: ${ratio}`,
            `Mode: ${mode}`,
            `Job: ${jobId}`,
            `Processing: ${processingTime}`,
            "",
            "--- Log ---",
            ...log,
          ].filter(Boolean).join("\n");

          const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/jpeg" }> = [
            { type: "text" as const, text: info },
          ];

          if (base64) {
            content.push({ type: "image" as const, data: base64, mimeType: "image/jpeg" as const });
          }

          return { content };
        }

        // Unknown status
        log.push(`[${elapsed()}s] Unknown status: ${status}. Response: ${JSON.stringify(statusData).slice(0, 500)}`);
      }

      // Timeout
      log.push(`[${elapsed()}s] TIMEOUT: polling exceeded ${maxPollTime / 1000}s`);
      return {
        content: [{ type: "text" as const, text: `Timeout: generation took too long (>${maxPollTime / 1000}s).\nJob ID: ${jobId}\n\n--- Log ---\n${log.join("\n")}` }],
        isError: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.push(`[${elapsed()}s] Error: ${msg}`);
      return {
        content: [{ type: "text" as const, text: `Request failed: ${msg}\n\n--- Log ---\n${log.join("\n")}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Budka MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
