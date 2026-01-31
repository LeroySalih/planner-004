import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

async function listModels() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error("GOOGLE_API_KEY is not set in .env");
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Using direct fetch for listModels if SDK doesn't expose it easily in this version,
    // but genAI.getGenerativeModel is the main entry.
    // Is there a model manager?
    // Checking SDK docs pattern: usually there isn't a direct listModels on the client instance often?
    // Let's try to use the REST API manually if needed, or check if specific import exists.

    // Actually, standard REST call is easier to debug 404s.
    const url =
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log("Models:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error listing models", e);
    }
}

listModels();
