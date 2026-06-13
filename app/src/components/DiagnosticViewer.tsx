import { Terminal, Trash2, Cpu, Server } from 'lucide-react'
import type { SimLog } from '../App'
import { useState, useEffect } from 'react'

interface DiagnosticViewerProps {
  logs: SimLog[];
  onClear: () => void;
}

export default function DiagnosticViewer({ logs, onClear }: DiagnosticViewerProps) {
  const [activeConsole, setActiveConsole] = useState<'simulator' | 'vlm'>('simulator')
  const [vlmLogs, setVlmLogs] = useState<SimLog[]>([])
  const [filter, setFilter] = useState<string>('all')

  // Reset filter when switching between consoles
  useEffect(() => {
    setFilter('all')
  }, [activeConsole])

  // Poll VLM server logs when the VLM tab is active
  useEffect(() => {
    if (activeConsole !== 'vlm') return;

    const fetchVlmLogs = () => {
      fetch('/api/vlm-logs')
        .then(res => {
          if (!res.ok) throw new Error('API status error');
          return res.json();
        })
        .then(data => {
          if (Array.isArray(data)) {
            setVlmLogs(data);
          }
        })
        .catch(err => {
          console.error('Failed to fetch VLM logs:', err);
        });
    };

    fetchVlmLogs();
    const interval = setInterval(fetchVlmLogs, 2000);
    return () => clearInterval(interval);
  }, [activeConsole]);

  const activeLogs = activeConsole === 'simulator' ? logs : vlmLogs

  const filteredLogs = activeLogs.filter(l => {
    if (filter === 'all') return true
    return l.stream === filter
  })

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-xl">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Diagnostic Logs</h2>
            <p className="text-sm text-slate-500">Prune, monitor, and query simulator stdout, stderr, and network publisher channels</p>
          </div>
        </div>

        <div className="flex gap-2">
          {/* Stream Filter */}
          {activeConsole === 'simulator' ? (
            <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-lg p-1 text-xs">
              <button 
                onClick={() => setFilter('all')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'all' ? 'bg-slate-800 text-slate-200 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                All
              </button>
              <button 
                onClick={() => setFilter('system')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'system' ? 'bg-[#004B87]/15 text-[#3B9CFF] font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                System
              </button>
              <button 
                onClick={() => setFilter('stdout')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'stdout' ? 'bg-emerald-950/40 text-emerald-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Stdout
              </button>
              <button 
                onClick={() => setFilter('stderr')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'stderr' ? 'bg-red-950/40 text-red-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Stderr
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-lg p-1 text-xs">
              <button 
                onClick={() => setFilter('all')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'all' ? 'bg-slate-800 text-slate-200 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                All
              </button>
              <button 
                onClick={() => setFilter('vlm-stdout')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'vlm-stdout' ? 'bg-emerald-950/40 text-emerald-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                VLM Out
              </button>
              <button 
                onClick={() => setFilter('vlm-stderr')}
                className={`px-2.5 py-1 rounded transition-all font-mono uppercase ${
                  filter === 'vlm-stderr' ? 'bg-red-950/40 text-red-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                VLM Err
              </button>
            </div>
          )}

          {/* Clear Logs Button */}
          {activeConsole === 'simulator' && (
            <button 
              onClick={onClear}
              className="interactive-button-secondary text-xs py-1.5 px-3"
              title="Prune Diagnostic Logs Archive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear Logs</span>
            </button>
          )}
        </div>
      </div>

      {/* Console Tab Selector */}
      <div className="flex border-b border-slate-800 gap-4">
        <button
          onClick={() => setActiveConsole('simulator')}
          className={`flex items-center gap-2 pb-2.5 text-xs font-semibold uppercase tracking-wider transition-all relative ${
            activeConsole === 'simulator' 
              ? 'text-slate-200 border-b-2 border-[#004B87]' 
              : 'text-slate-500 hover:text-slate-400'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>Simulator Console</span>
        </button>
        <button
          onClick={() => setActiveConsole('vlm')}
          className={`flex items-center gap-2 pb-2.5 text-xs font-semibold uppercase tracking-wider transition-all relative ${
            activeConsole === 'vlm' 
              ? 'text-slate-200 border-b-2 border-[#004B87]' 
              : 'text-slate-500 hover:text-slate-400'
          }`}
        >
          <Server className="h-3.5 w-3.5" />
          <span>VLM Inference Server (Garnet)</span>
        </button>
      </div>

      {/* Terminal Viewport console */}
      <div className="glass-panel p-6 bg-slate-950/80 border-slate-900 overflow-hidden flex flex-col h-[520px]">
        <div className="flex items-center gap-1.5 border-b border-slate-900 pb-3 mb-4 shrink-0">
          <span className="h-3 w-3 rounded-full bg-red-500/80"></span>
          <span className="h-3 w-3 rounded-full bg-amber-500/80"></span>
          <span className="h-3 w-3 rounded-full bg-emerald-500/80"></span>
          <span className="text-[10px] text-slate-600 font-mono ml-3">
            {activeConsole === 'simulator' 
              ? '/bin/bash - biologger-sim telemetry publisher logs' 
              : 'ssh lhzn@garnet.localdomain - tail mlx-vlm-server logs'
            }
          </span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-xs space-y-2.5 pr-2">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((l, index) => {
              let streamBadge = 'SYS'
              let textClass = 'text-slate-300'
              let badgeClass = 'bg-slate-900/60 text-slate-400 border-slate-800'

              if (l.stream === 'stdout') {
                streamBadge = 'OUT'
                textClass = 'text-emerald-400/90'
                badgeClass = 'bg-emerald-950/40 text-emerald-400 border-emerald-900/40'
              } else if (l.stream === 'stderr') {
                streamBadge = 'ERR'
                textClass = 'text-red-400'
                badgeClass = 'bg-red-950/40 text-red-400 border-red-900/40'
              } else if (l.stream === 'system') {
                streamBadge = 'SYS'
                textClass = 'text-[#3B9CFF]/90'
                badgeClass = 'bg-[#004B87]/15 text-[#3B9CFF] border-[#004B87]/30'
              } else if (l.stream === 'vlm-stdout') {
                streamBadge = 'VLM-OUT'
                textClass = 'text-emerald-400/90'
                badgeClass = 'bg-emerald-950/30 text-emerald-400/90 border-emerald-900/30'
              } else if (l.stream === 'vlm-stderr') {
                streamBadge = 'VLM-ERR'
                textClass = 'text-amber-400/90'
                badgeClass = 'bg-amber-950/30 text-amber-400/90 border-amber-900/30'
              }

              return (
                <div key={index} className="flex items-start gap-3.5 hover:bg-slate-900/20 py-1 px-1.5 rounded transition-all">
                  <span className="text-slate-600 select-none shrink-0">{l.timestamp}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border tracking-wider shrink-0 uppercase ${badgeClass}`}>
                    {streamBadge}
                  </span>
                  <span className={`leading-relaxed whitespace-pre-wrap ${textClass}`}>
                    {l.message}
                  </span>
                </div>
              )
            })
          ) : (
            <div className="h-full flex items-center justify-center text-slate-600 italic select-none">
              No diagnostic log streams logged under filter: {filter}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
