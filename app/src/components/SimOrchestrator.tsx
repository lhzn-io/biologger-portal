import { useState, useEffect } from 'react'
import { 
  Cpu, 
  Play, 
  Square, 
  Settings, 
  CheckCircle, 
  Activity, 
  RotateCcw
} from 'lucide-react'
import type { Dataset } from '../App'

interface SimOrchestratorProps {
  dataset: Dataset | undefined;
  simStatus: 'idle' | 'running' | 'completed';
  simProgress: number;
  ahrsGains: { mahony: number, madgwick: number };
  onUpdateGains: (gains: { mahony: number, madgwick: number }) => void;
  onStartSim: () => void;
  onCancelSim: () => void;
}

export default function SimOrchestrator({ 
  dataset, 
  simStatus, 
  simProgress, 
  ahrsGains, 
  onUpdateGains, 
  onStartSim, 
  onCancelSim 
}: SimOrchestratorProps) {
  const [yamlConfig, setYamlConfig] = useState('')
  const [isEditingYaml, setIsEditingYaml] = useState(false)

  // Auto-generate YAML config string when dataset or gains change
  useEffect(() => {
    if (!dataset) return
    const spec = `---
# WHOI-MPG Biologger Dead-Reckoning Config
simulation:
  id: "${dataset.id}_sim_v1"
  species: "${dataset.species}"
  common_name: "${dataset.commonName}"
  deployment_id: "${dataset.id}"

ahrs_filter:
  gain_mahony: ${ahrsGains.mahony.toFixed(5)}
  gain_madgwick: ${ahrsGains.madgwick.toFixed(3)}

spatial_boundary:
  location: "${dataset.location}"
  initial_coordinates: [${dataset.startLat}, ${dataset.startLon}]
  time_start: "${dataset.timeStart}"

velocity_estimation:
  type: "pressure_depth_integration"
  forward_velocity_scaler: 1.15
`
    setYamlConfig(spec)
  }, [dataset, ahrsGains])

  const handleYamlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setYamlConfig(e.target.value)
  }

  // Parse YAML changes and map back to state
  const saveYaml = () => {
    try {
      const mahonyMatch = yamlConfig.match(/gain_mahony:\s*([\d.]+)/)
      const madgwickMatch = yamlConfig.match(/gain_madgwick:\s*([\d.]+)/)
      
      const newMahony = mahonyMatch ? parseFloat(mahonyMatch[1]) : ahrsGains.mahony
      const newMadgwick = madgwickMatch ? parseFloat(madgwickMatch[1]) : ahrsGains.madgwick
      
      onUpdateGains({ mahony: newMahony, madgwick: newMadgwick })
      setIsEditingYaml(false)
    } catch (err) {
      console.error("YAML parsing error", err)
    }
  }

  const revertYaml = () => {
    if (!dataset) return
    onUpdateGains({ mahony: 0.005, madgwick: 0.041 })
    setIsEditingYaml(false)
  }

  if (!dataset) {
    return (
      <div className="glass-panel p-8 text-center text-slate-500 font-mono text-sm">
        Select a dataset in the registry inventory before launching the simulation orchestrator.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-[#004B87]/15 border border-[#004B87]/30 text-[#3B9CFF] rounded-xl">
          <Cpu className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Simulation Orchestrator</h2>
          <p className="text-sm text-slate-500">Configure species calibrations, tune AHRS Mahony gains, and launch trajectory models</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Interactive YAML Config Editor (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel flex flex-col h-[520px] overflow-hidden">
            
            {/* Panel Tabs Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-[#3B9CFF]" />
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-display">
                  Active Configuration File (YAML)
                </h3>
              </div>
              <div className="flex gap-2">
                {isEditingYaml ? (
                  <>
                    <button 
                      onClick={saveYaml}
                      className="px-2.5 py-1 text-[10px] bg-[#004B87] hover:bg-[#003C6C] text-white rounded font-mono transition-all"
                    >
                      Save Configuration
                    </button>
                    <button 
                      onClick={revertYaml}
                      className="px-2.5 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono border border-slate-700 transition-all"
                    >
                      Revert Defaults
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setIsEditingYaml(true)}
                    className="px-2.5 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono border border-slate-700 transition-all"
                  >
                    Edit File Parameters
                  </button>
                )}
              </div>
            </div>

            {/* Code Textarea Area */}
            <div className="flex-1 p-0 relative">
              <textarea 
                value={yamlConfig}
                onChange={handleYamlChange}
                disabled={!isEditingYaml}
                className={`w-full h-full p-6 font-mono text-xs text-slate-300 bg-slate-950/60 leading-relaxed resize-none focus:outline-none border-0 ${
                  isEditingYaml ? 'text-slate-200 focus:ring-1 focus:ring-[#004B87]/60' : 'text-slate-400'
                }`}
                spellCheck="false"
              />
              {!isEditingYaml && (
                <div className="absolute top-4 right-4 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800/80 text-[9px] text-slate-500 font-mono">
                  READ ONLY MODE
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Column: Sim Controller and Active Status (1 col) */}
        <div className="space-y-6">
          
          {/* Simulation Controller Panel */}
          <div className="glass-panel p-6">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#3B9CFF]" />
              <span>Simulation Command Center</span>
            </h3>

            <div className="space-y-6">
              
              {/* Active status card */}
              <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-800/40 text-center font-mono">
                <p className="text-[10px] text-slate-500 tracking-wider">ORCHESTRATOR STATUS</p>
                {simStatus === 'idle' && (
                  <p className="text-sm font-semibold text-slate-400 uppercase mt-1">IDLE - READY TO RUN</p>
                )}
                {simStatus === 'running' && (
                  <p className="text-sm font-semibold text-[#3B9CFF] uppercase mt-1">COMPUTING TRAJECTORY...</p>
                )}
                {simStatus === 'completed' && (
                  <p className="text-sm font-semibold text-emerald-400 uppercase mt-1 flex items-center justify-center gap-1.5">
                    <CheckCircle className="h-4 w-4" />
                    RUN COMPLETED
                  </p>
                )}
              </div>

              {/* Progress Bar Panel */}
              {(simStatus === 'running' || simStatus === 'completed') && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-400">Dead-Reckoning Math:</span>
                    <span className={simStatus === 'completed' ? 'text-emerald-400' : 'text-[#3B9CFF]'}>{simProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-950/80 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div 
                      className={`h-full transition-all duration-150 ${
                        simStatus === 'completed' ? 'bg-emerald-500' : 'bg-[#004B87]'
                      }`} 
                      style={{ width: `${simProgress}%` }}
                    />
                  </div>
                  {simStatus === 'running' && (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono mt-1">
                      <span className="h-1.5 w-1.5 bg-[#3B9CFF] rounded-full"></span>
                      <span>Streaming coordinate vectors to ZMQ Port 5555</span>
                    </div>
                  )}
                </div>
              )}

              {/* Actions buttons */}
              <div className="grid grid-cols-1 gap-3">
                {simStatus !== 'running' ? (
                  <button 
                    onClick={onStartSim}
                    className="w-full interactive-button-primary py-3 text-sm font-semibold"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    <span>Run Trajectory Simulation</span>
                  </button>
                ) : (
                  <button 
                    onClick={onCancelSim}
                    className="w-full px-4 py-3 bg-red-950/40 hover:bg-red-950/60 border border-red-800/40 text-red-300 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <Square className="h-4 w-4 fill-red-300" />
                    <span>Abort Simulation Run</span>
                  </button>
                )}

                {simStatus === 'completed' && (
                  <button 
                    onClick={revertYaml}
                    className="w-full interactive-button-secondary py-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset Simulation Panel</span>
                  </button>
                )}
              </div>

            </div>
          </div>

        </div>

      </div>

    </div>
  )
}
