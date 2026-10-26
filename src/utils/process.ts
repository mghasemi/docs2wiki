import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
  stdinText?: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === "win32" && !/[\\/]/.test(command);
    const proc = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    if (typeof stdinText === "string") {
      proc.stdin?.write(stdinText);
      proc.stdin?.end();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
