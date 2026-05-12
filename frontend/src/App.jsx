/*
 * App.jsx  —  Real-Time Autocomplete Engine  |  Frontend
 */

import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// ══════════════════════════════════════════════════════════════
//  JS Trie  (visualization + offline fallback)
// ══════════════════════════════════════════════════════════════

class TNode {
  constructor() { this.ch = {}; this.end = false; this.freq = 0; this.word = null; }
}

class Trie {
  constructor() { this.root = new TNode(); }

  insert(word, freq = 1) {
    let n = this.root;
    for (const c of word.toLowerCase()) {
      if (!n.ch[c]) n.ch[c] = new TNode();
      n = n.ch[c];
    }
    n.end = true; n.freq = freq; n.word = word.toLowerCase();
  }

  _node(prefix) {
    let n = this.root;
    for (const c of prefix.toLowerCase()) {
      if (!n.ch[c]) return null;
      n = n.ch[c];
    }
    return n;
  }

  topK(prefix, k = 8) {
    const start = this._node(prefix);
    if (!start) return [];
    const all = [];
    const dfs = n => {
      if (n.end) all.push([n.freq, n.word]);
      for (const c of Object.values(n.ch)) dfs(c);
    };
    dfs(start);
    return all.sort((a, b) => b[0] - a[0]).slice(0, k).map(r => r[1]);
  }

  vizData(prefix) {
    prefix = prefix.toLowerCase().trim();
    if (!prefix) {
      const kids = Object.keys(this.root.ch).sort().slice(0, 16);
      return {
        id: "root", char: "⬤", inPath: true, isRoot: true,
        children: kids.map(c => ({ id: "r_" + c, char: c, inPath: false })),
      };
    }
    const path = [{ id: "root", char: "⬤", inPath: true, isRoot: true }];
    let node = this.root, valid = true;
    for (let i = 0; i < prefix.length; i++) {
      const c = prefix[i];
      if (!node.ch[c]) { valid = false; break; }
      node = node.ch[c];
      path.push({ id: `p${i}_${c}`, char: c, inPath: true, isEnd: node.end, freq: node.freq, word: node.word });
    }
    const buildChain = idx => {
      const obj = { ...path[idx] };
      if (idx < path.length - 1) {
        obj.children = [buildChain(idx + 1)];
      } else if (valid) {
        const childKeys = Object.keys(node.ch).sort().slice(0, 10);
        obj.children = childKeys.map(c => {
          const child = node.ch[c];
          const gcKeys = Object.keys(child.ch).sort().slice(0, 5);
          return {
            id: `c_${c}`, char: c, inPath: false, isEnd: child.end, freq: child.freq, word: child.word,
            children: gcKeys.map(gc => ({
              id: `gc_${c}${gc}`, char: gc, inPath: false,
              isEnd: child.ch[gc].end, freq: child.ch[gc].freq, word: child.ch[gc].word,
            })),
          };
        });
      } else {
        obj.children = []; obj.noMatch = true;
      }
      return obj;
    };
    return buildChain(0);
  }
}

const DATASET = [
  ["machine learning",890],["machine translation",410],["machine",300],
  ["map",230],["maps",195],["matrix",140],
  ["app",500],["application",340],["appreciate",210],["approach",175],
  ["apple",120],["applicable",95],["apply",85],["april",60],
  ["appetite",42],["appetizer",30],
  ["python",600],["python programming",450],["pytorch",380],
  ["pandas",320],["pathfinding",150],["pattern matching",130],
  ["data structure",700],["data science",680],["database",540],
  ["dart",120],["deep learning",820],["dijkstra",210],
  ["dynamic programming",490],["docker",460],
  ["graph",390],["graph theory",270],["greedy algorithm",230],
  ["garbage collection",180],["git",850],["github",780],["gradient descent",340],
  ["neural network",760],["natural language processing",640],
  ["numpy",580],["node.js",420],
  ["binary search",550],["binary tree",480],["breadth first search",370],["blockchain",310],
  ["recursion",430],["red black tree",190],["rest api",620],
  ["react",710],["redis",390],
  ["sorting algorithm",510],["stack overflow",670],["system design",730],["sql",690],
  ["trie",240],["typescript",480],["transformer",560],
  ["hash map",600],["heap",420],["huffman coding",180],
  ["linked list",530],["lru cache",310],["queue",380],["quicksort",290],
];

const LOCAL_TRIE = new Trie();
DATASET.forEach(([w, f]) => LOCAL_TRIE.insert(w, f));

// ══════════════════════════════════════════════════════════════
//  useDebounce
// ══════════════════════════════════════════════════════════════

function useDebounce(val, delay) {
  const [v, setV] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => setV(val), delay);
    return () => clearTimeout(t);
  }, [val, delay]);
  return v;
}

// ══════════════════════════════════════════════════════════════
//  TrieViz — D3 horizontal tree
// ══════════════════════════════════════════════════════════════

function TrieViz({ data, prefix }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !data) return;
    const W = 640, H = 340;
    const ml = 48, mr = 160, mt = 18, mb = 18;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Glow filter
    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "glow")
      .attr("x", "-40%").attr("y", "-40%").attr("width", "180%").attr("height", "180%");
    glow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3.5").attr("result", "blur");
    const mg = glow.append("feMerge");
    mg.append("feMergeNode").attr("in", "blur");
    mg.append("feMergeNode").attr("in", "SourceGraphic");

    const root = d3.hierarchy(data, d => (d.children?.length ? d.children : null));
    d3.tree().size([H - mt - mb, W - ml - mr])(root);

    const g = svg.append("g").attr("transform", `translate(${ml},${mt})`);

    // Links
    g.selectAll("path.lk")
      .data(root.links())
      .join("path")
      .attr("class", "lk")
      .attr("fill", "none")
      .attr("stroke", d => (d.source.data.inPath && d.target.data.inPath) ? "#00e676" : "#1c1c1c")
      .attr("stroke-width", d => (d.source.data.inPath && d.target.data.inPath) ? 2 : 1)
      .attr("stroke-opacity", d => d.target.data.inPath ? 1 : 0.55)
      .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    // Nodes
    const ng = g.selectAll("g.nd")
      .data(root.descendants())
      .join("g")
      .attr("class", "nd")
      .attr("transform", d => `translate(${d.y},${d.x})`);

    ng.append("circle")
      .attr("r", d => d.data.isRoot ? 11 : 8)
      .attr("fill", d => d.data.inPath ? "#00e676" : d.data.isEnd ? "#ffab40" : "#111")
      .attr("stroke", d => d.data.inPath ? "#00e676" : d.data.isEnd ? "#ffab40" : "#252525")
      .attr("stroke-width", 1.5)
      .style("filter", d => d.data.inPath ? "url(#glow)" : null)
      .attr("opacity", 0)
      .transition().duration(200).delay(d => d.data.inPath ? d.depth * 60 : 20)
      .attr("opacity", 1);

    // Char inside circle
    ng.filter(d => !d.data.isRoot)
      .append("text")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("font-family", "'Fira Code', monospace")
      .attr("font-size", "8px").attr("font-weight", "600")
      .attr("fill", d => d.data.inPath ? "#002209" : d.data.isEnd ? "#3a2000" : "#3a3a3a")
      .attr("pointer-events", "none")
      .text(d => d.data.char)
      .attr("opacity", 0)
      .transition().duration(200).delay(d => d.data.inPath ? d.depth * 60 : 20)
      .attr("opacity", 1);

    // Word label on end-node leaves
    ng.filter(d => d.data.isEnd && !d.children)
      .append("text")
      .attr("x", 13).attr("dy", "0.35em")
      .attr("font-family", "'Fira Code', monospace").attr("font-size", "9.5px")
      .attr("fill", "#ffab40").attr("pointer-events", "none")
      .text(d => { const w = d.data.word || ""; return w.length > 20 ? w.slice(0, 18) + "…" : w; })
      .attr("opacity", 0).transition().duration(280).delay(120).attr("opacity", 0.8);

    // Freq annotation
    ng.filter(d => d.data.isEnd && d.data.freq > 0 && !d.children)
      .append("text")
      .attr("x", 13).attr("dy", "1.6em")
      .attr("font-family", "'Fira Code', monospace").attr("font-size", "8px")
      .attr("fill", "#404040").attr("pointer-events", "none")
      .text(d => `freq=${d.data.freq}`)
      .attr("opacity", 0).transition().duration(280).delay(150).attr("opacity", 0.7);

    // No match label
    const noMatch = data.noMatch || (data.children?.length === 0 && prefix && !data.isEnd);
    if (noMatch) {
      g.append("text")
        .attr("x", (W - ml - mr) / 2).attr("y", (H - mt - mb) / 2)
        .attr("text-anchor", "middle")
        .attr("font-family", "'Fira Code', monospace").attr("font-size", "12px")
        .attr("fill", "#ff5252")
        .text(`no match for "${prefix}"`);
    }
  }, [data, prefix]);

  return <svg ref={svgRef} width="100%" viewBox="0 0 640 340" style={{ display: "block" }} />;
}

// ══════════════════════════════════════════════════════════════
//  StatCard (restyled for dashboard)
// ══════════════════════════════════════════════════════════════

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div className="metric-label">{label}</div>
      <div className={`metric-value${accent ? " accent" : ""}`}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  App
// ══════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  const [query,       setQuery]       = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selIdx,      setSelIdx]      = useState(-1);
  const [isOpen,      setIsOpen]      = useState(false);
  const [vizData,     setVizData]     = useState(() => LOCAL_TRIE.vizData(""));
  const [mode,        setMode]        = useState("local");
  const [stats,       setStats]       = useState({ latency: 0, cached: false, totalQueries: 0, cacheHits: 0 });

  const inputRef   = useRef(null);
  const debouncedQ = useDebounce(query, 260);

  // ── fetch suggestions + update viz ────────────────────────
  useEffect(() => {
    const q = debouncedQ.trim();
    setVizData(LOCAL_TRIE.vizData(q));
    if (!q) { setSuggestions([]); return; }

    const ctrl = new AbortController();
    const t0   = performance.now();

    fetch(`${API_BASE}/suggest?q=${encodeURIComponent(q)}&k=8`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        setSuggestions(data.suggestions || []);
        setIsOpen(true); setMode("api");
        setStats(prev => {
          const tq = prev.totalQueries + 1, ch = prev.cacheHits + (data.cached ? 1 : 0);
          return { latency: data.latency_ms, cached: data.cached, totalQueries: tq, cacheHits: ch };
        });
      })
      .catch(() => {
        const res = LOCAL_TRIE.topK(q, 8);
        const lat = +(performance.now() - t0).toFixed(2);
        setSuggestions(res); setIsOpen(res.length > 0); setMode("local");
        setStats(prev => ({ latency: lat, cached: false, totalQueries: prev.totalQueries + 1, cacheHits: prev.cacheHits }));
      });

    return () => ctrl.abort();
  }, [debouncedQ]);

  // ── keyboard nav ──────────────────────────────────────────
  const handleKeyDown = useCallback(e => {
    if (!isOpen || !suggestions.length) return;
    if (e.key === "ArrowDown")  { e.preventDefault(); setSelIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setSelIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter" && selIdx >= 0) { e.preventDefault(); selectWord(suggestions[selIdx]); }
    else if (e.key === "Escape") setIsOpen(false);
  }, [isOpen, suggestions, selIdx]);

  const selectWord = word => {
    setQuery(word); setIsOpen(false); setSelIdx(-1);
    fetch(`${API_BASE}/record`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
    }).catch(() => {});
  };

  const hitRate = stats.totalQueries > 0
    ? Math.round((stats.cacheHits / stats.totalQueries) * 100) : 0;

  // ══════════════════════════════════════════════════════════
  //  JSX — Premium Dashboard Layout
  // ══════════════════════════════════════════════════════════

  return (
    <div className="dashboard">

      {/* ── Header ────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="header-breadcrumb">◇ /engine</div>
          <h1 className="header-title">
            autocomplete<span className="accent">_</span>engine
          </h1>
          <p className="header-subtitle">A blazing fast, intelligent autocomplete system</p>
          <p className="header-tech">powered by Trie · Min-Heap · LRU Cache · Levenshtein</p>
        </div>
        <div className="header-right">
          <div className="status-badges">
            <span className="status-badge live">● LIVE ON VERCEL</span>
            <span className="status-badge">DATASET: {DATASET.length} WORDS</span>
            <span className="status-badge">STATUS: <span className="accent">ONLINE</span></span>
          </div>
          <div className="algo-tabs">
            <button className="algo-tab active"><span className="tab-icon">⊞</span> TRIE</button>
            <button className="algo-tab"><span className="tab-icon">▽</span> MIN-HEAP</button>
            <button className="algo-tab"><span className="tab-icon">⊡</span> LRU CACHE</button>
            <button className="algo-tab"><span className="tab-icon">≈</span> LEVENSHTEIN</button>
          </div>
        </div>
      </header>

      {/* ── Search Bar ────────────────────────────────────── */}
      <div className="search-container">
        <div className={`search-wrapper${query ? " active" : ""}`}>
          <span className="search-prompt">›</span>
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={e => {
              setQuery(e.target.value); setSelIdx(-1);
              if (e.target.value) setIsOpen(true);
              else { setIsOpen(false); setSuggestions([]); }
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length) setIsOpen(true); }}
            onBlur={() => setTimeout(() => setIsOpen(false), 160)}
            placeholder="type a prefix…"
            autoComplete="off" spellCheck={false}
          />
          {query && (
            <button
              className="search-clear"
              onMouseDown={e => { e.preventDefault(); setQuery(""); setSuggestions([]); setIsOpen(false); }}
            >×</button>
          )}
        </div>
      </div>

      {/* ── Content Grid ──────────────────────────────────── */}
      <div className="content-grid">

        {/* Left — Trie Panel */}
        <div className="trie-panel panel">
          <div className="panel-header">
            <span>
              TRIE TRAVERSAL {query && <>&nbsp;·&nbsp;PREFIX = &quot;{query}&quot;</>}
            </span>
            <div className="panel-legend">
              <span><span className="dot green">●</span> PATH</span>
              <span><span className="dot orange">●</span> WORD</span>
              <span><span className="dot gray">●</span> NODE</span>
            </div>
          </div>
          <div className="trie-viewport">
            <TrieViz data={vizData} prefix={debouncedQ} />
          </div>
          <div className="trie-controls">
            <button className="trie-ctrl">⚙</button>
            <button className="trie-ctrl">+</button>
            <button className="trie-ctrl">−</button>
            <button className="trie-ctrl">⛶</button>
          </div>
        </div>

        {/* Right — Panels */}
        <div className="right-panels">

          {/* Suggestions */}
          <div className="suggestions-panel panel">
            <div className="panel-header">
              <span>SUGGESTIONS · TOP-K (MIN-HEAP)</span>
              <span className="accent">{stats.latency > 0 ? `${stats.latency}ms` : ""}</span>
            </div>
            {suggestions.length > 0 ? (
              <div className="suggestions-list">
                {suggestions.map((s, i) => {
                  const ql = query.toLowerCase();
                  const sl = s.toLowerCase();
                  const ml2 = sl.startsWith(ql) ? query.length : 0;
                  const freq = DATASET.find(([w]) => w === s)?.[1] || "";
                  return (
                    <div
                      key={s}
                      className={`suggestion-item${i === selIdx ? " active" : ""}`}
                      onMouseDown={e => { e.preventDefault(); selectWord(s); }}
                      onMouseEnter={() => setSelIdx(i)}
                    >
                      <span>
                        <span className="suggestion-match">{s.slice(0, ml2)}</span>
                        <span className="suggestion-rest">{s.slice(ml2)}</span>
                      </span>
                      <span className="suggestion-freq">{freq}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="suggestions-empty">
                {query ? "no matches found" : "type to search…"}
              </div>
            )}
            <div className="suggestions-footer">
              ↑↓ navigate &nbsp;·&nbsp; enter select &nbsp;·&nbsp; esc close
            </div>
          </div>

          {/* HOW IT WORKS */}
          <div className="info-section panel">
            <div className="info-title">HOW IT WORKS</div>
            <div className="steps-grid">
              <div className="step-card">
                <div className="step-header">
                  <div className="step-number">1</div>
                  <div className="step-icon">↓</div>
                </div>
                <div className="step-name">Traverse Trie</div>
                <div className="step-desc">Walk the trie following the prefix O(L)</div>
              </div>
              <div className="step-card">
                <div className="step-header">
                  <div className="step-number">2</div>
                  <div className="step-icon">▼</div>
                </div>
                <div className="step-name">Collect Candidates</div>
                <div className="step-desc">Gather all words under the node O(N)</div>
              </div>
              <div className="step-card">
                <div className="step-header">
                  <div className="step-number">3</div>
                  <div className="step-icon">△</div>
                </div>
                <div className="step-name">Rank with Min-Heap</div>
                <div className="step-desc">Keep top-K results by score O(N log K)</div>
              </div>
              <div className="step-card">
                <div className="step-header">
                  <div className="step-number">4</div>
                  <div className="step-icon">◉</div>
                </div>
                <div className="step-name">Cache with LRU</div>
                <div className="step-desc">Store results for fast future access O(1)</div>
              </div>
            </div>
          </div>

          {/* ALGORITHM STACK */}
          <div className="info-section panel">
            <div className="info-title">ALGORITHM STACK</div>
            <div className="algo-stack-grid">
              <div className="algo-card">
                <div className="algo-card-icon">⊞</div>
                <div className="algo-card-name">Trie</div>
                <div className="algo-card-desc">Prefix tree for fast lookups</div>
              </div>
              <div className="algo-card">
                <div className="algo-card-icon">▽</div>
                <div className="algo-card-name">Min-Heap</div>
                <div className="algo-card-desc">Efficient top-k ranking</div>
              </div>
              <div className="algo-card">
                <div className="algo-card-icon">⊡</div>
                <div className="algo-card-name">LRU Cache</div>
                <div className="algo-card-desc">O(1) get/set operations</div>
              </div>
              <div className="algo-card">
                <div className="algo-card-icon">≈</div>
                <div className="algo-card-name">Levenshtein</div>
                <div className="algo-card-desc">Fuzzy matching &amp; corrections</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Execution Trace ───────────────────────────────── */}
      <div className="execution-trace">
        <div className="trace-label">EXECUTION TRACE</div>
        <div className="trace-content">
          {query
            ? <>walk O({query.length}) &nbsp;→&nbsp; heap top_k O(N log K) &nbsp;→&nbsp; lru O(1) on cache hit</>
            : <>insert O(L) &nbsp;·&nbsp; top_k O(N log K) &nbsp;·&nbsp; lru O(1) &nbsp;·&nbsp; levenshtein O(m×n)</>
          }
        </div>
        <span className={`trace-badge${stats.cached ? " active" : ""}`}>
          ✦ CACHE HIT
        </span>
      </div>

      {/* ── Metrics ───────────────────────────────────────── */}
      <div className="metrics-grid">
        <StatCard icon="⏱" label="LATENCY" value={`${stats.latency}ms`} sub="avg response time" accent />
        <StatCard icon="⊡" label="CACHE" value={stats.cached ? "YES" : "NO"} sub="lru cache enabled" accent={stats.cached} />
        <StatCard icon="↗" label="HIT RATE" value={`${hitRate}%`} sub="cache effectiveness" accent={hitRate > 50} />
        <StatCard icon="›_" label="QUERIES" value={stats.totalQueries} sub="requests made" />
        <StatCard icon="Aa" label="WORDS" value={DATASET.length} sub="indexed words" />
        <StatCard icon="⚡" label="MODE" value={mode === "api" ? "LIVE" : "LOCAL"} sub={mode === "api" ? "using vercel 🔺" : "client-side"} accent={mode === "api"} />
      </div>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="footer">
        Built with <span className="heart">♥</span> for developers · made by <span className="accent">Prashant</span>
      </footer>
    </div>
  );
}
