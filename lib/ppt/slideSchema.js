// ─────────────────────────────────────────────
// WRAITH · lib/ppt/slideSchema.js
// Gemini Structured JSON Output Schema
// ─────────────────────────────────────────────

export const SLIDE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "Main presentation title" },
    subtitle: { type: "STRING", description: "Subtitle or tagline" },
    theme: {
      type: "OBJECT",
      properties: {
        backgroundColor: { type: "STRING", description: "Hex color code without #" },
        primaryTextColor: { type: "STRING", description: "Hex color code without #" },
        accentColor: { type: "STRING", description: "Hex color code without #" },
        cardBackgroundColor: { type: "STRING", description: "Hex color code without #" },
        fontFamily: { type: "STRING", description: "Font name e.g. Arial, Helvetica, Calibri" }
      },
      required: ["backgroundColor", "primaryTextColor", "accentColor", "cardBackgroundColor", "fontFamily"]
    },
    slides: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Slide header title" },
          layout: {
            type: "STRING",
            enum: ["title", "content", "two_column", "summary"],
            description: "Slide structural layout type"
          },
          bullets: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Bullet points for content layout"
          },
          leftColumn: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Bullet points for left column if two_column layout"
          },
          rightColumn: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Bullet points for right column if two_column layout"
          },
          footer: { type: "STRING", description: "Footer text for slide" }
        },
        required: ["title", "layout"]
      }
    }
  },
  required: ["title", "subtitle", "theme", "slides"]
};
