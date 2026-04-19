# Real-Time Autocomplete Engine

![CI](https://github.com/YOUR_USERNAME/autocomplete-engine/actions/workflows/ci.yml/badge.svg)
![C++17](https://img.shields.io/badge/C++-17-blue?logo=cplusplus)
![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)

> A production-grade autocomplete engine built from scratch —
> custom Trie, min-heap top-K retrieval, LRU cache, fuzzy matching,
> and an animated D3 Trie visualizer.

<!-- REPLACE THIS with your screen recording GIF -->
<!-- Record: open the app, type "machine learning" slowly, let the Trie animate -->
<!-- Tools: Loom, ScreenToGif, or macOS Screenshot → Record Selected Portion -->

**[Live Demo →](https://prashantmeena001.github.io/autocomplete-engine/)**

---

## Why this project

Autocomplete is one of the most common interview topics.
Most implementations stop at "insert and search."
This one goes further — every design decision has a measurable, provable reason.

| Feature | Implementation | Complexity |
|---|---|---|
| Prefix search | Compressed Trie | O(L) |
| Top-K suggestions | Min-heap during DFS | O(N log K) vs O(N log N) sort |
| Repeated query caching | Hand-rolled LRU | O(1) get/put |
| Typo tolerance | Levenshtein distance ≤ 2 | O(m × n) |
| Self-improving ranking | Freq increment on selection | O(L) |
| Trie traversal visualizer | D3 animated tree | — |

---

## Architecture

```
User types "appl"
      │
      ▼
React (debounced 300ms)
      │
      ▼
GET /suggest?q=appl&k=10          ← Flask app.py
      │
      ▼
LRU Cache hit? ──yes──▶ return cached  (O(1), ~0.9ms)
      │ no
      ▼
C++ Trie.top_k("appl", 10)        ← libtrie.so via ctypes
      │  O(L) walk + O(N log K) heap DFS
      ▼
Fuzzy match if 0 results          ← Levenshtein distance
      │
      ▼
Write to LRU Cache → return JSON
```

**Language split:** DSA core in C++ (compiled to `libtrie.so`), API in Python (Flask),
frontend in React + D3. Python calls C++ directly via `ctypes` — no subprocess, no IPC.

---

## Data structures

### TrieNode
```cpp
struct TrieNode {
    unordered_map<char, unique_ptr<TrieNode>> children;
    bool        is_end    = false;
    int         frequency = 0;   // search frequency
    int         max_freq  = 0;   // max in subtree (pruning)
    string      word;            // stored at end-node (avoids reconstruction)
};
```

### Min-heap top-K  (the key insight)
```cpp
// Naive: collect all N words → sort → slice  =  O(N log N)
// Smart: min-heap of size K during DFS       =  O(N log K)
// For K=10, N=10,000: log(10)=3.3 vs log(10000)=13.3 → 4× fewer comparisons

priority_queue<pair<int,string>,
               vector<pair<int,string>>,
               greater<pair<int,string>>> heap;  // min-heap

// If heap not full → push
// If new word beats heap minimum → pop + push
// Result: exactly K best candidates, never more
```

### LRU Cache  (hand-rolled, O(1))
```cpp
// doubly-linked list (std::list) + hash map (unordered_map)
// map stores iterators → splice() moves any node to front in O(1)
// Invalidation: increment_frequency("apple") busts
//   "a", "ap", "app", "appl", "apple" from cache
```

---

## Benchmarks

| Test | Result |
|---|---|
| Heap top-K vs sort-all (N=1k, K=10) | **4–6× faster** |
| LRU cache hit vs cold DFS | **~20× faster** |
| Trie vs sorted list memory | 3× more RAM, pays for O(L) lookup |
| Trie vs binary search at N=500 | Trie faster, advantage grows with N |

See [`notebooks/trie_analysis.ipynb`](notebooks/trie_analysis.ipynb) for full benchmark
analysis with plots.

---

## Run locally

```bash
# 1. Build the C++ shared library
make lib                          # compiles libtrie.so

# 2. Install Python deps + run tests
pip install pytest flask flask-limiter flask-cors
pytest tests/ -v                  # 46 tests, all pass in < 1s

# 3. Start the API
python app.py                     # http://localhost:5000

# 4. Start the frontend (separate terminal)
cd frontend
npm install && npm run dev        # http://localhost:5173
```

Test endpoints:
```bash
curl "localhost:5000/suggest?q=mach&k=5"
curl "localhost:5000/suggest?q=mach&k=5&fuzzy=1"
curl -X POST localhost:5000/record \
     -H "Content-Type: application/json" \
     -d '{"word": "machine learning"}'
curl "localhost:5000/stats"
```

---

## Project structure

```
autocomplete-engine/
├── .github/workflows/ci.yml      CI: build + 46 tests + lint on every push
├── frontend/
│   ├── src/App.jsx               React + D3 animated Trie visualizer
│   ├── src/main.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json               Vercel deploy config
├── notebooks/
│   └── trie_analysis.ipynb       6 benchmarks: heap vs sort, LRU, memory, scaling
├── tests/
│   └── test_trie.py              46 tests across 6 classes
├── trie.hpp                      TrieNode, Trie, LRUCache, Levenshtein
├── trie_lib.cpp                  extern "C" wrapper → libtrie.so
├── trie.cpp                      Standalone C++ CLI demo
├── app.py                        Flask API (ctypes bridge to C++)
├── Makefile                      make lib / make run / make test / make install
├── render.yaml                   Render (backend) deploy config
└── requirements.txt              Python dependencies
```

---

## DSA concepts covered

- Trie (prefix tree) construction and traversal
- Min-heap for O(N log K) top-K selection
- LRU cache with O(1) eviction (doubly-linked list + hash map)
- Levenshtein edit distance for fuzzy matching
- Debouncing and async API calls in React
- `extern "C"` FFI bridge between C++ and Python
- REST API design with Flask

---

## What I'd add with more time

- [ ] **Bloom filter** — O(1) space-efficient existence check before Trie traversal
- [ ] **Consistent hashing** — shard the Trie across 26 servers by first letter
- [ ] **Redis** — shared LRU cache for horizontal scaling across instances
- [ ] **BK-tree / trigram index** — O(log N) fuzzy matching instead of O(N·L) brute-force
- [ ] **Phonetic matching** (Soundex) — find words that sound like the query

---

## Deploy

**Backend → Render** (free tier):
Connect repo → New → Blueprint → Render reads `render.yaml` automatically.

**Frontend → Vercel** (free):
Connect repo → New Project → root dir = `frontend/` →
add env var `VITE_API_URL=https://your-render-url.onrender.com`.

---

*Built with C++17 · Python 3.11 · React 18 · D3 v7*
