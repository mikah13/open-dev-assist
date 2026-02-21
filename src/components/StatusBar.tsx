import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface Props {
  isLoading: boolean;
  activeToolName?: string;
  terminalWidth: number;
  hoursToday?: number;
  targetHours?: number;
}

export function StatusBar({
  isLoading,
  activeToolName,
  terminalWidth,
  hoursToday,
  targetHours = 8,
}: Props) {
  const divider = "─".repeat(terminalWidth);

  const hoursPct = hoursToday !== undefined
    ? Math.min(Math.round((hoursToday / targetHours) * 10), 10)
    : null;
  const hoursBar = hoursPct !== null
    ? `[${"█".repeat(hoursPct)}${"░".repeat(10 - hoursPct)}] ${(hoursToday ?? 0).toFixed(1)}/${targetHours}h`
    : "";

  return (
    <Box flexDirection="column">
      <Text color="gray" dimColor>
        {divider}
      </Text>
      <Box justifyContent="space-between">
        <Box>
          {isLoading ? (
            <Box>
              <Text color="yellow">
                <Spinner type="dots" />
              </Text>
              <Text color="yellow">
                {" "}
                {activeToolName ? `Using ${activeToolName}…` : "Thinking…"}
              </Text>
            </Box>
          ) : (
            <Text color="gray" dimColor>
              Press <Text color="white">Enter</Text> to send ·{" "}
              <Text color="white">Ctrl+C</Text> to quit ·{" "}
              <Text color="white">/eod</Text> for end-of-day ·{" "}
              <Text color="white">/sync</Text> to sync tickets
            </Text>
          )}
        </Box>
        {hoursBar && (
          <Text color={hoursPct !== null && hoursPct >= 10 ? "green" : "yellow"}>
            {hoursBar}
          </Text>
        )}
      </Box>
    </Box>
  );
}
