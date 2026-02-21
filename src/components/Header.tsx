import React from "react";
import { Box, Text } from "ink";

interface Props {
  terminalWidth: number;
}

export function Header({ terminalWidth }: Props) {
  const title = "  DevAssist — AI Workspace  ";
  const subtitle = "ClickUp · GitHub · Harvest";
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Box>
          <Text backgroundColor="cyan" color="black" bold>
            {title}
          </Text>
          <Text color="gray" dimColor>
            {" "}
            {subtitle}
          </Text>
        </Box>
        <Text color="gray" dimColor>
          {date}
        </Text>
      </Box>
      <Text color="gray" dimColor>
        {"─".repeat(terminalWidth)}
      </Text>
    </Box>
  );
}
