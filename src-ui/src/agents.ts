/**
 * Recognition of TUI coding agents from a shell command line. Pure, so
 * main.ts can mark a tab as an agent tab (auto-reopen on restore) without
 * guessing from the terminal title.
 */

/** argv0 -> the command that resumes that agent's last session. */
const AGENT_RESUME: Record<string, string> = {
  opencode: "opencode --continue",
  claude: "claude --continue",
  codex: "codex resume --last",
};

/** Prefixes that wrap the real program without changing what runs. */
const WRAPPERS = new Set(["sudo", "command", "exec", "env", "nice", "time", "doas"]);

/** Agent binaries muis looks for on PATH, in display order. */
export const AGENT_CANDIDATES: readonly string[] = ["opencode", "claude", "codex", "ollama"];

/**
 * Candidates that resolve to an executable, per an injected probe (so this
 * stays testable without Tauri). Probes run in parallel; a probe that throws
 * counts as absent.
 */
export async function availableAgents(
  probe: (command: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    AGENT_CANDIDATES.map(async (command) => {
      try {
        return (await probe(command)) ? command : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((c): c is string => c !== null);
}

/**
 * If `cmd` launches a known TUI coding agent, return the resume command
 * to use when reopening that tab; otherwise null. Only the program
 * (argv0, after wrappers/assignments) is considered, so `cat codex.log`
 * or `git commit -m claude` do not match.
 */
export function agentResumeForCommand(cmd: string | null | undefined): string | null {
  if (!cmd) return null;
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    // Skip leading assignments, wrappers, and wrapper flags (e.g. `sudo -E`).
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(t) || t.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  const prog = tokens[i]?.split("/").pop() ?? "";
  return AGENT_RESUME[prog] ?? null;
}
