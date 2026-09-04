import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

export interface LogStepOptions {
  agentRunId: string;
  stepNumber: number;
  actionName: string;
  inputPayload: Record<string, any>;
  outputPayload: Record<string, any>;
  rationale?: string;
}

export class AgentAuditLogger {
  async startRun(options: {
    agentName: string;
    agentVersion: string;
    modelProvider: string;
    modelName: string;
    storyClusterId?: string;
    articleId?: string;
  }): Promise<string> {
    const db = await getDb();
    const [run] = await db
      .insert(schema.agentRuns)
      .values({
        agentName: options.agentName,
        agentVersion: options.agentVersion,
        modelProvider: options.modelProvider,
        modelName: options.modelName,
        storyClusterId: options.storyClusterId,
        articleId: options.articleId,
        status: 'running',
        latencyMs: 0,
      })
      .returning();

    return run.id;
  }

  async logStep(options: LogStepOptions): Promise<void> {
    const db = await getDb();
    await db.insert(schema.agentStepLogs).values({
      agentRunId: options.agentRunId,
      stepNumber: options.stepNumber,
      actionName: options.actionName,
      inputPayload: options.inputPayload,
      outputPayload: options.outputPayload,
      rationale: options.rationale,
    });
  }

  async finishRun(
    runId: string,
    metrics: {
      status: 'success' | 'failed' | 'retrying';
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      errorMessage?: string;
    }
  ): Promise<void> {
    const db = await getDb();
    // Calculate approximate cost for tracking (e.g., Gemini 2.5 Flash: ~$0.075 / 1M prompt, $0.30 / 1M completion)
    const costUsd =
      (metrics.promptTokens * 0.000000075 + metrics.completionTokens * 0.0000003).toFixed(6);

    await db
      .update(schema.agentRuns)
      .set({
        status: metrics.status,
        promptTokens: metrics.promptTokens,
        completionTokens: metrics.completionTokens,
        totalCostUsd: costUsd,
        latencyMs: metrics.latencyMs,
        errorMessage: metrics.errorMessage,
      })
      .where(eq(schema.agentRuns.id, runId));
  }
}
