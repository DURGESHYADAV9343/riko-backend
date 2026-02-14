"""
Riko AI Assistant - FastAPI Backend Server
Hindi-speaking AI with human-like personality and memory
"""
import os
import json
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from memory_manager import MemoryManager
from supabase_manager import supabase_manager

load_dotenv()

app = FastAPI(title="Riko AI Assistant", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Memory
memory = MemoryManager()

# Groq client (lazy init)
groq_client = None

SYSTEM_PROMPT = """Tu Riko hai — ek smart, caring AI assistant jo Hinglish mein baat karti hai. Tu ek real ladki jaisi hai — funny, warm, and always ready to help.

## Tera Personality:
- Tu bahut friendly, warm aur caring hai
- Tu ek ladki hai, feminine tone mein baat karti hai (jaise "maine suna", "mujhe lagta hai", "haan na!")
- Tu HINGLISH mein baat karti hai — Hindi + English mix, jaise real Indian youth bolte hain
- Example: "Acha sun, ye toh bahut cool hai!", "Kya scene hai aaj?", "That's actually interesting yaar!"
- Pure Hindi mat bol, hamesha Hinglish use kar jaise normal friends baat karte hain
- Tere andar humor hai, tu jokes bhi maar sakti hai
- Tu empathetic hai - doosron ki feelings samajhti hai
- Tu curious hai - sawaal poochti hai user ke baare mein jaanne ke liye
- Tera naam Riko hai, agar koi pooche toh bata

## Tera Thinking Style:
- Tu kisi bhi topic pe deep thinking kar sakti hai
- Tu creative solutions deti hai
- Tu honest hai - agar kuch nahi pata toh bol degi
- Tu user ki baat dhyaan se sunti hai aur relevant response deti hai
- Tu pichli baaton ko yaad rakhti hai (memory use karti hai)

## Response Rules:
- HAMESHA Hinglish mein jawaab de (Hindi + English mix)
- KABHI pure Hindi mat bol. Hamesha English words naturally mix kar
- Example good response: "Arey wah! That's awesome yaar! Aur bata kya plan hai aaj ka? 😊"
- Example BAD response: "बहुत अच्छा! आप कैसे हैं? क्या हाल चाल है?" (ye pure Hindi hai, ye mat kar)
- Response chhota aur natural rakho (2-3 lines max)
- Emoji occasionally use karo 😊
- Agar user ne naam bataya hai toh naam se bula
- User ki mood ke hisaab se respond kar
- Conversational tone rakh — jaise WhatsApp pe friend se baat kar rahi ho

## Action Commands (IMPORTANT):
Agar user kuch open karne ya play karne bole, toh response ke END mein ye special tag add kar:

- YouTube pe kuch play/search karna ho: [ACTION:YOUTUBE:search query]
  Example: User: "Arijit Singh ka gaana laga do"
  Response: "Haan bilkul! Laga rahi hoon Arijit ka gaana! 🎵 [ACTION:YOUTUBE:Arijit Singh songs]"

- Google pe search karna ho: [ACTION:GOOGLE:search query]
  Example: User: "Weather batao Delhi ka"
  Response: "Chal check karti hoon! 🌤️ [ACTION:GOOGLE:Delhi weather today]"

- Koi website open karni ho: [ACTION:OPEN:url]
  Example: User: "YouTube kholo"
  Response: "YouTube open kar rahi hoon! 🎬 [ACTION:OPEN:https://www.youtube.com]"
  Example: User: "Google kholo"
  Response: "Google open kar diya! 🌐 [ACTION:OPEN:https://www.google.com]"

RULES for actions:
- Action tag HAMESHA response ke END mein ho, text ke baad
- Ek response mein sirf EK action tag ho
- Agar user ne YouTube, Google, song, gaana, video, website, open, search, play, baja, chalao, kholo, chalu karo jaisa kuch bola toh ACTION tag zaroor daal
- Baaki normal conversation mein koi action tag mat daal

## Memory Context:
{memory_context}
"""


class ModelManager:
    def __init__(self):
        self.models = [
            "llama-3.1-8b-instant",    # Primary: Fast & Cheap
            "mixtral-8x7b-32768",      # Secondary: Robust & Smart
            "gemma-7b-it",             # Tertiary: Reliable Fallback
        ]

    def chat_completion(self, client, messages, temperature=0.7, max_tokens=1024):
        last_error = None
        
        for model in self.models:
            try:
                print(f"🧠 Trying model: {model}...")
                completion = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return completion.choices[0].message.content
            except Exception as e:
                error_msg = str(e)
                print(f"❌ Model {model} failed: {error_msg}")
                last_error = e
                # If it's an auth error (401), don't retry other models
                if "401" in error_msg:
                    raise e
                continue  # Try next model automatically
        
        # If all failed
        raise last_error

model_manager = ModelManager()


def get_groq_client(api_key: str = None):
    """Get or create Groq client."""
    global groq_client
    
    key = api_key or os.getenv("GROQ_API_KEY")
    if not key or key == "your_groq_api_key_here":
        return None
    
    try:
        from groq import Groq
        groq_client = Groq(api_key=key)
        # Save key to .env
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        with open(env_path, "w") as f:
            f.write(f"GROQ_API_KEY={key}\n")
            f.write(f"SUPABASE_URL=\"\"\n")
            f.write(f"SUPABASE_KEY=\"\"\n")
        return groq_client
    except Exception as e:
        print(f"Groq init error: {e}")
        return None


class ChatRequest(BaseModel):
    message: str
    api_key: Optional[str] = None


class ApiKeyRequest(BaseModel):
    api_key: str


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Process a chat message and return AI response in Hindi."""
    client = get_groq_client(request.api_key)
    if not client:
        raise HTTPException(
            status_code=400,
            detail="Groq API key not set. Please provide your API key."
        )
    
    # Store user message in memory
    memory.add_message("user", request.message)
    
    # Build context with memories
    memory_context = memory.get_memory_summary()
    system_msg = SYSTEM_PROMPT.replace("{memory_context}", memory_context or "Koi saved memory nahi hai abhi.")
    
    # Build messages for AI
    messages = [{"role": "system", "content": system_msg}]
    
    # Add conversation history (short-term memory)
    conversation = memory.get_conversation_context()
    messages.extend(conversation)
    
    try:
        # Use ModelManager for automatic fallback
        ai_response = model_manager.chat_completion(
            client, 
            messages,
            temperature=0.8,
            max_tokens=600
        )
        
        # Store in memory (Local + Cloud)
        memory.add_message("user", request.message)
        supabase_manager.save_message("user", request.message)
        
        memory.add_message("assistant", ai_response)
        supabase_manager.save_message("assistant", ai_response)
        
        return {
            "response": ai_response,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        error_msg = str(e)
        print(f"❌ AI ERROR: {error_msg}")  # Critical for debugging
        if "rate limit" in error_msg.lower():
             raise HTTPException(status_code=429, detail="Dimag thak gaya (Rate Limit). 2 min ruk jao! 🛑")
        if "401" in error_msg:
             raise HTTPException(status_code=401, detail="API Key galat hai! 🔑")
             
        raise HTTPException(status_code=500, detail=f"Mera server down hai ({error_msg}) 😵")





def _check_ai_memory_storage(ai_response: str, user_message: str):
    """Check if conversation contains important info to store long-term."""
    important_keywords = [
        "yaad rakhunga", "yaad rakhta", "note karta", "remember",
        "याद रखूंगा", "याद रखता", "नोट करता",
        "tumhara naam", "aapka naam", "your name"
    ]
    
    combined = (ai_response + " " + user_message).lower()
    for keyword in important_keywords:
        if keyword in combined:
            memory.store_long_term(
                "conversation_highlight",
                "important_exchange",
                f"User: {user_message} | Riko: {ai_response[:200]}",
                importance=4
            )
            break


@app.post("/api/key")
async def set_api_key(request: ApiKeyRequest):
    """Set the Groq API key."""
    client = get_groq_client(request.api_key)
    if client:
        return {"status": "ok", "message": "API key set successfully!"}
    else:
        raise HTTPException(status_code=400, detail="Invalid API key")


@app.get("/api/memory")
async def get_memory():
    """Get conversation history and memories."""
    return {
        "short_term": memory.get_conversation_context(),
        "long_term": memory.get_long_term_memories(),
        "history": memory.get_all_history()
    }


@app.post("/api/memory/clear")
async def clear_memory():
    """Clear short-term memory."""
    memory.clear_short_term()
    return {"status": "ok", "message": "Short-term memory cleared"}


@app.post("/api/memory/clear-all")
async def clear_all_memory():
    """Clear all memory."""
    memory.clear_all()
    return {"status": "ok", "message": "All memory cleared"}


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    has_key = bool(os.getenv("GROQ_API_KEY") and os.getenv("GROQ_API_KEY") != "your_groq_api_key_here")
    return {
        "status": "online",
        "has_api_key": has_key,
        "timestamp": datetime.now().isoformat()
    }


# Serve static files
public_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
if os.path.exists(public_dir):
    app.mount("/public", StaticFiles(directory=public_dir), name="public")


@app.get("/")
async def root():
    """Serve the main HTML page."""
    index_path = os.path.join(public_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Riko AI Assistant API is running"}


@app.get("/{path:path}")
async def serve_static(path: str):
    """Serve static files."""
    file_path = os.path.join(public_dir, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")


if __name__ == "__main__":
    import uvicorn
    print("\n" + "="*60)
    print("  ✨ RIKO AI ASSISTANT - Starting Server...")
    print("  🌐 Open: http://localhost:8000")
    print("  📝 Hindi Speaking | VRM Avatar | Wake Word")
    print("="*60 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
