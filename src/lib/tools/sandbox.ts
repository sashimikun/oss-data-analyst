import { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

const execAsync = promisify(exec);

export interface SandboxInstance {
  sandbox: Sandbox;
  stop: () => Promise<void>;
}

// Local implementation of Sandbox interface
class LocalSandbox {
  async exec(command: string) {
    console.log(`[LocalSandbox] Executing: ${command}`);
    try {
      const { stdout, stderr } = await execAsync(command);
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.code || 1
      };
    }
  }

  async upload(path: string, content: string | Buffer) {
    console.log(`[LocalSandbox] Uploading to: ${path}`);
    const fullPath = join(process.cwd(), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  async download(path: string) {
    console.log(`[LocalSandbox] Downloading from: ${path}`);
    const fullPath = join(process.cwd(), path);
    return await readFile(fullPath, 'utf-8');
  }

  async stop() {
    // No-op
  }

  // Property to satisfy bash-tool's duck-typing for JustBash
  get fs() {
    return {
      writeFile: this.upload.bind(this),
      readFile: this.download.bind(this),
    };
  }
}

/**
 * Creates a sandbox for executing commands.
 * Returns the sandbox instance and a stop function for cleanup.
 */
export async function createSandbox(): Promise<SandboxInstance> {
  // Use LocalSandbox in development or if explicitly requested
  const useLocal = process.env.USE_LOCAL_SANDBOX === "true" || process.env.NODE_ENV === "development";

  if (useLocal) {
    console.log("Using Local Sandbox");
    const sandbox = new LocalSandbox();
    return {
      sandbox: sandbox as unknown as Sandbox,
      stop: async () => sandbox.stop(),
    };
  }

  console.log("Using Vercel Sandbox");
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: ms("45m"),
  });

  return {
    sandbox,
    stop: async () => sandbox.stop(),
  };
}
