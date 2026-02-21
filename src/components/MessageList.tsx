import React from "react";
import { Box, Text } from "ink";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: { name: string; result?: string }[];
  timestamp: Date;
}

interface Props {
  messages: Message[];
  terminalWidth: number;
}

function ToolCallLine({ name, result }: { name: string; result?: string }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚙ </Text>
        <Text color="yellow" dimColor>
          {name}
        </Text>
        {!result && <Text color="yellow" dimColor> (running…)</Text>}
      </Box>
      {result && (
        <Box marginLeft={3}>
          <Text color="gray" dimColor>
            {result.split("\n").slice(0, 3).join(" | ").slice(0, 120)}
            {result.split("\n").length > 3 ? "…" : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function AssistantMessage({ content, toolCalls }: Pick<Message, "content" | "toolCalls">) {
  const lines = content.split("\n");
  return (
    <Box flexDirection="column">
      {toolCalls?.map((tc, i) => (
        <ToolCallLine key={i} name={tc.name} result={tc.result} />
      ))}
      {content && (
        <Box flexDirection="column" marginTop={toolCalls?.length ? 1 : 0}>
          {lines.map((line, i) => {
            // Markdown-ish rendering
            if (line.startsWith("## ")) {
              return (
                <Text key={i} bold color="cyan">
                  {line.slice(3)}
                </Text>
              );
            }
            if (line.startsWith("### ")) {
              return (
                <Text key={i} bold color="blue">
                  {line.slice(4)}
                </Text>
              );
            }
            if (line.startsWith("**") && line.endsWith("**")) {
              return (
                <Text key={i} bold>
                  {line.slice(2, -2)}
                </Text>
              );
            }
            if (line.startsWith("- ") || line.startsWith("* ")) {
              return (
                <Box key={i}>
                  <Text color="green"> • </Text>
                  <Text>{line.slice(2)}</Text>
                </Box>
              );
            }
            if (line.startsWith("```")) {
              return <Text key={i} color="gray">─────────────────────</Text>;
            }
            return <Text key={i}>{line}</Text>;
          })}
        </Box>
      )}
    </Box>
  );
}

export function MessageList({ messages, terminalWidth }: Props) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center" marginTop={2}>
        <Text color="gray">No messages yet. Ask me anything about your tickets, PRs, or time.</Text>
        <Text color="gray" dimColor>
          Try: "What tickets am I working on?" or "Show me open PRs"
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((msg) => (
        <Box key={msg.id} flexDirection="column">
          {msg.role === "user" ? (
            <Box>
              <Text color="green" bold>
                You{" "}
              </Text>
              <Text color="gray" dimColor>
                {msg.timestamp.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              <Text>{"\n"}</Text>
              <Text>{msg.content}</Text>
            </Box>
          ) : msg.role === "system" ? (
            <Box>
              <Text color="magenta" dimColor>
                {msg.content}
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Box>
                <Text color="cyan" bold>
                  DevAssist{" "}
                </Text>
                <Text color="gray" dimColor>
                  {msg.timestamp.toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </Box>
              <AssistantMessage content={msg.content} toolCalls={msg.toolCalls} />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
