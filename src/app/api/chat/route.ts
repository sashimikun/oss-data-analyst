export const runtime = "nodejs";

import { runAgent } from "@/lib/agent";

export async function POST(req: Request) {
  try {
    const { message, sessionId, model } = await req.json();

    const stream = await runAgent({ message, sessionId, model });

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + "\n"));
          }
          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: any) {
    console.error("API error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
