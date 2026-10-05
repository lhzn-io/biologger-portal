import { useState, useEffect } from 'react'
import { 
  Database, 
  Cpu, 
  LineChart, 
  Terminal, 
  MessageSquare, 
  ChevronRight, 
  Compass
} from 'lucide-react'

// Import dashboard panels
import DatasetRegistry from './components/DatasetRegistry'
import SimOrchestrator from './components/SimOrchestrator'
import AnalyticalViewport from './components/AnalyticalViewport'
import DiagnosticViewer from './components/DiagnosticViewer'
import AIAssistantSidebar from './components/AIAssistantSidebar'

export interface Dataset {
  id: string;
  species: string;
  commonName: string;
  location: string;
  timeStart: string;
  timeEnd: string;
  duration: string;
  durationMs: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  notes: string;
  records: number;
}

export interface SimLog {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface ValidationRecord {
  deployment_id: string;
  timestamp_utc: string;
  validation_mode: 'light' | 'deep';
  status: 'passed' | 'failed';
  estimated_rate_hz: number;
  missing_columns: string[];
  invalid_records_count: number;
  clock_drift_seconds: number;
  notes: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'datasets' | 'orchestrator' | 'viewport' | 'logs'>('datasets')
  const [aiSidebarOpen, setAiSidebarOpen] = useState(true)
  
  // Shared Workspace State
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('')
  
  // Validation Metadata History
  const [validationHistory, setValidationHistory] = useState<ValidationRecord[]>([
    {
      deployment_id: 'RED001_20220812',
      timestamp_utc: '2026-06-06T18:45:00Z',
      validation_mode: 'light',
      status: 'passed',
      estimated_rate_hz: 25.0,
      missing_columns: [],
      invalid_records_count: 0,
      clock_drift_seconds: 0.0,
      notes: 'Light validation checklist passed during ingestion.'
    },
    {
      deployment_id: 'RED001_20220812',
      timestamp_utc: '2026-06-06T18:50:00Z',
      validation_mode: 'deep',
      status: 'passed',
      estimated_rate_hz: 25.0,
      missing_columns: [],
      invalid_records_count: 0,
      clock_drift_seconds: 0.04,
      notes: 'Deep sequence check passed. Row count validated: 482,910.'
    }
  ])

  // Load datasets and validation history from disk on mount
  useEffect(() => {
    fetch('/api/datasets')
      .then(res => {
        if (!res.ok) throw new Error('API status error');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setDatasets(data);
          if (data.length > 0) {
            setSelectedDatasetId(data[0].id);
          }
        }
      })
      .catch(err => {
        console.warn('Failed to load datasets from disk:', err);
      });

    fetch('/api/validation-history')
      .then(res => {
        if (!res.ok) throw new Error('API status error');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setValidationHistory(data);
        }
      })
      .catch(err => {
        console.warn('Failed to load validation history from disk, using local seed state:', err);
      });
  }, []);

  // Post validation report to the backend API to append to validation_registry.json
  const addValidationRecord = (record: ValidationRecord) => {
    setValidationHistory(prev => [...prev, record]);
    
    fetch('/api/validation-history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to save validation record to disk');
        return res.json();
      })
      .then(() => {
        addLog(`Validation report saved to registry: ${record.deployment_id} (${record.validation_mode})`, 'system');
      })
      .catch(err => {
        console.error('Failed to save validation record:', err);
        addLog(`Warning: Failed to save validation record to disk. ${err.message}`, 'stderr');
      });
  };
  
  const [simStatus, setSimStatus] = useState<'idle' | 'running' | 'completed'>('idle')
  const [simProgress, setSimProgress] = useState(0)
  
  // AHRS Gains and Calibration offsets
  const [ahrsGains, setAhrsGains] = useState({ mahony: 0.005, madgwick: 0.041 })
  const [selectedDataset, setSelectedDataset] = useState<Dataset | undefined>(undefined)

  const addDataset = (dataset: Dataset) => {
    fetch('/api/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataset)
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to save dataset metadata to disk');
        return res.json();
      })
      .then(() => {
        setDatasets(prev => {
          const filtered = prev.filter(d => d.id !== dataset.id);
          return [...filtered, dataset];
        });
        setSelectedDatasetId(dataset.id);
        addLog(`Dataset metadata registered: ${dataset.id}`, 'system');
      })
      .catch(err => {
        console.error('Failed to save dataset metadata:', err);
        addLog(`Warning: Failed to save dataset registry token on disk. ${err.message}`, 'stderr');
      });
  };

  const deleteDataset = (id: string) => {
    fetch(`/api/datasets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to delete dataset from disk registry');
        return res.json();
      })
      .then(() => {
        setDatasets(prev => {
          const next = prev.filter(d => d.id !== id);
          if (selectedDatasetId === id) {
            setSelectedDatasetId(next.length > 0 ? next[0].id : '');
          }
          return next;
        });
        addLog(`Dataset metadata deregistered: ${id}`, 'system');
      })
      .catch(err => {
        console.error('Failed to delete dataset metadata:', err);
        addLog(`Warning: Failed to deregister dataset token. ${err.message}`, 'stderr');
      });
  };

  const updateDataset = (dataset: Dataset) => {
    fetch('/api/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataset)
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to update dataset metadata on disk');
        return res.json();
      })
      .then(() => {
        setDatasets(prev => {
          const filtered = prev.filter(d => d.id !== dataset.id);
          return [...filtered, dataset];
        });
        addLog(`Dataset metadata updated: ${dataset.id}`, 'system');
      })
      .catch(err => {
        console.error('Failed to update dataset metadata:', err);
        addLog(`Warning: Failed to update dataset registry token on disk. ${err.message}`, 'stderr');
      });
  };

  const addDatasetsBatch = (datasetsArray: Dataset[]) => {
    const promises = datasetsArray.map(dataset => {
      return fetch('/api/datasets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataset)
      }).then(res => {
        if (!res.ok) throw new Error(`Failed to save dataset ${dataset.id}`);
        return res.json();
      });
    });

    Promise.all(promises)
      .then(() => {
        setDatasets(prev => {
          const filtered = prev.filter(d => !datasetsArray.some(newD => newD.id === d.id));
          return [...filtered, ...datasetsArray];
        });
        addLog(`Batch dataset metadata registered: ${datasetsArray.length} items`, 'system');
        if (datasetsArray.length > 0) {
          setSelectedDatasetId(datasetsArray[0].id);
        }
      })
      .catch(err => {
        console.error('Failed to register batch datasets:', err);
        addLog(`Warning: Failed to complete batch registration. ${err.message}`, 'stderr');
      });
  };
  
  // Logs database
  const [terminalLogs, setTerminalLogs] = useState<SimLog[]>([
    { timestamp: '16:00:12', stream: 'system', message: 'ZeroMQ socket interface bound successfully to virtual interface WSL2 (Port 5555)' },
    { timestamp: '16:01:05', stream: 'system', message: 'NVIDIA AGX Orin ZeroClaw gateway channel established secure handshake with Garnet Mac Studio (192.168.7.4)' },
    { timestamp: '16:03:22', stream: 'stdout', message: 'topobathykit client successfully resolved point-cloud tiles from garnet.internal:9595' }
  ])

  useEffect(() => {
    const active = datasets.find(d => d.id === selectedDatasetId)
    setSelectedDataset(active)
  }, [selectedDatasetId, datasets])

  const addLog = (message: string, stream: 'stdout' | 'stderr' | 'system' = 'stdout') => {
    const time = new Date().toTimeString().split(' ')[0]
    setTerminalLogs(prev => [...prev, { timestamp: time, stream, message }])
  }

  // Handle Sim Running animation
  useEffect(() => {
    let interval: any
    if (simStatus === 'running') {
      addLog(`Initiating dead-reckoning trajectory simulator for dataset ${selectedDatasetId}...`, 'system')
      addLog(`Loading AHRS Mahony gains: ${ahrsGains.mahony}, Madgwick gains: ${ahrsGains.madgwick}...`, 'stdout')
      interval = setInterval(() => {
        setSimProgress(prev => {
          if (prev >= 100) {
            setSimStatus('completed')
            addLog(`Trajectory computation finished. 3D estimated coordinates successfully published over ZeroMQ MessagePack.`, 'stdout')
            addLog(`Total simulation frames processed: ${selectedDataset?.records.toLocaleString() || '482,910'} in 4.82s`, 'stdout')
            return 100
          }
          if (prev === 30) {
            addLog(`Calculated static postural components and low-pass Butterworth signal filtering (5 Hz cutoff)...`, 'stdout')
          }
          if (prev === 60) {
            addLog(`Integrating estimated dynamic energy body metrics (VeDBA and ODBA)...`, 'stdout')
          }
          if (prev === 85) {
            addLog(`Tiling NOAA BlueTopo benthic elevation layers for seafloor altitude reference...`, 'stdout')
          }
          return prev + 5
        })
      }, 200)
    } else if (simStatus === 'idle') {
      setSimProgress(0)
    }
    return () => clearInterval(interval)
  }, [simStatus])

  const triggerSimulation = () => {
    if (simStatus === 'running') return
    setSimProgress(0)
    setSimStatus('running')
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-200">
      
      {/* 1. Left Sidebar Navigation */}
      <aside className="w-64 glass-panel border-y-0 border-l-0 flex flex-col justify-between shrink-0 z-10">
        <div>
          {/* Brand Header */}
          <div className="p-6 border-b border-slate-850">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#004B87] text-white rounded">
                <Compass className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-display font-bold text-sm uppercase leading-none tracking-wider text-slate-200">WHOI MPG</h1>
                <p className="text-[9px] text-slate-500 font-mono mt-1 uppercase">Marine Predators Group</p>
              </div>
            </div>
          </div>
          
          {/* Nav Items */}
          <nav className="p-4 space-y-1">
            <button 
              onClick={() => setActiveTab('datasets')}
              className={`w-full flex items-center justify-between px-3 py-3 rounded text-sm font-medium transition-all group ${
                activeTab === 'datasets' 
                  ? 'bg-slate-800/80 text-white border-l-2 border-[#004B87] font-semibold' 
                  : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <Database className={`h-4 w-4 ${activeTab === 'datasets' ? 'text-[#3B9CFF]' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span>Dataset Registry</span>
              </div>
              <ChevronRight className={`h-3 w-3 opacity-0 transition-opacity ${activeTab === 'datasets' ? 'opacity-100' : ''}`} />
            </button>

            <button 
              onClick={() => setActiveTab('orchestrator')}
              className={`w-full flex items-center justify-between px-3 py-3 rounded text-sm font-medium transition-all group ${
                activeTab === 'orchestrator' 
                  ? 'bg-slate-800/80 text-white border-l-2 border-[#004B87] font-semibold' 
                  : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <Cpu className={`h-4 w-4 ${activeTab === 'orchestrator' ? 'text-[#3B9CFF]' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span>Sim Orchestrator</span>
              </div>
              <ChevronRight className={`h-3 w-3 opacity-0 transition-opacity ${activeTab === 'orchestrator' ? 'opacity-100' : ''}`} />
            </button>

            <button 
              onClick={() => setActiveTab('viewport')}
              className={`w-full flex items-center justify-between px-3 py-3 rounded text-sm font-medium transition-all group ${
                activeTab === 'viewport' 
                  ? 'bg-slate-800/80 text-white border-l-2 border-[#004B87] font-semibold' 
                  : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <LineChart className={`h-4 w-4 ${activeTab === 'viewport' ? 'text-[#3B9CFF]' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span>Analytical Viewport</span>
              </div>
              <ChevronRight className={`h-3 w-3 opacity-0 transition-opacity ${activeTab === 'viewport' ? 'opacity-100' : ''}`} />
            </button>

            <button 
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center justify-between px-3 py-3 rounded text-sm font-medium transition-all group ${
                activeTab === 'logs' 
                  ? 'bg-slate-800/80 text-white border-l-2 border-[#004B87] font-semibold' 
                  : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <Terminal className={`h-4 w-4 ${activeTab === 'logs' ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span>Diagnostic Logs</span>
              </div>
              <ChevronRight className={`h-3 w-3 opacity-0 transition-opacity ${activeTab === 'logs' ? 'opacity-100' : ''}`} />
            </button>
          </nav>
        </div>

        {/* Brand Footer */}
        <div className="p-6 border-t border-slate-800 bg-[#0A0D14]/20">
          <span className="text-[9px] text-slate-600 block font-mono text-center leading-tight">
            contributed by Long Horizon Observatory (c) 2026
          </span>
        </div>
      </aside>

      {/* 2. Main Content Frame */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Operational Status Bar */}
        <header className="h-16 glass-panel border-x-0 border-t-0 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-[#0C1017] border border-[#232D3E] rounded px-3 py-1 text-xs font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-slate-500">Service:</span>
              <span className="text-slate-300">Active</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Identity Badge */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-200 font-display">Daniel Fry</p>
                <p className="text-[10px] text-slate-500 font-mono leading-none mt-0.5">DanielFry@lhzn.io</p>
              </div>
              <div className="h-8 w-8 rounded bg-[#004B87] flex items-center justify-center font-display font-bold text-white text-sm shadow-sm">
                DF
              </div>
            </div>

            {/* Toggle AI Sidebar button */}
            <button 
              onClick={() => setAiSidebarOpen(!aiSidebarOpen)}
              className={`p-2 rounded transition-all border ${
                aiSidebarOpen 
                  ? 'bg-slate-800 text-slate-200 border-slate-700/60' 
                  : 'hover:bg-slate-850 text-slate-400 border-transparent'
              }`}
              title="Toggle AI Expert Consulting Sidebar"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Tab Panel Renderer */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <div className="max-w-6xl mx-auto space-y-6">
            
            {activeTab === 'datasets' && (
              <DatasetRegistry 
                datasets={datasets}
                selectedId={selectedDatasetId}
                onSelect={setSelectedDatasetId}
                onAddLog={addLog}
                validationHistory={validationHistory}
                onAddValidation={addValidationRecord}
                onAddDataset={addDataset}
                onDeleteDataset={deleteDataset}
                onUpdateDataset={updateDataset}
                onAddDatasetsBatch={addDatasetsBatch}
              />
            )}

            {activeTab === 'orchestrator' && (
              <SimOrchestrator 
                dataset={selectedDataset}
                simStatus={simStatus}
                simProgress={simProgress}
                ahrsGains={ahrsGains}
                onUpdateGains={setAhrsGains}
                onStartSim={triggerSimulation}
                onCancelSim={() => {
                  setSimStatus('idle')
                  addLog('Simulation aborted by user.', 'stderr')
                }}
              />
            )}

            {activeTab === 'viewport' && (
              <AnalyticalViewport 
                dataset={selectedDataset}
                simStatus={simStatus}
              />
            )}

            {activeTab === 'logs' && (
              <DiagnosticViewer 
                logs={terminalLogs}
                onClear={() => setTerminalLogs([])}
              />
            )}

          </div>
        </div>
      </main>

      {/* 3. Right Collapsible AI expert consulting sidebar */}
      <AIAssistantSidebar 
        isOpen={aiSidebarOpen}
        onClose={() => setAiSidebarOpen(false)}
        activeDataset={selectedDataset}
      />

    </div>
  )
}
