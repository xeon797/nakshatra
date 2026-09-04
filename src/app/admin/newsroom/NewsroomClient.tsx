'use client';

import { useState } from 'react';
import { ShieldCheck, Check, X, Play, RefreshCw, AlertCircle, ExternalLink, CheckCircle2 } from 'lucide-react';

interface CitationItem {
  id: string;
  citationIndex: number;
  anchorText: string;
  primarySourceUrl: string;
  sourcePublisher: string;
}

interface DraftArticleItem {
  id: string;
  title: string;
  deck: string;
  slug: string;
  contentMarkdown: string;
  status: string;
  confidenceScore: string;
  nGramMaxSimilarity: string;
  readingTimeMinutes: number;
  createdAt: string;
  citations?: CitationItem[];
}

export default function NewsroomClient({ initialDrafts }: { initialDrafts: DraftArticleItem[] }) {
  const [drafts, setDrafts] = useState<DraftArticleItem[]>(initialDrafts);
  const [selectedId, setSelectedId] = useState<string | null>(initialDrafts[0]?.id || null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const selectedDraft = drafts.find((d) => d.id === selectedId) || drafts[0];

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/articles/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setActionStatus('Article successfully approved and published to live feed!');
        setTimeout(() => setActionStatus(null), 4000);
      }
    } catch {
      setActionStatus('Failed to approve article.');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/articles/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected from newsroom dashboard' }),
      });
      const data = await res.json();
      if (data.success) {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setActionStatus('Article rejected.');
        setTimeout(() => setActionStatus(null), 4000);
      }
    } catch {
      setActionStatus('Failed to reject article.');
    }
  };

  const handleRunPipeline = async () => {
    setIsTriggering(true);
    setActionStatus('Autonomous agents running: polling RSS feeds, extracting claims, and verifying...');
    try {
      const res = await fetch('/api/pipeline/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionStatus('Pipeline execution completed! Refreshing page...');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setActionStatus(`Pipeline notice: ${data.error}`);
      }
    } catch (err: any) {
      setActionStatus(`Execution error: ${err.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Newsroom Control Deck
          </h1>
          <p className="text-xs text-slate-400">
            Human-in-the-loop review queue for autonomous drafts. No unverified claims allowed.
          </p>
        </div>

        <button
          onClick={handleRunPipeline}
          disabled={isTriggering}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs tracking-wider uppercase transition-colors shadow-lg shadow-sky-500/20"
        >
          {isTriggering ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Agents Ingesting...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Autonomous Ingestion
            </>
          )}
        </button>
      </div>

      {actionStatus && (
        <div className="p-3 rounded-lg bg-sky-950/60 border border-sky-800/80 text-sky-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-sky-400" />
          {actionStatus}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="p-12 text-center rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
          <h3 className="text-base font-semibold text-white">Editorial Queue Clear</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            All ingested drafts have been approved or rejected. Click "Run Autonomous Ingestion" to poll primary feeds.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Drafts List Sidebar */}
          <div className="lg:col-span-4 space-y-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Pending Review ({drafts.length})
            </span>
            <div className="space-y-2">
              {drafts.map((draft) => {
                const isSelected = draft.id === selectedDraft?.id;
                return (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedId(draft.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-slate-800/90 border-sky-500/80 shadow-md shadow-sky-500/10'
                        : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-emerald-400 font-medium">
                        {Math.round(parseFloat(draft.confidenceScore) * 100)}% Grounded
                      </span>
                      <span className="text-slate-500 font-mono">
                        {draft.readingTimeMinutes}m read
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-white line-clamp-2 leading-snug">
                      {draft.title}
                    </h4>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Draft Inspector */}
          {selectedDraft && (
            <div className="lg:col-span-8 p-6 rounded-xl bg-slate-900/80 border border-slate-800 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">
                    Plagiarism: {(parseFloat(selectedDraft.nGramMaxSimilarity) * 100).toFixed(1)}% (Limit &lt; 12%)
                  </span>
                  <h2 className="text-lg font-bold text-white mt-1">{selectedDraft.title}</h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReject(selectedDraft.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(selectedDraft.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    Approve & Publish
                  </button>
                </div>
              </div>

              {/* Deck */}
              <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 italic">
                {selectedDraft.deck}
              </div>

              {/* Body Preview */}
              <div className="space-y-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Synthesized Content Preview
                </span>
                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-line font-mono">
                  {selectedDraft.contentMarkdown}
                </div>
              </div>

              {/* Citations & Evidence Checklist */}
              {selectedDraft.citations && selectedDraft.citations.length > 0 && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Bound Citations ({selectedDraft.citations.length})
                  </span>
                  <div className="space-y-2">
                    {selectedDraft.citations.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-mono flex items-center justify-center font-bold">
                            [{c.citationIndex}]
                          </span>
                          <span className="font-semibold text-white">{c.anchorText}</span>
                          <span className="text-slate-400 font-mono">({c.sourcePublisher})</span>
                        </div>
                        <a
                          href={c.primarySourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:underline inline-flex items-center gap-1"
                        >
                          Source Link <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
