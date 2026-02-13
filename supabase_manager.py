import os
import time
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

class SupabaseManager:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL")
        self.key = os.getenv("SUPABASE_KEY")
        self.client: Client = None
        self.is_connected = False
        
        self._connect()

    def _connect(self):
        if not self.url or not self.key or "your_supabase_url" in self.url:
            print("⚠️ Supabase credentials missing. Using local memory only.")
            return

        try:
            self.client = create_client(self.url, self.key)
            self.is_connected = True
            print("✅ Connected to Supabase!")
        except Exception as e:
            print(f"❌ Supabase connection failed: {e}")
            self.is_connected = False

    def save_message(self, role, content, user_id=None):
        if not self.is_connected:
            return None

        try:
            data = {
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat()
            }
            if user_id:
                data["user_id"] = user_id
                
            self.client.table("messages").insert(data).execute()
        except Exception as e:
            print(f"⚠️ Failed to save to Supabase: {e}")

    def get_recent_messages(self, limit=10):
        if not self.is_connected:
            return []

        try:
            response = self.client.table("messages")\
                .select("*")\
                .order("timestamp", desc=True)\
                .limit(limit)\
                .execute()
            
            # Return in correct order (oldest first)
            return response.data[::-1] 
        except Exception as e:
            print(f"⚠️ Failed to fetch from Supabase: {e}")
            return []

# Singleton instance
supabase_manager = SupabaseManager()
