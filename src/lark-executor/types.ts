export interface LarkExecRequest {
  argv: string[];
  timeoutMs?: number;
  expectJson?: boolean;
  cwd?: string;
}

export interface LarkExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: unknown;
}

export interface LarkExecutor {
  run(req: LarkExecRequest): Promise<LarkExecResult>;
}
