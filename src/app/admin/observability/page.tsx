import { initializeDatabase } from '../../../db/init';
import { getDb } from '../../../db';
import * as schema from '../../../db/schema';
import { desc } from 'drizzle-orm';
import { Activity, Clock, Cpu, Coins, CheckCircle2, XCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ObservabilityPage() {
  await initializeDatabase();
  const db = await getDb();

  const runs = await db
    .select()
    .from(schema.agentRuns)
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(50);

  const stepLogs = await db
    .select()
    .from(schema.agentStepLogs)
    .orderBy(desc(schema.agentStepLogs.createdAt))
    .limit(100);

  const totalPromptTokens = runs.reduce((sum, r) => sum + r.promptTokens, 0);
  const totalCompletionTokens = runs.reduce((sum, r) => sum + r.completionTokens, 0);
  const avgLatency = runs.length > 0 ? Math.round(runs.reduce((sum, r) => sum + r.latencyMs, 0) / runs.length) : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Activity className="w-6 h-6 text-purple-400" />
          Autonomous Agent Observability & Telemetry
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Full execution traces, token consumption, reasoning steps, and audit logs for all NAKSHATRA agents.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            Total Agent Executions
          </span>
          <div className="text-2xl font-extrabold text-white font-mono">{runs.length}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            Prompt / Completion Tokens
          </span>
          <div className="text-2xl font-extrabold text-white font-mono">
            {totalPromptTokens.toLocaleString()} / {totalCompletionTokens.toLocaleString()}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            Average Latency
          </span>
          <div className="text-2xl font-extrabold text-white font-mono">{avgLatency} ms</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Primary AI Architecture
          </span>
          <div className="text-lg font-bold text-white font-mono">Google Gemini</div>
        </div>
      </div>

      {/* Agent Run Traces Table */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-white">Live Execution Traces</h2>

        {runs.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-slate-950/40 border border-slate-800 text-slate-400 text-xs">
            No agent runs logged yet. Execute an autonomous ingestion cycle to view live traces.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/60">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3">Agent</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Prompt / Compl. Tokens</th>
                    <th className="p-3">Latency</th>
                    <th className="p-3">Cost (USD)</th>
                    <th className="p-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {runs.map((r) => {
                    const isSuccess = r.status === 'success';
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="p-3 font-semibold text-white font-mono">{r.agentName}</td>
                        <td className="p-3 text-slate-300 font-mono text-[11px]">{r.modelName}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isSuccess
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {isSuccess ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            {r.status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 font-mono">
                          {r.promptTokens} / {r.completionTokens}
                        </td>
                        <td className="p-3 text-slate-300 font-mono">{r.latencyMs} ms</td>
                        <td className="p-3 text-slate-300 font-mono">${r.totalCostUsd}</td>
                        <td className="p-3 text-slate-500 font-mono">
                          {new Date(r.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Step Logs Telemetry */}
      {stepLogs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-white">Recent Reasoning & Action Payloads</h2>
          <div className="space-y-3">
            {stepLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="font-bold text-sky-400">Action: {log.actionName}</span>
                  <span className="text-slate-500">Step #{log.stepNumber}</span>
                </div>
                {log.rationale && (
                  <p className="text-slate-300 italic">
                    <span className="text-slate-400 not-italic font-semibold">Rationale: </span>
                    {log.rationale}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-[11px] font-mono">
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800/80 overflow-x-auto">
                    <span className="text-slate-400 block mb-1 font-sans font-semibold">Input Payload:</span>
                    <pre className="text-slate-300">{JSON.stringify(log.inputPayload, null, 2)}</pre>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800/80 overflow-x-auto">
                    <span className="text-slate-400 block mb-1 font-sans font-semibold">Output Payload:</span>
                    <pre className="text-slate-300">{JSON.stringify(log.outputPayload, null, 2)}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
