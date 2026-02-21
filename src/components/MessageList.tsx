import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  id:        string;
  role:      'user' | 'assistant' | 'tool' | 'system';
  content:   string;
  toolName?: string;
  isError?:  boolean;
}

interface Props {
  messages:   Message[];
  maxHeight:  number;
}

export function MessageList({ messages, maxHeight }: Props) {
  // Estimate visible rows: each message is at least 2 lines (role + content).
  // We render from newest, going up, until we run out of height.
  const visible: Message[] = [];
  let usedLines = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const lines = m.content.split('\n').length + 2; // +2 for role label + spacing
    if (usedLines + lines > maxHeight) break;
    visible.unshift(m);
    usedLines += lines;
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {visible.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
    </Box>
  );
}

function MessageItem({ message: m }: { message: Message }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>you</Text>
        <Text>{m.content}</Text>
      </Box>
    );
  }

  if (m.role === 'tool') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow" dimColor>⚙ {m.toolName ?? 'tool'}</Text>
        <Text dimColor wrap="truncate-end">{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}</Text>
      </Box>
    );
  }

  if (m.role === 'system') {
    return (
      <Box marginBottom={1}>
        <Text dimColor italic>{m.content}</Text>
      </Box>
    );
  }

  // assistant
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="green" bold>assistant</Text>
      <Text color={m.isError ? 'red' : undefined}>{m.content}</Text>
    </Box>
  );
}
