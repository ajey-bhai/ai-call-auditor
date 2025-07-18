import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'

function UploadPage() {
  const [audioFile, setAudioFile] = useState(null);
  const [pitchFile, setPitchFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleUpload = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('pitch', pitchFile);
    try {
      const res = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      navigate(`/review/${data.conversation_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white shadow-lg rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Sales Coach AI</h1>
        <form className="space-y-4" onSubmit={handleUpload}>
          <div>
            <label className="block font-medium mb-1">Upload Audio (MP3/WAV)</label>
            <input
              type="file"
              accept="audio/mp3,audio/wav"
              onChange={e => setAudioFile(e.target.files[0])}
              className="block w-full border rounded p-2"
              required
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Upload Pitch Document (PDF/TXT)</label>
            <input
              type="file"
              accept="application/pdf,text/plain"
              onChange={e => setPitchFile(e.target.files[0])}
              className="block w-full border rounded p-2"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700 transition"
            disabled={!audioFile || !pitchFile || loading}
          >
            {loading ? 'Uploading...' : 'Start Review'}
          </button>
          {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
        </form>
      </div>
    </div>
  )
}

function ReviewPage() {
  const { conversationId } = useParams();
  const [transcript, setTranscript] = useState([]);
  const [audioUrl, setAudioUrl] = useState(null); // Placeholder for now
  const [pitch, setPitch] = useState({ steps: [] });
  const [suggestions, setSuggestions] = useState({ said: [], missed: [], next: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const audioRef = useRef();
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [transcriptRes, pitchRes, suggestionsRes] = await Promise.all([
          fetch(`http://localhost:8000/transcript/${conversationId}`),
          fetch(`http://localhost:8000/pitch/${conversationId}`),
          fetch(`http://localhost:8000/suggestions/${conversationId}`),
        ]);
        if (!transcriptRes.ok) throw new Error('Failed to fetch transcript');
        if (!pitchRes.ok) throw new Error('Failed to fetch pitch');
        if (!suggestionsRes.ok) throw new Error('Failed to fetch suggestions');
        const transcriptData = await transcriptRes.json();
        const pitchData = await pitchRes.json();
        const suggestionsData = await suggestionsRes.json();
        setTranscript(transcriptData);
        setPitch(pitchData);
        setSuggestions(suggestionsData);
        setAudioUrl('/sample-audio.mp3');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [conversationId]);

  // Chat handler
  const handleChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatLoading(true);
    const userMsg = { role: 'user', content: chatInput };
    setChatHistory((h) => [...h, userMsg]);
    try {
      const formData = new FormData();
      formData.append('question', chatInput);
      const res = await fetch(`http://localhost:8000/chat/${conversationId}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setChatHistory((h) => [...h, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setChatHistory((h) => [...h, { role: 'assistant', content: 'Error: ' + err.message }]);
    } finally {
      setChatLoading(false);
      setChatInput('');
    }
  };

  // Search handler
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    try {
      const res = await fetch(`http://localhost:8000/search/${conversationId}?query=${encodeURIComponent(searchInput)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      setSearchResults([]);
    }
  };

  // Jump to timestamp in audio
  const jumpTo = (start) => {
    if (audioRef.current) {
      audioRef.current.currentTime = start;
      audioRef.current.play();
    }
  };

  // Audio time update handler
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="bg-white shadow-lg rounded-lg p-8 w-full max-w-4xl flex flex-row gap-8">
        <div className="flex-1">
          <h2 className="text-xl font-bold mb-4">Review Conversation</h2>
          {/* Search Bar */}
          <form className="mb-4 flex gap-2" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search transcript..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="flex-1 border rounded p-2"
            />
            <button type="submit" className="bg-gray-200 px-4 py-2 rounded">Search</button>
          </form>
          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mb-4">
              <div className="font-semibold mb-1">Search Results:</div>
              <ul className="space-y-1">
                {searchResults.map((r, i) => (
                  <li key={i}>
                    <button className="underline text-blue-700" onClick={() => jumpTo(r.start)}>
                      {r.text} [{r.start.toFixed(1)}s]
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Audio Player */}
          {audioUrl && (
            <audio ref={audioRef} controls src={audioUrl} className="w-full mb-4" onTimeUpdate={handleTimeUpdate}>
              Your browser does not support the audio element.
            </audio>
          )}
          {/* Transcript */}
          <div className="space-y-2">
            {transcript.map((item, idx) => {
              const isActive = currentTime >= item.start && currentTime <= item.end;
              return (
                <div
                  key={idx}
                  onClick={() => jumpTo(item.start)}
                  className={`p-2 rounded text-sm cursor-pointer transition border-l-4 ${
                    isActive
                      ? 'bg-yellow-200 border-yellow-500'
                      : item.speaker === 'Agent'
                      ? 'bg-blue-100 text-blue-900 border-transparent'
                      : 'bg-green-100 text-green-900 border-transparent'
                  }`}
                >
                  <span className="font-semibold mr-2">{item.speaker}:</span>
                  <span>{item.text}</span>
                  <span className="ml-2 text-xs text-gray-500">[{item.start.toFixed(1)}s - {item.end.toFixed(1)}s]</span>
                </div>
              );
            })}
          </div>
          {/* Chat UI */}
          <div className="mt-8">
            <h3 className="font-bold mb-2">Chat with Sales Coach AI</h3>
            <div className="bg-gray-50 border rounded p-4 h-48 overflow-y-auto mb-2 flex flex-col gap-2">
              {chatHistory.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
                  <span className={msg.role === 'user' ? 'text-blue-700' : 'text-gray-800'}>
                    <b>{msg.role === 'user' ? 'You' : 'AI'}:</b> {msg.content}
                  </span>
                </div>
              ))}
              {chatLoading && <div className="text-gray-400">AI is typing...</div>}
            </div>
            <form className="flex gap-2" onSubmit={handleChat}>
              <input
                type="text"
                placeholder="Ask a question..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                className="flex-1 border rounded p-2"
                disabled={chatLoading}
              />
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded" disabled={chatLoading || !chatInput.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
        {/* Side Panel (Pitch & Suggestions) */}
        <div className="w-80 bg-gray-50 border-l pl-6 flex flex-col gap-6">
          <div>
            <h3 className="font-bold mb-2">Pitch Steps</h3>
            <ol className="list-decimal ml-4 space-y-1">
              {pitch.steps.map((step, idx) => (
                <li
                  key={idx}
                  className={
                    suggestions.said.includes(step.text)
                      ? 'text-green-700 font-semibold'
                      : suggestions.missed.includes(step.text)
                      ? 'text-red-600'
                      : ''
                  }
                >
                  {step.text}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="font-bold mb-2">Suggestions</h3>
            <div className="mb-1">
              <span className="font-semibold text-green-700">✅ Said:</span>
              <ul className="list-disc ml-6">
                {suggestions.said.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div className="mb-1">
              <span className="font-semibold text-red-600">❌ Missed:</span>
              <ul className="list-disc ml-6">
                {suggestions.missed.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
            <div>
              <span className="font-semibold text-blue-700">💡 Next:</span>
              <span className="ml-2">{suggestions.next}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
      <Route path="/review/:conversationId" element={<ReviewPage />} />
    </Routes>
  )
}
