import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  value:       string;
  onChange:    (v: string) => void;
  onSubmit:    (v: string) => void;
  disabled:    boolean;
}

export function InputBox({ value, onChange, onSubmit, disabled }: Props) {
  return (
    <Box borderStyle="single" borderTop paddingX={1}>
      <Text color="cyan">{disabled ? '⏳' : '›'} </Text>
      {disabled ? (
        <Text dimColor>thinking…</Text>
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="Ask anything… (/eod · /sync · /rules · /projects · /clear)"
        />
      )}
    </Box>
  );
}
