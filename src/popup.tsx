import { Mic, BookOpen, Heart } from "lucide-react"
import "./style.css"

function Popup() {
  return (
    <div className="w-[350px] bg-slate-50 flex flex-col min-h-[500px] font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white py-6 px-4 text-center border-b border-slate-100 shadow-sm">
        <h1 className="text-2xl font-bold text-violet-600 mb-1">Shadowing Practice Loop</h1>
        <p className="text-sm text-slate-500">English speaking practice made easy</p>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
        
        {/* Icon Circle */}
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg mb-2">
          <Mic className="w-10 h-10 text-white" />
        </div>

        <h2 className="text-xl font-bold text-slate-800">Ready to practice?</h2>

        <p className="text-slate-600 leading-relaxed text-sm">
          Practice English speaking while watching YouTube videos. Get instant feedback on your pronunciation and improve your skills.
        </p>

        <button 
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("tabs/tutorial.html") })}
          className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-medium py-3 px-6 rounded-full shadow-md transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <BookOpen className="w-4 h-4" />
          How to use?
        </button>

        <a 
          href="https://www.youtube.com/watch?v=3JiVDYL20G4" 
          target="_blank" 
          rel="noreferrer"
          className="text-sm text-slate-500 hover:text-violet-600 transition-colors underline decoration-slate-300 hover:decoration-violet-600 underline-offset-4"
        >
          Go to YouTube to start practicing!
        </a>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-100 bg-white">
        <p className="flex items-center justify-center gap-1">
          Made with <Heart className="w-3 h-3 text-red-500 fill-red-500" /> for language learners
        </p>
      </footer>
    </div>
  )
}

export default Popup
