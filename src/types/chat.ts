export type ChatStatus = 'submitted' | 'streaming' | 'error' | 'ready';

export type FileUIPart = {
  type: 'file';
  url: string;
  mediaType?: string;
  filename?: string;
  id?: string;
};

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

export type ToolUIPart = {
  type: 'tool-invocation';
  toolCallId: string;
  toolName: string;
  state: ToolState;
  input?: any;
  output?: any;
  errorText?: string;
};

export type TextUIPart = {
  type: 'text';
  text: string;
};

export type ReasoningUIPart = {
  type: 'reasoning';
  text: string;
};

export type SourceUIPart = {
  type: 'source-url';
  url: string;
  title?: string;
};

export type ImageUIPart = {
  type: 'image';
  image: string; // base64 or url
  mimeType?: string;
};

export type UIMessagePart =
  | TextUIPart
  | ToolUIPart
  | ReasoningUIPart
  | SourceUIPart
  | ImageUIPart
  | FileUIPart;

export type UIMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'data';
  parts: UIMessagePart[];
  createdAt?: Date;
  content?: string; // For compatibility if needed, but parts are preferred
};

export type LanguageModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export type Experimental_GeneratedImage = {
    image?: string; // base64
    base64?: string;
    uint8Array?: Uint8Array;
    mimeType?: string;
    mediaType?: string;
};
