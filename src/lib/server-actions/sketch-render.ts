"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface RenderSketchResponse {
    success: boolean;
    image?: string; // base64
    error?: string;
}

export async function renderSketchAction(
    base64Image: string,
    prompt: string,
): Promise<RenderSketchResponse> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        return { success: false, error: "GOOGLE_API_KEY is not set" };
    }

    try {
        const ai = new GoogleGenerativeAI(apiKey);
        const model = ai.getGenerativeModel({
            model: "gemini-3-pro-image-preview",
        });

        // Ensure base64 string is just the data (strip prefix if present)
        const imagePart = base64Image.split(",")[1] || base64Image;

        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            inlineData: {
                                data: imagePart,
                                mimeType: "image/jpeg", // Assuming JPEG for now, or we could pass mimeType
                            },
                        },
                        {
                            text:
                                `Render this sketch or photo based on this prompt: ${prompt}`,
                        },
                    ],
                },
            ],
        });

        const response = await result.response;
        // Note: Gemini text generation usually returns text, but for image generation models
        // we often get an image or a link. However, based on the prototype code:
        // "model: 'gemini-3-pro-image-preview'" suggests it might return image data differently.
        // The prototype code wasn't fully visible for the response handling part.
        //
        // Standard Gemini API usually returns text.
        // BUT if this is "gemini-3-pro-image-preview", it's likely experimental or specific.
        // Let's assume standard generateContent response structure for now, but check if it returns
        // inline data or a URI.

        // START OBSERVATION FROM PROTOTYPE:
        // The prototype used `ai.models.generateContent`.
        // Let's assume it returns standard GenerateContentResponse which may contain no text but an image?
        // Actually, usually image generation models (like Imagen) have different APIs.
        // But Gemini multimodal *input* is standard.
        //
        // WAIT: The prompt is "Render this sketch...". This implies image-to-image.
        // If the model output is an image, it might be in `candidates[0].content.parts[0].inlineData`.

        // Let's try to extract basic text first to see if it gives a URL,
        // OR if it gives base64 data.

        // SAFEGUARD: The prototype code showed:
        // `const response = await ai.models.generateContent({...})`
        // It didn't show the extraction.
        // I will log the response to console for debugging if it fails, but for now
        // let's assume it returns standard parts.
        // If it's a true image generation model, it might return `images`?
        // No, GoogleGenerativeAI SDK standardizes on generateContent.

        // Standard approach for experimental image output models:
        // Check parts for inlineData.

        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
            return { success: false, error: "No response from AI models" };
        }

        const firstPart = candidates[0].content.parts[0];

        if (firstPart.inlineData && firstPart.inlineData.data) {
            return {
                success: true,
                image:
                    `data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`,
            };
        }

        // Fallback: maybe it returns markdown with image?
        if (firstPart.text) {
            // If it's just text, maybe it failed to generate image or this model communicates differently.
            // But for "image-preview" model, we expect image.
            // Let's return the text as error or log it.
            console.log(
                "Gemini returned text instead of image:",
                firstPart.text,
            );
            return {
                success: false,
                error: "AI returned text instead of image: " +
                    firstPart.text.substring(0, 100),
            };
        }

        return { success: false, error: "Unexpected response format from AI" };
    } catch (error: any) {
        console.error("Sketch Render Error:", error);
        return {
            success: false,
            error: error.message || "Failed to render sketch",
        };
    }
}
