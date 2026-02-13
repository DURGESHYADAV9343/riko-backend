"""
Jarvis Memory Manager - Long-term and Short-term memory using SQLite
"""
import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Optional

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jarvis_memory.db")

class MemoryManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.short_term: List[Dict] = []  # Last 20 messages
        self.max_short_term = 20
        self._init_db()
        self._load_short_term()

    def _init_db(self):
        """Initialize SQLite database with tables for long-term and short-term memory."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Short-term memory: recent conversation history
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS short_term_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        
        # Long-term memory: important facts, preferences, names
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS long_term_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                importance INTEGER DEFAULT 1
            )
        """)
        
        # Conversation summaries for context
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                summary TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        
        conn.commit()
        conn.close()

    def _load_short_term(self):
        """Load recent messages from DB into short-term memory."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT role, content, timestamp FROM short_term_memory ORDER BY id DESC LIMIT ?",
            (self.max_short_term,)
        )
        rows = cursor.fetchall()
        conn.close()
        self.short_term = [
            {"role": r[0], "content": r[1], "timestamp": r[2]}
            for r in reversed(rows)
        ]

    def add_message(self, role: str, content: str):
        """Add a message to short-term memory."""
        timestamp = datetime.now().isoformat()
        msg = {"role": role, "content": content, "timestamp": timestamp}
        
        # Add to in-memory list
        self.short_term.append(msg)
        if len(self.short_term) > self.max_short_term:
            self.short_term = self.short_term[-self.max_short_term:]
        
        # Save to DB
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO short_term_memory (role, content, timestamp) VALUES (?, ?, ?)",
            (role, content, timestamp)
        )
        conn.commit()
        conn.close()
        
        # Auto-detect important information from user messages
        if role == "user":
            self._extract_important_info(content)

    def _extract_important_info(self, content: str):
        """Detect and store important information from user messages."""
        content_lower = content.lower()
        
        # Detect name introductions (Hindi patterns)
        name_patterns = [
            "mera naam", "mera name", "my name is", "mai hu", "main hu",
            "मेरा नाम", "मैं हूं", "मैं हूँ", "i am", "i'm"
        ]
        for pattern in name_patterns:
            if pattern in content_lower:
                self.store_long_term("personal", "user_name_context", content, importance=5)
                break
        
        # Detect preferences
        pref_patterns = [
            "mujhe pasand", "i like", "i love", "i prefer", "i hate", "i don't like",
            "पसंद है", "अच्छा लगता", "पसंद नहीं", "favourite", "favorite"
        ]
        for pattern in pref_patterns:
            if pattern in content_lower:
                self.store_long_term("preference", "user_preference", content, importance=3)
                break
        
        # Detect facts/information the user shares
        fact_patterns = [
            "i work", "i study", "i live", "meri age", "meri umar",
            "मैं काम", "मैं पढ़", "मेरी उम्र", "i am a", "profession",
            "mere ghar", "mere paas", "मेरे पास", "मेरे घर"
        ]
        for pattern in fact_patterns:
            if pattern in content_lower:
                self.store_long_term("fact", "user_fact", content, importance=4)
                break

    def store_long_term(self, category: str, key: str, value: str, importance: int = 1):
        """Store information in long-term memory."""
        timestamp = datetime.now().isoformat()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO long_term_memory (category, key, value, timestamp, importance) VALUES (?, ?, ?, ?, ?)",
            (category, key, value, timestamp, importance)
        )
        conn.commit()
        conn.close()

    def get_long_term_memories(self, limit: int = 10) -> List[Dict]:
        """Retrieve most important long-term memories."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT category, key, value, timestamp, importance FROM long_term_memory ORDER BY importance DESC, id DESC LIMIT ?",
            (limit,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [
            {"category": r[0], "key": r[1], "value": r[2], "timestamp": r[3], "importance": r[4]}
            for r in rows
        ]

    def get_conversation_context(self) -> List[Dict]:
        """Get formatted conversation context for the AI."""
        return [
            {"role": msg["role"], "content": msg["content"]}
            for msg in self.short_term
        ]

    def get_memory_summary(self) -> str:
        """Generate a summary of all stored memories for context."""
        memories = self.get_long_term_memories(20)
        if not memories:
            return ""
        
        summary_parts = []
        for mem in memories:
            summary_parts.append(f"[{mem['category']}] {mem['value']}")
        
        return "\n".join(summary_parts)

    def save_summary(self, summary: str):
        """Save a conversation summary."""
        timestamp = datetime.now().isoformat()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO conversation_summaries (summary, timestamp) VALUES (?, ?)",
            (summary, timestamp)
        )
        conn.commit()
        conn.close()

    def clear_short_term(self):
        """Clear short-term memory."""
        self.short_term = []
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM short_term_memory")
        conn.commit()
        conn.close()

    def clear_all(self):
        """Clear all memory."""
        self.short_term = []
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM short_term_memory")
        cursor.execute("DELETE FROM long_term_memory")
        cursor.execute("DELETE FROM conversation_summaries")
        conn.commit()
        conn.close()

    def get_all_history(self) -> List[Dict]:
        """Get all conversation history for display."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT role, content, timestamp FROM short_term_memory ORDER BY id ASC"
        )
        rows = cursor.fetchall()
        conn.close()
        return [
            {"role": r[0], "content": r[1], "timestamp": r[2]}
            for r in rows
        ]
