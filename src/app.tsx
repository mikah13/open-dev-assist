import React, { useState, useEffect, useCallback } from 'react';
import { Box, useApp, useInput, useStdout } from 'ink';
import { randomUUID } from 'crypto';
import { McpHost }        from './mcp/host.js';
import { Agent }          from './ai/agent.js';
import { StatusBar }      from './components/StatusBar.js';
import { MessageList }    from './components/MessageList.js';
import { InputBox }       from './components/InputBox.js';
import type { Message }   from './components/MessageList.js';
import { config }         from './config.js';

// ─── Slash command expansions ─────────────────────────────────────────────────

const SLASH_COMMANDS: Record<string, string> = {
  '/eod':      'Generate my end-of-day summary: what I worked on today, Harvest hours logged, open PRs and tickets. Then offer to log any untracked time.',
  '/sync':     'Check all recently linked PRs and sync their current state to linked ClickUp tickets using the configured sync rules.',
  '/rules':    'Show me the current PR event → ClickUp status sync rules. Then ask if I want to add or change any.',
  '/projects': 'List all saved project contexts and show which GitHub repos, ClickUp lists, and Harvest projects are associated.',
  '/clear':    '__CLEAR__',
};

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [messages,      setMessages]      = useState<Message[]>([]);
  const [input,         setInput]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [status,        setStatus]        = useState('Starting…');
  const [serverNames,   setServerNames]   = useState<string[]>([]);
  const [toolCount,     setToolCount]     = useState(0);
  const [host,          setHost]          = useState<McpHost | null>(null);
  const [agent,         setAgent]         = useState<Agent | null>(null);
  const [streamBuf,     setStreamBuf]     = useState('');  // accumulate streaming text
  const [streamingId,   setStreamingId]   = useState<string | null>(null);

  // ── Boot: connect MCP servers ────────────────────────────────────────────

  useEffect(() => {
    const boot = async () => {
      const h = new McpHost();
      await h.init((msg) => setStatus(msg));
      setHost(h);
      setAgent(new Agent(h));
      setServerNames(h.serverNames);
      setToolCount(h.tools.length);
      setStatus('ready');

      const bootMsg: Message = {
        id:      randomUUID(),
        role:    'system',
        content: `Connected to ${h.serverNames.length} MCP server(s) · ${h.tools.length} tools available. Type a message or /help for commands.`,
      };
      setMessages([bootMsg]);
    };

    boot().catch((e) => {
      setStatus(`Boot error: ${e}`);
    });

    return () => {
      host?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ctrl+C to quit ───────────────────────────────────────────────────────

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      host?.close().catch(() => {});
      exit();
    }
  });

  // ── Handle submit ────────────────────────────────────────────────────────

  const addMsg = useCallback((m: Message) => setMessages((prev) => [...prev, m]), []);

  const handleSubmit = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || loading || !agent) return;
    setInput('');

    // Slash commands
    if (text.startsWith('/')) {
      const expanded = SLASH_COMMANDS[text.toLowerCase()];
      if (expanded === '__CLEAR__') {
        agent.clearHistory();
        setMessages([{ id: randomUUID(), role: 'system', content: 'Conversation cleared.' }]);
        return;
      }
      if (expanded) {
        // Re-submit with expanded prompt
        handleSubmit(expanded);
        return;
      }
      if (text === '/help') {
        addMsg({
          id: randomUUID(), role: 'system',
          content: [
            '/eod      — end-of-day summary + Harvest logging',
            '/sync     — sync PR states → ClickUp ticket statuses',
            '/rules    — view/manage sync rules',
            '/projects — view saved project contexts',
            '/clear    — clear conversation history',
            'Ctrl+C    — quit',
          ].join('\n'),
        });
        return;
      }
    }

    // Normal message
    addMsg({ id: randomUUID(), role: 'user', content: text });
    setLoading(true);
    setStatus('thinking…');

    // Prepare streaming assistant message
    const assistantId = randomUUID();
    setStreamingId(assistantId);
    setStreamBuf('');
    addMsg({ id: assistantId, role: 'assistant', content: '' });

    await agent.chat(text, {
      onToken: (token) => {
        setStreamBuf((prev) => {
          const next = prev + token;
          setMessages((msgs) =>
            msgs.map((m) => (m.id === assistantId ? { ...m, content: next } : m)),
          );
          return next;
        });
      },
      onToolStart: (name) => {
        setStatus(`⚙ ${name}…`);
        addMsg({ id: randomUUID(), role: 'tool', toolName: name, content: 'calling…' });
      },
      onToolEnd: (name, result) => {
        setMessages((msgs) => {
          const copy = [...msgs];
          // Update the last tool message with the result snippet
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]!.role === 'tool' && copy[i]!.toolName === name && copy[i]!.content === 'calling…') {
              copy[i] = { ...copy[i]!, content: result.slice(0, 300) + (result.length > 300 ? '…' : '') };
              break;
            }
          }
          return copy;
        });
      },
      onError: (msg) => {
        setMessages((msgs) =>
          msgs.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${msg}`, isError: true } : m,
          ),
        );
      },
    });

    setStreamingId(null);
    setStreamBuf('');
    setLoading(false);
    setStatus('ready');
  }, [loading, agent, addMsg]);

  // ── Render ───────────────────────────────────────────────────────────────

  const rows      = stdout.rows    ?? 24;
  const listHeight = Math.max(4, rows - 5);  // leave room for status bar + input

  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar
        model={config.openrouter.model}
        servers={serverNames}
        tools={toolCount}
        status={status}
        loading={loading}
      />
      <MessageList messages={messages} maxHeight={listHeight} />
      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={loading}
      />
    </Box>
  );
}
