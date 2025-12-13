import { Mic } from "lucide-react"
import "../style.css"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

function requestMic() {
  return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    stream.getTracks().forEach((t) => t.stop())
    try {
      chrome?.runtime?.sendMessage?.({ type: "spl-mic-granted" })
    } catch {}
    try {
      window.close()
    } catch {}
  })
}

function Tutorial() {
  const url = new URL(window.location.href)
  const grant = url.searchParams.get("grantMic")
  if (grant) {
    requestMic().catch(() => {})
  }
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col items-center py-12 px-4">
      
      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-violet-600">Shadowing Practice Loop</h1>
        </div>
        <p className="text-slate-500 text-lg">Master pronunciation with feedback</p>
      </div>

      {/* Steps */}
      <div className="w-full max-w-2xl space-y-6 mb-12">
        
        {/* Step 1 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start gap-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">
            1
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Go to YouTube</h3>
            <p className="text-slate-600">Navigate to any YouTube video with subtitles or captions enabled</p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start gap-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-lg">
            2
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Open Extension</h3>
            <p className="text-slate-600 mb-3">Click the Shadowing Practice Loop icon in your browser toolbar</p>
            <div className="bg-slate-50 rounded-lg p-3 inline-flex items-center gap-2 border border-slate-100">
               <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-sm">
                <Mic className="w-3 h-3 text-white" />
              </div>
              <span className="text-sm text-slate-600 font-medium">Extension icon in toolbar</span>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start gap-6">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-lg">
            3
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Start Speaking!</h3>
            <p className="text-slate-600">Practice pronunciation and get instant feedback on your speech</p>
          </div>
        </div>

      </div>

      <div className="text-center space-y-6">
        <button 
          onClick={() => window.open("https://www.youtube.com", "_blank")}
          className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
        >
          Start Practicing Now
        </button>
        <div>
          <button
            onClick={() => requestMic().catch(() => {})}
            className="mt-3 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-full shadow"
          >
            Grant Microphone Access
          </button>
        </div>
        <p className="text-slate-500">
          Ready to improve your pronunciation? Head to YouTube and start practicing!
        </p>
      </div>

    </div>
  )
}

export default Tutorial
