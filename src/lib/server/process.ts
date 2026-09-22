import { spawn } from "node:child_process";

export function runProcess(executable: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error("Media processing timed out."); child.kill(); }, timeoutMs);
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 16 * 1024 * 1024) { failure = new Error("Media output exceeded the limit."); child.kill(); }
    });
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16_000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(stderr || `Media process exited with code ${code}.`));
      else resolve(stdout);
    });
  });
}
