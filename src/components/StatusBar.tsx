import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  model:     string;
  servers:   string[];
  tools:     number;
  status:    string;
  loading:   boolean;
}

export function StatusBar({ model, servers, tools, status, loading }: Props) {
  return (
    <Box borderStyle="single" borderBottom flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        <Text color="cyan" bold>devassist</Text>
        <Text dimColor>│</Text>
        <Text color="yellow">{model.split('/').pop()}</Text>
        <Text dimColor>│</Text>
        <Text color="green">{servers.length} servers</Text>
        <Text dimColor>│</Text>
        <Text color="blue">{tools} tools</Text>
      </Box>
      <Box>
        {loading ? (
          <Text color="magenta">{status}</Text>
        ) : (
          <Text dimColor>{status}</Text>
        )}
      </Box>
    </Box>
  );
}
