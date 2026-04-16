const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are a data analyst writing a funnel performance report for a medical aesthetics clinic.
You receive funnel metrics JSON and write an analytical report in Brazilian Portuguese markdown.
Use these sections in order:
## Visão Geral
## Trilhas de Atendimento (IA pura / Humano puro / Híbrida)
## Análise do Funil (stage reach and biggest drop-offs)
## Principais Anomalias
## Maior Oportunidade de Conversão
Be specific with numbers from the data. Be direct and concise. No filler text.`;

async function generateReport(metrics, accountId) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = JSON.stringify({ accountId, ...metrics }, null, 2);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input }
    ],
    temperature: 0.3,
    max_tokens: 1500
  });

  return response.choices[0].message.content;
}

module.exports = { generateReport };
