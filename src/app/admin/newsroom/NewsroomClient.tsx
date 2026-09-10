'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Check, X, Play, RefreshCw, AlertCircle, ExternalLink, CheckCircle2, LogOut } from 'lucide-react';

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
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftArticleItem[]>(initialDrafts);
  const [selectedId, setSelectedId] = useState<string | null>(initialDrafts[0]?.id || null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const selectedDraft = drafts.find((d) => d.id === selectedId) || drafts[0];

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/admin/login');
      router.refresh();
    } catch {
      router.push('/admin/login');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/articles/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setActionStatus('Article successfully approved and published to live feed!');
        setTimeout(() => setActionStatus(null), 4000);
      } else {
        setActionStatus(`Error: ${data.error}`);
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
      } else {
        setActionStatus(`Error: ${data.error}`);
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
        setTimeout(() => router.refresh(), 1000);
      } else {
        setActionStatus(`Pipeline notice: ${data.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionStatus(`Execution error: ${msg}`);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#ffffff] border border-[#d9d9d9]"
        style={{ borderRadius: 0 }}
      >
        <div>
          <h1 className="text-xl font-bold font-display text-[#120424] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1e0a3c]" />
            Newsroom Control Deck
          </h1>
          <p className="text-xs text-[#6e6e6e]">
            Human-in-the-loop review queue for autonomous drafts. No unverified claims allowed.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#ffffff] hover:bg-[#fdfbe4] text-[#120424] border border-[#d9d9d9] text-xs font-bold uppercase tracking-wider font-display transition-colors"
            style={{ borderRadius: 0 }}
          >
            <LogOut className="w-3.5 h-3.5 text-[#1e0a3c]" />
            Sign Out
          </button>

          <button
            onClick={handleRunPipeline}
            disabled={isTriggering}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e0a3c] hover:bg-[#120424] disabled:opacity-50 text-white font-bold text-xs tracking-wider uppercase font-display transition-colors"
            style={{ borderRadius: 0 }}
          >
            {isTriggering ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#d91b74]" />
                Agents Ingesting...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current text-[#d91b74]" />
                Run Autonomous Ingestion
              </>
            )}
          </button>
        </div>
      </div>

      {actionStatus && (
        <div
          className="p-3 bg-[#fdfbe4] border border-[#d9d9d9] text-[#1e0a3c] text-xs font-mono flex items-center gap-2"
          style={{ borderRadius: 0 }}
        >
          <AlertCircle className="w-4 h-4 text-[#d91b74]" />
          {actionStatus}
        </div>
      )}

      {drafts.length === 0 ? (
        <div
          className="p-12 text-center bg-[#ffffff] border border-[#d9d9d9] space-y-3"
          style={{ borderRadius: 0 }}
        >
          <CheckCircle2 className="w-8 h-8 text-[#1e0a3c] mx-auto" />
          <h3 className="text-base font-bold font-display text-[#120424]">Editorial Queue Clear</h3>
          <p className="text-xs text-[#6e6e6e] max-w-sm mx-auto">
            All ingested drafts have been approved or rejected. Click &quot;Run Autonomous Ingestion&quot; to poll primary feeds.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Drafts List Sidebar */}
          <div className="lg:col-span-4 space-y-3">
            <span className="text-xs font-bold font-display text-[#1e0a3c] uppercase tracking-wider block">
              Pending Review ({drafts.length})
            </span>
            <div className="space-y-2">
              {drafts.map((draft) => {
                const isSelected = draft.id === selectedDraft?.id;
                return (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedId(draft.id)}
                    className={`w-full text-left p-3.5 border transition-colors ${
                      isSelected
                        ? 'bg-[#ffffff] border-[#120424]'
                        : 'bg-[#ffffff] border-[#d9d9d9] hover:bg-[#fdfbe4]'
                    }`}
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-[#1e0a3c] font-bold font-mono">
                        {Math.round(parseFloat(draft.confidenceScore) * 100)}% Grounded
                      </span>
                      <span className="text-[#6e6e6e] font-mono">
                        {draft.readingTimeMinutes}m read
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-[#120424] line-clamp-2 leading-snug">
                      {draft.title}
                    </h4>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Draft Inspector */}
          {selectedDraft && (
            <div
              className="lg:col-span-8 p-6 bg-[#ffffff] border border-[#d9d9d9] space-y-6"
              style={{ borderRadius: 0 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] pb-4">
                <div>
                  <span className="text-[11px] text-[#6e6e6e] uppercase tracking-wider font-mono">
                    Plagiarism: {(parseFloat(selectedDraft.nGramMaxSimilarity) * 100).toFixed(1)}% (Limit &lt; 12%)
                  </span>
                  <h2 className="text-lg font-bold font-display text-[#120424] mt-1">{selectedDraft.title}</h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReject(selectedDraft.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#ffffff] hover:bg-[#fdfcf3] text-[#d91b74] border border-[#d91b74] text-xs font-bold uppercase tracking-wider font-display transition-colors"
                    style={{ borderRadius: 0 }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(selectedDraft.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#1e0a3c] hover:bg-[#120424] text-white text-xs font-bold uppercase tracking-wider font-display transition-colors"
                    style={{ borderRadius: 0 }}
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    Approve & Publish
                  </button>
                </div>
              </div>

              {/* Deck */}
              <div
                className="p-3.5 bg-[#fdfbe4] border border-[#d9d9d9] text-xs text-[#120424] italic"
                style={{ borderRadius: 0 }}
              >
                {selectedDraft.deck}
              </div>

              {/* Body Preview */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-[#1e0a3c] uppercase tracking-wider font-display">
                  Synthesized Content Preview
                </span>
                <div
                  className="p-4 bg-[#fdfcf3] border border-[#d9d9d9] text-xs sm:text-sm text-[#120424] leading-relaxed whitespace-pre-line font-mono"
                  style={{ borderRadius: 0 }}
                >
                  {selectedDraft.contentMarkdown}
                </div>
              </div>

              {/* Citations & Evidence Checklist */}
              {selectedDraft.citations && selectedDraft.citations.length > 0 && (
                <div className="space-y-3">
                  <span className="text-xs font-bold text-[#1e0a3c] uppercase tracking-wider font-display">
                    Bound Citations ({selectedDraft.citations.length})
                  </span>
                  <div className="space-y-2">
                    {selectedDraft.citations.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 bg-[#fdfcf3] border border-[#d9d9d9] flex items-center justify-between text-xs"
                        style={{ borderRadius: 0 }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 bg-[#1e0a3c] text-white font-mono flex items-center justify-center font-bold text-[11px]"
                            style={{ borderRadius: 0 }}
                          >
                            [{c.citationIndex}]
                          </span>
                          <span className="font-semibold text-[#120424]">&ldquo;{c.anchorText}&rdquo;</span>
                          <span className="text-[#6e6e6e] font-mono">({c.sourcePublisher})</span>
                        </div>
                        <a
                          href={c.primarySourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#d91b74] hover:underline inline-flex items-center gap-1 font-bold font-display uppercase tracking-wider text-[11px]"
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
