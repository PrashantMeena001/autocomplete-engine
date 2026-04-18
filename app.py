"""
app.py  —  Autocomplete Engine  |  Flask API
─────────────────────────────────────────────
Loads the compiled C++ Trie via ctypes and exposes two endpoints:

  GET  /suggest?q=<prefix>&k=<int>   → top-K suggestions
  POST /record                        → increment word frequency on selection

Architecture
────────────
  Python (Flask)
       │   ctypes
       ▼
  libtrie.so  (compiled C++ Trie + LRU cache)

ctypes lets Python call functions in a compiled .so directly —
no subprocess, no IPC, just a direct function call.  The overhead
over a native Python call is ~microseconds.

Run
───
  make lib                  # compile libtrie.so
  pip install flask flask-limiter flask-cors
  python app.py
"""

import ctypes
import json
import os
import time
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


# ─────────────────────────────────────────────────────────────
#  Load the shared library
# ─────────────────────────────────────────────────────────────

LIB_PATH = Path(__file__).parent / "libtrie.so"

if not LIB_PATH.exists():
    raise FileNotFoundError(
        f"libtrie.so not found at {LIB_PATH}\n"
        "Run:  make lib"
    )

_lib = ctypes.CDLL(str(LIB_PATH))


# ─────────────────────────────────────────────────────────────
#  ctypes function signatures
#
#  argtypes  — what Python types to pass in
#  restype   — what C type comes back
#
#  Getting these wrong causes segfaults, so we declare all of
#  them explicitly rather than relying on ctypes defaults.
# ─────────────────────────────────────────────────────────────

_lib.trie_create.argtypes            = [ctypes.c_int]
_lib.trie_create.restype             = ctypes.c_void_p

_lib.trie_destroy.argtypes           = [ctypes.c_void_p]
_lib.trie_destroy.restype            = None

_lib.trie_insert.argtypes            = [ctypes.c_void_p,
                                         ctypes.c_char_p,
                                         ctypes.c_int]
_lib.trie_insert.restype             = None

_lib.trie_search.argtypes            = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_search.restype             = ctypes.c_int

_lib.trie_starts_with.argtypes       = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_starts_with.restype        = ctypes.c_int

_lib.trie_increment_frequency.argtypes = [ctypes.c_void_p,
                                           ctypes.c_char_p,
                                           ctypes.c_int]
_lib.trie_increment_frequency.restype  = ctypes.c_int

_lib.trie_top_k.argtypes             = [ctypes.c_void_p,   # handle
                                         ctypes.c_char_p,   # prefix
                                         ctypes.c_int]      # k
_lib.trie_top_k.restype              = ctypes.c_void_p      # raw ptr — c_char_p would lose it

_lib.trie_free_result.argtypes       = [ctypes.c_void_p]
_lib.trie_free_result.restype        = None

_lib.trie_build_max_freq_cache.argtypes = [ctypes.c_void_p]
_lib.trie_build_max_freq_cache.restype  = None

_lib.trie_remove.argtypes            = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_remove.restype             = ctypes.c_int

_lib.trie_size.argtypes              = [ctypes.c_void_p]
_lib.trie_size.restype               = ctypes.c_int

_lib.trie_cache_size.argtypes        = [ctypes.c_void_p]
_lib.trie_cache_size.restype         = ctypes.c_int

_lib.trie_levenshtein.argtypes       = [ctypes.c_char_p, ctypes.c_char_p]
_lib.trie_levenshtein.restype        = ctypes.c_int


# ─────────────────────────────────────────────────────────────
#  Python wrapper class  (hides all ctypes details from Flask)
# ─────────────────────────────────────────────────────────────

class TrieEngine:
    """
    Thin Python wrapper around the C++ Trie shared library.
    All encoding/decoding of bytes ↔ str lives here so Flask
    never touches ctypes directly.
    """

    MAX_K = 20   # hard cap on suggestions per request

    def __init__(self, cache_capacity: int = 2000):
        self._handle = _lib.trie_create(cache_capacity)
        if not self._handle:
            raise RuntimeError("Failed to create Trie — out of memory?")
        self._word_count   = 0
        self._query_count  = 0
        self._cache_hits   = 0

    def __del__(self):
        if hasattr(self, "_handle") and self._handle:
            _lib.trie_destroy(self._handle)

    # ── insert ────────────────────────────────────────────────

    def insert(self, word: str, frequency: int = 1) -> None:
        _lib.trie_insert(self._handle,
                         word.encode("utf-8"),
                         ctypes.c_int(frequency))
        self._word_count += 1

    # ── top_k ─────────────────────────────────────────────────

    def top_k(self, prefix: str, k: int = 10) -> tuple[list[str], bool]:
        """Returns (suggestions, was_cached)."""
        k = min(k, self.MAX_K)
        cache_before = _lib.trie_cache_size(self._handle)

        raw = _lib.trie_top_k(
            self._handle,
            prefix.encode("utf-8"),
            ctypes.c_int(k)
        )

        results = []
        if raw:
            # c_void_p keeps the raw address alive so we can both
            # read the string AND free the pointer without ctypes
            # garbage-collecting it underneath us.
            decoded = ctypes.string_at(raw).decode("utf-8")
            results = [w for w in decoded.split("\n") if w]
            _lib.trie_free_result(raw)

        cache_after = _lib.trie_cache_size(self._handle)
        was_cached  = (cache_after == cache_before) and len(results) > 0

        self._query_count += 1
        if was_cached:
            self._cache_hits += 1

        return results, was_cached

    # ── fuzzy fallback ────────────────────────────────────────

    def fuzzy_top_k(self, prefix: str, k: int = 10,
                    max_distance: int = 2) -> list[str]:
        """
        If exact prefix returns nothing, try prefixes within
        edit distance max_distance of each character in the prefix.
        Simple approach: try dropping/replacing the last character.
        """
        results, _ = self.top_k(prefix, k)
        if results:
            return results

        # Try trimming last char, then last two chars.
        for trim in range(1, min(3, len(prefix))):
            shorter = prefix[:-trim]
            if shorter:
                results, _ = self.top_k(shorter, k)
                if results:
                    return results

        # Last resort: return words whose prefix has small edit distance.
        # (Full Levenshtein over the dataset would be O(N × L) — expensive.
        #  In production, use a BK-tree or a trigram index instead.)
        return []

    # ── record selection ──────────────────────────────────────

    def record_selection(self, word: str) -> bool:
        return bool(_lib.trie_increment_frequency(
            self._handle,
            word.encode("utf-8"),
            ctypes.c_int(1)
        ))

    # ── build pruning cache ───────────────────────────────────

    def build_max_freq_cache(self) -> None:
        _lib.trie_build_max_freq_cache(self._handle)

    # ── stats ─────────────────────────────────────────────────

    def stats(self) -> dict:
        hit_rate = (self._cache_hits / self._query_count
                    if self._query_count > 0 else 0.0)
        return {
            "word_count":   _lib.trie_size(self._handle),
            "cache_entries": _lib.trie_cache_size(self._handle),
            "total_queries": self._query_count,
            "cache_hits":    self._cache_hits,
            "hit_rate":      round(hit_rate, 3),
        }


# ─────────────────────────────────────────────────────────────
#  Seed data
# ─────────────────────────────────────────────────────────────

def load_dataset(engine: TrieEngine) -> int:
    """
    Load sample data.  In production replace this with:
      engine.insert(word, freq) for each line in your dataset file.

    Wikipedia titles (250k words) can be loaded from:
      https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-all-titles.gz
    """
    dataset = [
        # (word, frequency)
        ("machine learning",          890),
        ("machine translation",       410),
        ("machine",                   300),
        ("map",                       230),
        ("maps",                      195),
        ("matrix",                    140),
        ("app",                       500),
        ("application",               340),
        ("appreciate",                210),
        ("approach",                  175),
        ("apple",                     120),
        ("applicable",                 95),
        ("apply",                      85),
        ("april",                      60),
        ("appetite",                   42),
        ("appetizer",                  30),
        ("python",                    600),
        ("python programming",        450),
        ("pytorch",                   380),
        ("pandas",                    320),
        ("pathfinding",               150),
        ("pattern matching",          130),
        ("data structure",            700),
        ("data science",              680),
        ("database",                  540),
        ("dart",                      120),
        ("deep learning",             820),
        ("dijkstra",                  210),
        ("dynamic programming",       490),
        ("docker",                    460),
        ("graph",                     390),
        ("graph theory",              270),
        ("greedy algorithm",          230),
        ("garbage collection",        180),
        ("git",                       850),
        ("github",                    780),
        ("gradient descent",          340),
        ("neural network",            760),
        ("natural language processing", 640),
        ("numpy",                     580),
        ("node.js",                   420),
        ("binary search",             550),
        ("binary tree",               480),
        ("breadth first search",      370),
        ("blockchain",                310),
        ("recursion",                 430),
        ("red black tree",            190),
        ("rest api",                  620),
        ("react",                     710),
        ("redis",                     390),
        ("sorting algorithm",         510),
        ("stack overflow",            670),
        ("system design",             730),
        ("sql",                       690),
        ("trie",                      240),
        ("typescript",                480),
        ("transformer",               560),
    ]

    for word, freq in dataset:
        engine.insert(word, freq)

    engine.build_max_freq_cache()
    return len(dataset)


# ─────────────────────────────────────────────────────────────
#  Flask app
# ─────────────────────────────────────────────────────────────

app     = Flask(__name__)
CORS(app)   # allow React frontend on a different port

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per minute"],
)

# Global engine — initialised once at startup.
engine = TrieEngine(cache_capacity=2000)
words_loaded = load_dataset(engine)

print(f"Loaded {words_loaded} words into Trie.")


# ─────────────────────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────────────────────

@app.route("/suggest", methods=["GET"])
@limiter.limit("100 per minute")
def suggest():
    """
    GET /suggest?q=<prefix>&k=<int>&fuzzy=<0|1>

    Returns
    ───────
    {
      "suggestions": ["machine learning", "machine translation", ...],
      "query":       "mach",
      "k":           10,
      "cached":      true,
      "latency_ms":  0.8
    }
    """
    q     = request.args.get("q", "").strip()
    k     = int(request.args.get("k", 10))
    fuzzy = request.args.get("fuzzy", "0") == "1"

    if not q:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    if len(q) > 100:
        return jsonify({"error": "Query too long (max 100 chars)"}), 400

    k = max(1, min(k, TrieEngine.MAX_K))

    t0 = time.perf_counter()

    if fuzzy:
        suggestions = engine.fuzzy_top_k(q, k)
        cached      = False
    else:
        suggestions, cached = engine.top_k(q, k)

    latency_ms = round((time.perf_counter() - t0) * 1000, 3)

    return jsonify({
        "suggestions": suggestions,
        "query":       q,
        "k":           k,
        "cached":      cached,
        "latency_ms":  latency_ms,
    })


@app.route("/record", methods=["POST"])
@limiter.limit("60 per minute")
def record():
    """
    POST /record
    Body: { "word": "machine learning" }

    Increments the word's frequency in the Trie so it rises in future
    suggestions.  Automatically invalidates relevant cache entries.

    Returns
    ───────
    { "word": "machine learning", "success": true }
    """
    body = request.get_json(silent=True)

    if not body or "word" not in body:
        return jsonify({"error": "Body must contain 'word'"}), 400

    word    = body["word"].strip()
    success = engine.record_selection(word)

    # If word doesn't exist yet, insert it with frequency 1.
    if not success:
        engine.insert(word, 1)

    return jsonify({"word": word, "success": True})


@app.route("/stats", methods=["GET"])
def stats():
    """
    GET /stats

    Returns engine stats for the visualizer dashboard.
    {
      "word_count":    57,
      "cache_entries": 12,
      "total_queries": 304,
      "cache_hits":    227,
      "hit_rate":      0.747
    }
    """
    return jsonify(engine.stats())


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "words": engine.stats()["word_count"]})


# ─────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Starting Autocomplete API on http://localhost:5000")
    print("Endpoints:")
    print("  GET  /suggest?q=<prefix>&k=<int>&fuzzy=<0|1>")
    print("  POST /record    { word: string }")
    print("  GET  /stats")
    print("  GET  /health")
    app.run(debug=True, host="0.0.0.0", port=5000)
