#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:4",
  "5:8",
  "9:16",
  "9:19",
  "9:21",
  "3:2",
  "4:3",
  "8:5",
  "16:9",
  "19:9",
  "21:9",
] as const;

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

const API_URL = "https://api.cyberphotobooth.ru/api/handler";

const server = new McpServer({
  name: "budka-mcp",
  version: "1.0.0",
});

// Tool: get available aspect ratios
server.registerTool(
  "get_aspect_ratios",
  {
    title: "Get Aspect Ratios",
    description:
      "Returns the list of available aspect ratios for image generation. Use this before generate_image to know which ratios are supported.",
  },
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              aspect_ratios: ASPECT_RATIOS,
              description: {
                "1:1": "Square",
                "2:3": "Portrait (vertical)",
                "3:4": "Portrait (vertical, less tall)",
                "5:8": "Tall portrait",
                "9:16": "Phone screen vertical",
                "9:19": "Extra tall vertical",
                "9:21": "Ultra tall vertical",
                "3:2": "Landscape (classic photo)",
                "4:3": "Landscape (standard)",
                "8:5": "Wide landscape",
                "16:9": "Widescreen",
                "19:9": "Ultra wide",
                "21:9": "Cinematic ultra wide",
              },
            },
            null,
            2
          ),
        },
      ],
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

// Tool: generate image via API
server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generates an image using the Budka (CyberPhotoBooth) API with Flux Klein model. Returns the image URL. Requires BUDKA_API_KEY environment variable.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "The image generation prompt in English. Use create_prompt tool first to craft an optimal prompt."
        ),
      ratio: z
        .enum(ASPECT_RATIOS)
        .default("1:1")
        .describe(
          "Aspect ratio for the generated image. Use get_aspect_ratios to see all options."
        ),
    }),
  },
  async ({ prompt, ratio }) => {
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

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "edit2_text",
          post_delivery: "false",
          style: "custom",
          params: {
            Prompt: prompt,
            ratio: ratio,
          },
        }),
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `API error: ${response.status} ${response.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const data = (await response.json()) as {
        result?: string[];
        s3_urls?: { output?: string[] };
      };

      const outputUrls = data.s3_urls?.output ?? [];
      const base64Results = data.result ?? [];

      if (outputUrls.length > 0) {
        const imageUrl = outputUrls[0]!;
        return {
          content: [
            {
              type: "text" as const,
              text: `Image generated successfully!\n\nURL: ${imageUrl}\n\nPrompt used: ${prompt}\nAspect ratio: ${ratio}`,
            },
            {
              type: "image" as const,
              data: base64Results[0] ?? "",
              mimeType: "image/jpeg" as const,
            },
          ],
        };
      }

      if (base64Results.length > 0) {
        return {
          content: [
            {
              type: "image" as const,
              data: base64Results[0]!,
              mimeType: "image/jpeg" as const,
            },
            {
              type: "text" as const,
              text: `Image generated successfully!\n\nPrompt used: ${prompt}\nAspect ratio: ${ratio}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `API returned no image data. Raw response: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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
