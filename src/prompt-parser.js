'use strict';

const OpenAI = require('openai');
const cache = require('./cache');

const SYSTEM_PROMPT = `You are a universal sales funnel stage extractor for AI assistants. Your task is to analyze an AI assistant system prompt and extract the sales funnel stages it operates in.

For each stage, you must identify:
1. A short unique code (uppercase, e.g. "SAUDACAO", "QUEIXA", "INVESTIMENTO")
2. Short trigger keywords/phrases (1-5 words) that signal this stage is occurring in a conversation
3. Whether this stage indicates a professional/commercial interaction (true) or a neutral/personal one (false)
4. Whether this stage is considered a final conversion stage in the funnel (true) or not (false)

Rules:
- Extract ONLY keywords that actually appear or are implied by the prompt — no invented terms
- Keywords should be short (1-5 words), never full sentences
- Stages should reflect the actual conversation flow described in the prompt
- "indicates_professional": true for stages involving clinical complaints, procedures, pricing, scheduling, or contact capture
- "indicates_professional": false for neutral stages like greetings or simple acknowledgments
- "is_final_stage": true only for stages that represent the end conversion outcome of the funnel (for example scheduling confirmed, lead captured, sale closed, payment approved)
- "is_final_stage": false for intermediate stages such as greeting, complaint, qualification, objection, pricing, or negotiation unless the prompt clearly treats that stage as the final business goal
- Return between 3 and 12 stages
- Output ONLY valid JSON — no prose, no markdown, no code fences`;

// JSON Schema for OpenAI Structured Outputs
const STAGES_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'funnel_stage_config',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'Unique uppercase stage code, e.g. SAUDACAO, QUEIXA, INVESTIMENTO'
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Short trigger keywords/phrases (1-5 words) that signal this stage'
              },
              indicates_professional: {
                type: 'boolean',
                description: 'True if this stage indicates a professional/commercial interaction'
              },
              is_final_stage: {
                type: 'boolean',
                description: 'True if this stage is a final conversion outcome in the funnel'
              }
            },
            required: ['code', 'keywords', 'indicates_professional', 'is_final_stage'],
            additionalProperties: false
          }
        }
      },
      required: ['stages'],
      additionalProperties: false
    }
  }
};

async function parsePrompt(promptText) {
  const hash = cache.hashPrompt(promptText);
  const cached = cache.get(hash);
  if (cached) return { stageConfig: cached, cacheHit: true, hash };

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: promptText }
    ],
    response_format: STAGES_SCHEMA,
    temperature: 0
  });

  const stageConfig = JSON.parse(response.choices[0].message.content);

  cache.set(hash, stageConfig);
  return { stageConfig, cacheHit: false, hash };
}

module.exports = { parsePrompt };
