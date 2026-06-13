import { useState } from 'react'
import { 
  LineChart, 
  Zap, 
  Compass, 
  Waves,
  Maximize2
} from 'lucide-react'
import type { Dataset } from '../App'

interface AnalyticalViewportProps {
  dataset: Dataset | undefined;
  simStatus: 'idle' | 'running' | 'completed';
}

export default function AnalyticalViewport({ dataset, simStatus }: AnalyticalViewportProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  
  // Generating clean sample dive profile points for SVG charting
  // Represents a classic mesopelagic swordfish foraging dive (deep plunge to 600m)
  const diveData = [
    { time: '09:00', depth: 12, vedba: 0.12, altitude: 450, speed: 1.1 },
    { time: '09:10', depth: 45, vedba: 0.18, altitude: 420, speed: 1.3 },
    { time: '09:20', depth: 120, vedba: 0.25, altitude: 380, speed: 1.8 },
    { time: '09:30', depth: 320, vedba: 0.31, altitude: 250, speed: 2.1 },
    { time: '09:40', depth: 550, vedba: 0.48, altitude: 80, speed: 2.4 }, // plunging
    { time: '09:50', depth: 610, vedba: 0.85, altitude: 20, speed: 3.2 }, // foraging burst near bottom!
    { time: '10:00', depth: 590, vedba: 0.92, altitude: 30, speed: 3.5 }, // foraging burst near bottom!
    { time: '10:10', depth: 580, vedba: 0.41, altitude: 50, speed: 1.9 },
    { time: '10:20', depth: 380, vedba: 0.22, altitude: 210, speed: 1.5 },
    { time: '10:30', depth: 150, vedba: 0.15, altitude: 410, speed: 1.2 },
    { time: '10:40', depth: 22, vedba: 0.09, altitude: 440, speed: 1.0 }
  ]

  if (!dataset) {
    return (
      <div className="glass-panel p-8 text-center text-slate-500 font-mono text-sm">
        Select an active dataset in the inventory before querying the analytical viewport.
      </div>
    )
  }

  // Calculate SVG line paths
  const chartWidth = 500
  const chartHeight = 155
  
  const getPointsStr = (key: 'depth' | 'vedba' | 'altitude', maxVal: number, invert = false) => {
    return diveData.map((d, index) => {
      const x = (index / (diveData.length - 1)) * chartWidth
      const normVal = d[key] / maxVal
      const y = invert ? normVal * chartHeight : (1 - normVal) * chartHeight
      return `${x},${y}`
    }).join(' ')
  }

  const depthPoints = getPointsStr('depth', 700, true) // Invert so depth goes downwards!
  const vedbaPoints = getPointsStr('vedba', 1.0)

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-[#004B87]/15 border border-[#004B87]/30 text-[#3B9CFF] rounded-xl">
          <LineChart className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Analytical Viewport</h2>
          <p className="text-sm text-slate-500">Analyze high-resolution kinematics, voluntary energetic body acceleration (VeDBA), and benthic profiles</p>
        </div>
      </div>

      {simStatus === 'running' ? (
        <div className="glass-panel p-12 text-center text-slate-400 font-mono text-sm space-y-4">
          <div className="h-8 w-8 rounded-full border-2 border-[#004B87] border-t-transparent animate-spin mx-auto"></div>
          <p className="animate-pulse">Simulator computing 3D dead-reckoning trajectory vectors... Please wait.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Left Columns: Charts Grid (2 cols) */}
          <div className="xl:col-span-2 space-y-6">
            
            {/* Dive Depth & Benthic Terrain Profile Chart */}
            <div className="glass-panel p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Waves className="h-4 w-4 text-[#3B9CFF]" />
                  <span>Dive Profile & Seafloor Altitude</span>
                </h3>
                <span className="text-[10px] text-slate-500 font-mono uppercase bg-slate-950/40 px-2 py-0.5 rounded border border-slate-800/40">
                  Dual Layer Render
                </span>
              </div>

              {/* SVG Chart Container */}
              <div className="relative bg-slate-950/40 rounded-lg p-4 border border-slate-900 overflow-hidden">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-48 overflow-visible">
                  
                  {/* Grid Lines */}
                  <line x1="0" y1={chartHeight * 0.25} x2={chartWidth} y2={chartHeight * 0.25} stroke="#1e293b" strokeDasharray="3,3" />
                  <line x1="0" y1={chartHeight * 0.5} x2={chartWidth} y2={chartHeight * 0.5} stroke="#1e293b" strokeDasharray="3,3" />
                  <line x1="0" y1={chartHeight * 0.75} x2={chartWidth} y2={chartHeight * 0.75} stroke="#1e293b" strokeDasharray="3,3" />
                  
                  {/* Benthic seafloor elevation representation (brown/slate terrain fill at bottom) */}
                  <path 
                    d={`M 0,${chartHeight} L ${depthPoints} L ${chartWidth},${chartHeight} Z`} 
                    fill="url(#terrain-gradient)" 
                    opacity="0.15" 
                  />

                  {/* Dive Depth Line (Inverted: downwards is deeper) */}
                  <polyline
                    fill="none"
                    stroke="#3B9CFF"
                    strokeWidth="2.5"
                    points={depthPoints}
                    className="transition-all duration-300"
                  />
                  
                  {/* Scatter hover points */}
                  {diveData.map((d, idx) => {
                    const x = (idx / (diveData.length - 1)) * chartWidth
                    const y = (d.depth / 700) * chartHeight
                    return (
                      <circle
                        key={idx}
                        cx={x}
                        cy={y}
                        r={hoverIndex === idx ? "5" : "3"}
                        fill={hoverIndex === idx ? "#3B9CFF" : "#0f172a"}
                        stroke="#3B9CFF"
                        strokeWidth="1.5"
                        onMouseEnter={() => setHoverIndex(idx)}
                        onMouseLeave={() => setHoverIndex(null)}
                        className="cursor-pointer transition-all duration-150"
                      />
                    )
                  })}

                  {/* SVG Gradients definitions */}
                  <defs>
                    <linearGradient id="terrain-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#1E293B" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#0F172A" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                </svg>

                {/* Y Axis Labels */}
                <div className="absolute left-6 top-6 text-[9px] font-mono text-slate-500 space-y-9 pointer-events-none">
                  <span>0 m</span>
                  <span>200 m</span>
                  <span>400 m</span>
                  <span>600 m</span>
                </div>
              </div>

              {/* Chart footer detail */}
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-3">
                <span>Start: 09:00 AM</span>
                <span className="text-[#3B9CFF]">Blue Line: Animal Depth</span>
                <span className="text-slate-500">Dark Gray Fill: Benthic Seafloor Elevation</span>
                <span>End: 10:40 AM</span>
              </div>

            </div>

            {/* VeDBA Locomotor Energetics Index Chart */}
            <div className="glass-panel p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Zap className="h-4 w-4 text-[#3B9CFF]" />
                  <span>Voluntary Body Energetics (VeDBA) & Locomotor Bursts</span>
                </h3>
                <span className="text-[10px] text-slate-500 font-mono uppercase bg-slate-950/40 px-2 py-0.5 rounded border border-slate-800/40">
                  Dynamic Body Acceleration
                </span>
              </div>

              {/* SVG Chart Container */}
              <div className="relative bg-slate-950/40 rounded-lg p-4 border border-slate-900 overflow-hidden">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-40 overflow-visible">
                  
                  {/* Grid Lines */}
                  <line x1="0" y1={chartHeight * 0.3} x2={chartWidth} y2={chartHeight * 0.3} stroke="#1e293b" strokeDasharray="3,3" />
                  <line x1="0" y1={chartHeight * 0.6} x2={chartWidth} y2={chartHeight * 0.6} stroke="#1e293b" strokeDasharray="3,3" />

                  {/* VeDBA Path Line */}
                  <polyline
                    fill="none"
                    stroke="#64748B"
                    strokeWidth="2"
                    points={vedbaPoints}
                    className="transition-all duration-300"
                  />

                  {/* Area fill */}
                  <path 
                    d={`M 0,${chartHeight} L ${vedbaPoints} L ${chartWidth},${chartHeight} Z`} 
                    fill="url(#vedba-gradient)" 
                  />
                  
                  {/* Scatter hover points */}
                  {diveData.map((d, idx) => {
                    const x = (idx / (diveData.length - 1)) * chartWidth
                    const y = (1 - d.vedba) * chartHeight
                    return (
                      <circle
                        key={idx}
                        cx={x}
                        cy={y}
                        r={hoverIndex === idx ? "5" : "3"}
                        fill={hoverIndex === idx ? "#64748B" : "#0f172a"}
                        stroke="#64748B"
                        strokeWidth="1.5"
                        onMouseEnter={() => setHoverIndex(idx)}
                        onMouseLeave={() => setHoverIndex(null)}
                        className="cursor-pointer transition-all duration-150"
                      />
                    )
                  })}

                  <defs>
                    <linearGradient id="vedba-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#64748B" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#64748B" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                </svg>

                {/* Y Axis Labels */}
                <div className="absolute left-6 top-6 text-[9px] font-mono text-slate-500 space-y-7 pointer-events-none">
                  <span>1.0 G (burst)</span>
                  <span>0.5 G (cruise)</span>
                  <span>0.0 G (gliding)</span>
                </div>
              </div>

              {/* Chart footer detail */}
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-3">
                <span>Start: 09:00 AM</span>
                <span className="text-slate-400">VeDBA magnitude indicates active voluntary locomotion & foraging spikes</span>
                <span>End: 10:40 AM</span>
              </div>

            </div>

          </div>

          {/* Right Column: High-Density Diagnostic Panel (1 col) */}
          <div className="space-y-6">
            
            {/* Real-time Hover Coordinates */}
            <div className="glass-panel p-6 border-slate-700/60 bg-slate-900/40">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Compass className="h-4 w-4 text-[#3B9CFF]" />
                <span>Kinematic Vector Index</span>
              </h3>

              {hoverIndex !== null ? (
                <div className="space-y-3 font-mono text-xs animate-fadeIn">
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Record Interval:</span>
                    <span className="text-slate-200 font-semibold">{diveData[hoverIndex].time}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Dive Depth:</span>
                    <span className="text-[#3B9CFF] font-semibold">{diveData[hoverIndex].depth} meters</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-500">VeDBA Energy:</span>
                    <span className="text-slate-300 font-semibold">{diveData[hoverIndex].vedba} G</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-500">Seafloor Clearance:</span>
                    <span className="text-slate-300 font-semibold">{diveData[hoverIndex].altitude} meters</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Swim Velocity:</span>
                    <span className="text-slate-200 font-semibold">{diveData[hoverIndex].speed} m/s</span>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 font-mono text-xs space-y-2">
                  <Maximize2 className="h-5 w-5 text-slate-600 mx-auto" />
                  <p>Hover cursor over scatter line plot coordinate nodes to query high-frequency kinematic vectors.</p>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  )
}
