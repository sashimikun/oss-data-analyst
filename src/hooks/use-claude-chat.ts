import { useState, useCallback } from 'react';
import type { UIMessage, ChatStatus, ToolUIPart } from '@/types/chat';
import { nanoid } from 'nanoid';

export function useClaudeChat() {
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [status, setStatus] = useState<ChatStatus>('ready');
    const [sessionId, setSessionId] = useState<string | undefined>(undefined);

    const sendMessage = useCallback(async (message: { text: string; files?: any[] }, options?: any) => {
        setStatus('submitted');

        // Optimistic user message
        const userMsgId = nanoid();
        const userMessage: UIMessage = {
            id: userMsgId,
            role: 'user',
            parts: [{ type: 'text', text: message.text }, ...(message.files || [])],
            createdAt: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        // Placeholder for assistant message
        const assistantMsgId = nanoid();
        const assistantMessage: UIMessage = {
            id: assistantMsgId,
            role: 'assistant',
            parts: [],
            createdAt: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        setStatus('streaming');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.text,
                    sessionId,
                    model: options?.body?.model
                }),
            });

            if (!response.ok) throw new Error('Network response was not ok');

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No reader available');

            const decoder = new TextDecoder();
            let buffer = '';

            const updateAssistantMessage = (updater: (msg: UIMessage) => UIMessage) => {
                setMessages(prev => {
                    const newMessages = [...prev];
                    const idx = newMessages.findIndex(m => m.id === assistantMsgId);
                    if (idx !== -1) {
                        newMessages[idx] = updater(newMessages[idx]);
                    }
                    return newMessages;
                });
            };

            const handleToolResult = (toolUseId: string, result: any) => {
                 setMessages(prev => {
                    const newMessages = [...prev];
                    for (let i = newMessages.length - 1; i >= 0; i--) {
                        const msg = newMessages[i];
                        if (msg.role === 'assistant') {
                            const partIndex = msg.parts.findIndex(p => p.type === 'tool-invocation' && p.toolCallId === toolUseId);
                            if (partIndex !== -1) {
                                const newParts = [...msg.parts];
                                const part = { ...newParts[partIndex] } as ToolUIPart;

                                part.output = result;
                                part.state = 'output-available';
                                newParts[partIndex] = part;
                                newMessages[i] = { ...msg, parts: newParts };
                                return newMessages;
                            }
                        }
                    }
                    return newMessages;
                });
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        handleSDKEvent(event, updateAssistantMessage, setSessionId, handleToolResult);
                    } catch (e) {
                        console.error('Error parsing JSON:', e);
                    }
                }
            }
            setStatus('ready');
        } catch (error) {
            console.error('Chat error:', error);
            setStatus('error');
        }
    }, [sessionId]);

    const regenerate = useCallback(() => {
        // Not implemented for now
        console.log("Regenerate not implemented");
    }, []);

    return { messages, sendMessage, status, regenerate };
}

function handleSDKEvent(
    event: any,
    updateMsg: (updater: (msg: UIMessage) => UIMessage) => void,
    setSessionId: (id: string) => void,
    handleToolResult: (toolUseId: string, result: any) => void
) {
    if (event.session_id) {
        setSessionId(event.session_id);
    }

    if (event.type === 'stream_event') {
        const streamEvent = event.event;

        if (streamEvent.type === 'content_block_start') {
             const block = streamEvent.content_block;
             if (block.type === 'text') {
                 updateMsg((msg: UIMessage) => ({
                     ...msg,
                     parts: [...msg.parts, { type: 'text', text: block.text }]
                 }));
             } else if (block.type === 'tool_use') {
                 updateMsg((msg: UIMessage) => ({
                     ...msg,
                     parts: [...msg.parts, {
                         type: 'tool-invocation',
                         toolCallId: block.id,
                         toolName: block.name,
                         state: 'input-streaming',
                         input: block.input || {},
                     }]
                 }));
             }
        } else if (streamEvent.type === 'content_block_delta') {
             const index = streamEvent.index;
             const delta = streamEvent.delta;

             updateMsg((msg: UIMessage) => {
                 const newParts = [...msg.parts];
                 const part = newParts[index];

                 if (part && part.type === 'text' && delta.type === 'text_delta') {
                     // We need to handle the case where parts are not 1-to-1 with indices if filtered?
                     // Assuming 1-to-1 mapping for now.
                     // Wait, SDK sends index relative to the message content blocks.
                     // msg.parts corresponds to these blocks.
                     newParts[index] = { ...part, text: part.text + delta.text };
                 } else if (part && part.type === 'tool-invocation' && delta.type === 'input_json_delta') {
                      const currentPartial = (part as any)._partialJson || "";
                      const newPartial = currentPartial + delta.partial_json;
                      (newParts[index] as any)._partialJson = newPartial;

                      // Update input mainly for UI if it tries to show live update
                      // But input needs to be object.
                      // We can leave input as is until stop?
                 }
                 return { ...msg, parts: newParts };
             });
        } else if (streamEvent.type === 'content_block_stop') {
             updateMsg((msg: UIMessage) => {
                 const index = streamEvent.index;
                 const newParts = [...msg.parts];
                 const part = newParts[index];
                 if (part && part.type === 'tool-invocation') {
                     const partialJson = (part as any)._partialJson;
                     if (partialJson) {
                         try {
                             part.input = JSON.parse(partialJson);
                         } catch (e) {
                             // If parsing fails, it might be incomplete or string
                         }
                         part.state = 'input-available'; // Tool is running now?
                         // In Claude SDK, tool runs on server. 'input-available' usually means "ready to call" or "called".
                         // UI shows "Running" for "input-available".
                     }
                 }
                 return { ...msg, parts: newParts };
             });
        }
    } else if (event.type === 'user') {
        const message = event.message;
        if (Array.isArray(message.content)) {
            for (const content of message.content) {
                if (content.type === 'tool_result') {
                    let parsedResult = content.content;
                    if (typeof parsedResult === 'string') {
                         try {
                             parsedResult = JSON.parse(parsedResult);
                         } catch (e) { }
                    } else if (Array.isArray(parsedResult)) {
                        // Extract text from blocks
                        if (parsedResult.length > 0 && parsedResult[0].type === 'text') {
                             try {
                                 parsedResult = JSON.parse(parsedResult[0].text);
                             } catch(e) {
                                 parsedResult = parsedResult[0].text;
                             }
                        }
                    }
                    handleToolResult(content.tool_use_id, parsedResult);
                }
            }
        }
    }
}
