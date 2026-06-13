import { useState, useRef, useEffect } from 'react'
import { 
  Send, 
  Settings, 
  X,
  Activity
} from 'lucide-react'
import type { Dataset } from '../App'

interface AIAssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeDataset: Dataset | undefined;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function AIAssistantSidebar({ 
  isOpen, 
  onClose, 
  activeDataset: _activeDataset
}: AIAssistantSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Onboarded to WHOI Marine Predators Group expert assistant. Primary identity domain: lhzn.io authenticated. How can I assist your mesopelagic shark or swordfish tracking analysis today?', timestamp: '16:00' }
  ])
  
  const [inputMessage, setInputMessage] = useState('')
  const [apiUrlMode, setApiUrlMode] = useState<'local' | 'tunnel'>('local')
  const [tunnelUrl, setTunnelUrl] = useState('https://biologger-expert.lhzn.io')
  const [showConfig, setShowConfig] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping])

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return

    const time = new Date().toTimeString().split(' ')[0].substring(0, 5)
    const newUserMsg: Message = { role: 'user', content: inputMessage, timestamp: time }
    
    // We compute the next messages state immediately to send to the backend
    const updatedMessages = [...messages, newUserMsg]
    setMessages(updatedMessages)
    setInputMessage('')
    setIsTyping(true)

    // Format the payload to strip metadata and conform to standard chat completions API schema
    const apiMessages = updatedMessages.map(m => ({
      role: m.role,
      content: m.content
    }))

    fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: apiMessages })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(errData => {
            throw new Error(errData.error || 'Server error');
          }).catch(() => {
            throw new Error(`HTTP status ${res.status}`);
          });
        }
        return res.json()
      })
      .then(data => {
        setIsTyping(false)
        const aiText = data.choices?.[0]?.message?.content || 'No response returned from model.'
        const responseTime = new Date().toTimeString().split(' ')[0].substring(0, 5)
        const newAiMsg: Message = { role: 'assistant', content: aiText, timestamp: responseTime }
        setMessages(prev => [...prev, newAiMsg])
      })
      .catch(err => {
        setIsTyping(false)
        const responseTime = new Date().toTimeString().split(' ')[0].substring(0, 5)
        const errResponse = `System Failure - Failed to fetch expert completion. Details: ${err.message}`
        const newAiMsg: Message = { role: 'assistant', content: errResponse, timestamp: responseTime }
        setMessages(prev => [...prev, newAiMsg])
      })
  }

  if (!isOpen) return null

  return (
    <aside className="w-80 glass-panel border-y-0 border-r-0 flex flex-col shrink-0 z-20 animate-slideLeft">
      
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-[#004B87]/15 border border-[#004B87]/30 text-[#3B9CFF] rounded-lg animate-pulse">
            <Activity className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-display">
            AI Expert Chat
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded transition-all hover:bg-slate-800 ${showConfig ? 'text-[#3B9CFF]' : 'text-slate-500'}`}
            title="Configure API Gateway Router"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button 
            onClick={onClose}
            className="p-1.5 rounded transition-all text-slate-500 hover:text-slate-300 hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Gateway Configuration Sidebar Overlay */}
      {showConfig && (
        <div className="p-4 border-b border-slate-800 bg-slate-900/60 font-mono text-[10px] space-y-3 shrink-0">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">API ROUTING:</span>
            <div className="flex gap-1.5">
              <button 
                onClick={() => setApiUrlMode('local')}
                className={`px-1.5 py-0.5 rounded uppercase font-semibold ${
                  apiUrlMode === 'local' ? 'bg-[#004B87]/15 text-[#3B9CFF] border border-[#004B87]/30' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Local
              </button>
              <button 
                onClick={() => setApiUrlMode('tunnel')}
                className={`px-1.5 py-0.5 rounded uppercase font-semibold ${
                  apiUrlMode === 'tunnel' ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Tunnel
              </button>
            </div>
          </div>
          
          {apiUrlMode === 'local' ? (
            <div className="text-[10px] text-slate-500 leading-tight">
              Routing directly over local fleet networks:<br />
              <span className="text-[#3B9CFF]">http://garnet.local:8080 (Mac Studio)</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <span className="text-slate-500">CLOUDFLARE ACCESS GATEWAY:</span>
              <input 
                type="text"
                value={tunnelUrl}
                onChange={(e) => setTunnelUrl(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#004B87]/60 font-mono"
              />
            </div>
          )}
        </div>
      )}

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 bg-slate-950/20">
        
        {messages.map((m, index) => (
          <div 
            key={index}
            className={`flex flex-col max-w-[85%] ${m.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
          >
            <div className={`p-3 rounded-lg text-xs leading-relaxed ${
              m.role === 'user' 
                ? 'bg-[#004B87]/15 text-slate-200 border border-[#004B87]/30 rounded-tr-none' 
                : 'bg-slate-900/80 text-slate-300 border border-slate-800/80 rounded-tl-none'
            }`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
            <span className="text-[9px] text-slate-600 font-mono mt-1 px-1">{m.timestamp}</span>
          </div>
        ))}

        {isTyping && (
          <div className="mr-auto items-start max-w-[85%] flex flex-col">
            <div className="p-3 bg-slate-900/80 rounded-lg rounded-tl-none border border-slate-800/80 text-xs text-slate-500 font-mono flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 bg-slate-500 rounded-full animate-bounce"></div>
              <div className="h-1.5 w-1.5 bg-slate-500 rounded-full animate-bounce delay-100"></div>
              <div className="h-1.5 w-1.5 bg-slate-500 rounded-full animate-bounce delay-200"></div>
              <span>biologger-expert solving...</span>
            </div>
          </div>
        )}
        
        <div ref={chatEndRef} />
      </div>

      {/* Input Message Area */}
      <div className="p-3 border-t border-slate-850 flex items-center gap-2 bg-slate-950/40 shrink-0">
        <input 
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Ask biologger expert..."
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#004B87]/60 font-mono"
        />
        <button 
          onClick={handleSendMessage}
          className="p-2 bg-[#004B87] hover:bg-[#003C6C] rounded-lg text-white transition-all shadow shadow-slate-950/50"
        >
          <Send className="h-3.5 w-3.5 fill-white" />
        </button>
      </div>

      {/* Mock Component for Lucide Activity resolution */}
      <div className="hidden">
        <Activity className="h-0 w-0" />
      </div>

    </aside>
  )
}
