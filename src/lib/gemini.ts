import { GoogleGenAI, Type } from "@google/genai";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export const TIP_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      tip: { type: Type.STRING, description: "A concise water-saving tip." },
      category: { type: Type.STRING, description: "Category of the tip (e.g., Gardening, Indoor, Maintenance)." }
    },
    required: ["tip", "category"]
  }
};

export async function generateWaterSavingTips() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Generate 5 unique, practical, and eco-friendly rainwater harvesting and water-saving tips for a personal tracker app.",
      config: {
        responseMimeType: "application/json",
        responseSchema: TIP_SCHEMA,
      },
    });
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Error generating tips:", error);
    return [
      { tip: "Clean your roof catchment regularly to ensure water quality.", category: "Maintenance" },
      { tip: "Use a first-flush diverter to discard initial contaminated runoff.", category: "Maintenance" }
    ];
  }
}
