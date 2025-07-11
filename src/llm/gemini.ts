import { GoogleGenAI, Type } from "@google/genai";
import { LLMBase } from "./base";

class GeminiClient extends LLMBase {
    private ai: GoogleGenAI;

    constructor(apiKey: string, model: string, tools?: any[]) {
        super("gemini", model);
        this.ai = new GoogleGenAI({ apiKey });
        if (tools) {
            tools.forEach((tool) => {
                this.addTool(tool);
            });
        }
    }

    protected async _invoke(prompt: string): Promise<string> {
        let currentHistory = [...this.state.history];
        
        // Convert tools to Gemini function declarations
        const functionDeclarations = this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
                type: Type.OBJECT,
                properties: Object.entries(tool.parameters).reduce((acc, [key, value]) => {
                    acc[key] = {
                        type: value.type === "number" ? Type.NUMBER : Type.STRING,
                        description: value.description,
                    };
                    return acc;
                }, {} as any),
                required: Object.keys(tool.parameters),
            },
        }));

        const config = {
            tools: [{
                functionDeclarations
            }]
        };

        let contents: any[] = currentHistory.map((msg) => {
            if (msg.role === "user") return { role: "user", parts: [{ text: msg.content }] };
            if (msg.role === "assistant") return { role: "model", parts: [{ text: msg.content }] };
            if (msg.role === "system") return { role: "system", parts: [{ text: msg.content }] };
            return msg;
        });

        // Loop until no more function calls
        while (true) {
            const result = await this.ai.models.generateContent({
                model: this.model,
                contents,
                config,
            });

            if (result.functionCalls && result.functionCalls.length > 0) {
                // Execute all function calls
                for (const functionCall of result.functionCalls) {
                    const tool = this.tools.find((t) => t.name === functionCall.name);
                    if (!tool) throw new Error(`Tool not found: ${functionCall.name}`);
                    
                    const toolResponse = await tool.execute(functionCall.args || {});
                    
                    // Create function response part
                    const functionResponsePart = {
                        name: functionCall.name || "",
                        response: { result: toolResponse }
                    };

                    // Add the model's response with function call
                    contents.push({
                        role: "model",
                        parts: [{ functionCall } as any]
                    });

                    // Add the function response
                    contents.push({
                        role: "user",
                        parts: [{ functionResponse: functionResponsePart } as any]
                    });

                    // Add to persistent state - only access text if no function calls
                    const responseText = result.functionCalls.length === 0 ? (result.text || "") : "";
                    this.state.history.push({
                        role: "assistant" as const,
                        content: responseText,
                        tool_calls: [{
                            id: functionCall.name || "",
                            function: {
                                name: functionCall.name || "",
                                arguments: JSON.stringify(functionCall.args || {})
                            }
                        }]
                    } as any);

                    this.state.history.push({
                        role: "tool" as const,
                        tool_call_id: functionCall.name || "",
                        content: toolResponse
                    });
                }
            } else {
                // No more function calls, return the final response
                return result.text || "";
            }
        }
    }
}

export function createGeminiClient({
    apiKey,
    model,
    tools,
}: {
    apiKey: string;
    model: string;
    tools?: any[];
}) {
    return new GeminiClient(apiKey, model, tools);
}
