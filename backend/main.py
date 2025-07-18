from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import List, Optional
import os
from dotenv import load_dotenv
import openai
import uuid
import json
from pypdf import PdfReader
from tempfile import NamedTemporaryFile
import numpy as np

load_dotenv()
import os
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai.api_key = OPENAI_API_KEY
# Note: Create a .env file in backend/ with OPENAI_API_KEY=sk-...

app = FastAPI()

# Allow CORS for local frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def extract_text_from_pdf(pdf_path):
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or '' for page in reader.pages)
    return text

def extract_text_from_file(file_path):
    if file_path.lower().endswith('.pdf'):
        return extract_text_from_pdf(file_path)
    else:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()

def chunk_text(text, max_words=40):
    # Simple chunking by sentences, max N words per chunk
    import re
    sentences = re.split(r'(?<=[.!?]) +', text)
    chunks = []
    chunk = []
    word_count = 0
    for sent in sentences:
        words = sent.split()
        if word_count + len(words) > max_words and chunk:
            chunks.append(' '.join(chunk))
            chunk = []
            word_count = 0
        chunk.extend(words)
        word_count += len(words)
    if chunk:
        chunks.append(' '.join(chunk))
    return [c.strip() for c in chunks if c.strip()]

def embed_texts(texts):
    # Returns list of embedding vectors
    resp = openai.embeddings.create(
        input=texts,
        model="text-embedding-3-small"
    )
    return [d.embedding for d in resp.data]

def transcribe_audio_whisper(audio_path):
    # Use OpenAI Whisper API for transcription
    with open(audio_path, "rb") as f:
        transcript = openai.audio.transcriptions.create(
            file=f,
            model="whisper-1",
            response_format="verbose_json",
            timestamp_granularities=["segment"]
        )
    # Build sentence-level transcript with speaker diarization (stub: all 'Agent')
    results = []
    for seg in transcript.segments:
        results.append({
            "speaker": "Agent",  # Real diarization would require more logic
            "text": seg.text,
            "start": seg.start,
            "end": seg.end
        })
    return results

def load_json(path):
    with open(path) as f:
        return json.load(f)

def cosine_sim(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def get_conv_dir(conv_id):
    return os.path.join(UPLOAD_DIR, conv_id)

def get_transcript_and_pitch(conv_id):
    conv_dir = get_conv_dir(conv_id)
    transcript = load_json(os.path.join(conv_dir, "transcript.json"))
    pitch = load_json(os.path.join(conv_dir, "pitch.json"))
    return transcript, pitch

@app.post("/upload")
def upload_files(
    audio: UploadFile = File(...),
    pitch: UploadFile = File(...)
):
    """
    Accepts audio (mp3/wav) and pitch (pdf/txt) files, stores them, and triggers processing.
    Returns a conversation ID.
    """
    conv_id = str(uuid.uuid4())
    conv_dir = os.path.join(UPLOAD_DIR, conv_id)
    os.makedirs(conv_dir, exist_ok=True)
    audio_path = os.path.join(conv_dir, audio.filename)
    pitch_path = os.path.join(conv_dir, pitch.filename)
    with open(audio_path, "wb") as f:
        f.write(audio.file.read())
    with open(pitch_path, "wb") as f:
        f.write(pitch.file.read())
    # Transcribe audio
    transcript = transcribe_audio_whisper(audio_path)
    with open(os.path.join(conv_dir, "transcript.json"), "w") as f:
        json.dump(transcript, f)
    # Process pitch doc
    pitch_text = extract_text_from_file(pitch_path)
    pitch_chunks = chunk_text(pitch_text)
    pitch_embeddings = embed_texts(pitch_chunks)
    pitch_data = {"steps": [{"step": i+1, "text": chunk} for i, chunk in enumerate(pitch_chunks)], "embeddings": pitch_embeddings}
    with open(os.path.join(conv_dir, "pitch.json"), "w") as f:
        json.dump(pitch_data, f)
    return {"conversation_id": conv_id}

@app.get("/transcript/{conv_id}")
def get_transcript(conv_id: str):
    """
    Returns the JSON transcript for a conversation.
    """
    conv_dir = os.path.join(UPLOAD_DIR, conv_id)
    path = os.path.join(conv_dir, "transcript.json")
    if not os.path.exists(path):
        return JSONResponse([], status_code=404)
    with open(path) as f:
        return JSONResponse(json.load(f))

@app.get("/pitch/{conv_id}")
def get_pitch(conv_id: str):
    """
    Returns the pitch steps and embeddings for a conversation.
    """
    conv_dir = os.path.join(UPLOAD_DIR, conv_id)
    path = os.path.join(conv_dir, "pitch.json")
    if not os.path.exists(path):
        return JSONResponse({}, status_code=404)
    with open(path) as f:
        data = json.load(f)
        return JSONResponse({"steps": data["steps"]})

@app.get("/suggestions/{conv_id}")
def get_suggestions(conv_id: str, current_time: Optional[float] = None):
    """
    Returns live pitch suggestions based on transcript progress.
    """
    transcript, pitch = get_transcript_and_pitch(conv_id)
    # Find all transcript up to current_time
    if current_time is not None:
        spoken = [t["text"] for t in transcript if t["end"] <= float(current_time)]
    else:
        spoken = [t["text"] for t in transcript]
    # Embed spoken so far
    if spoken:
        spoken_emb = embed_texts([" ".join(spoken)])[0]
    else:
        spoken_emb = np.zeros_like(pitch["embeddings"][0])
    # Cosine sim to each pitch step
    sims = [cosine_sim(spoken_emb, emb) for emb in pitch["embeddings"]]
    said = []
    missed = []
    for i, sim in enumerate(sims):
        if sim > 0.7:
            said.append(pitch["steps"][i]["text"])
        else:
            missed.append(pitch["steps"][i]["text"])
    next_step = missed[0] if missed else "All steps covered!"
    return JSONResponse({
        "said": said,
        "missed": missed,
        "next": next_step
    })

@app.post("/chat/{conv_id}")
def chat(conv_id: str, question: str = Form(...)):
    """
    Chat over the transcript and pitch using OpenAI GPT.
    """
    transcript, pitch = get_transcript_and_pitch(conv_id)
    context = "\n".join([f"{t['speaker']}: {t['text']}" for t in transcript])
    pitch_steps = "\n".join([f"Step {s['step']}: {s['text']}" for s in pitch["steps"]])
    prompt = f"""
You are a helpful sales call assistant. Here is the transcript:
{context}

Here are the pitch steps:
{pitch_steps}

User question: {question}
Answer in detail, referencing the transcript and pitch steps as needed.
"""
    resp = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "system", "content": "You are a helpful sales call assistant."},
                  {"role": "user", "content": prompt}]
    )
    answer = resp.choices[0].message.content
    return {"answer": answer}

@app.get("/search/{conv_id}")
def search(conv_id: str, query: str):
    """
    Search the transcript for a word/phrase and return matches with timestamps. Uses semantic similarity.
    """
    transcript, _ = get_transcript_and_pitch(conv_id)
    query_emb = embed_texts([query])[0]
    results = []
    for t in transcript:
        t_emb = embed_texts([t["text"]])[0]
        sim = cosine_sim(query_emb, t_emb)
        if sim > 0.6 or query.lower() in t["text"].lower():
            results.append({"text": t["text"], "start": t["start"], "end": t["end"]})
    return JSONResponse(results)
