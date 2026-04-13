import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const fallbackSummary = (thesis) => {
  const preview = thesis.abstract.split(". ").slice(0, 2).join(". ").trim();
  const focus = thesis.keywords.slice(0, 3).join(", ");

  return `${preview}${preview.endsWith(".") ? "" : "."} Odak alanlari: ${focus}.`;
};

export async function generateSummary(thesis) {
  if (!client) {
    return {
      provider: "fallback",
      summary: fallbackSummary(thesis)
    };
  }

  const completion = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content:
          "You summarize academic theses for mobile browsing. Respond in 2 concise sentences and mention the research contribution."
      },
      {
        role: "user",
        content: `Title: ${thesis.title}
Author: ${thesis.author}
Year: ${thesis.year}
Abstract: ${thesis.abstract}
Keywords: ${thesis.keywords.join(", ")}`
      }
    ]
  });

  return {
    provider: "openai",
    summary: completion.output_text
  };
}
