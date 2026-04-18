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
//  StatCard
// ══════════════════════════════════════════════════════════════

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 8,
      padding: "10px 16px", minWidth: 110,
    }}>
      <div style={{ fontSize: 9, color: "#333", fontFamily: "'Fira Code', monospace",
        letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, fontFamily: "'Fira Code', monospace",
        color: accent ? "#00e676" : "#b8b8b8" }}>
        {value}
      </div>
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

  return (
    <div style={{ background: "#080808", minHeight: "100vh", color: "#c8c8c8",
      fontFamily: "'Fira Code', monospace", padding: "28px 24px 36px" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: #252525; }
        input:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e1e1e; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 26, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 21, fontWeight: 600, color: "#e8e8e8", letterSpacing: "-0.02em", margin: 0 }}>
          autocomplete<span style={{ color: "#00e676" }}>_</span>engine
        </h1>
        <span style={{
          fontSize: 9, padding: "3px 10px", borderRadius: 20, letterSpacing: "0.1em",
          border: "1px solid", borderColor: mode === "api" ? "#00e676" : "#1e1e1e",
          color: mode === "api" ? "#00e676" : "#2e2e2e",
        }}>
          {mode === "api" ? "● live api" : "○ local demo"}
        </span>
        <span style={{ fontSize: 9, color: "#1e1e1e", marginLeft: "auto", letterSpacing: "0.06em" }}>
          trie · min-heap · lru cache · levenshtein
        </span>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 24, maxWidth: 580 }}>
        <div style={{
          display: "flex", alignItems: "center",
          border: "1px solid", borderColor: query ? "#00e676" : "#1a1a1a",
          borderRadius: 6, background: "#0a0a0a",
          transition: "border-color 0.18s",
        }}>
          <span style={{ padding: "0 14px", color: "#00e676", fontSize: 15, userSelect: "none", opacity: 0.8 }}>›</span>
          <input
            ref={inputRef}
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
            style={{
              flex: 1, background: "transparent", border: "none",
              padding: "13px 0", fontSize: 15, color: "#e0e0e0",
              fontFamily: "'Fira Code', monospace", caretColor: "#00e676",
            }}
          />
          {query && (
            <button
              onMouseDown={e => { e.preventDefault(); setQuery(""); setSuggestions([]); setIsOpen(false); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#2a2a2a", padding: "0 14px", fontSize: 18 }}
            >×</button>
          )}
        </div>

        {/* Dropdown */}
        {isOpen && suggestions.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 5px)", left: 0, right: 0,
            background: "#0a0a0a", border: "1px solid #181818",
            borderRadius: 6, zIndex: 100, boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "6px 16px 5px", fontSize: 9, color: "#252525",
              letterSpacing: "0.1em", borderBottom: "1px solid #111",
              display: "flex", justifyContent: "space-between",
            }}>
              <span>SUGGESTIONS · top-K min-heap</span>
              <span style={{ color: stats.cached ? "#00e676" : "#252525" }}>
                {stats.latency}ms {stats.cached ? "· cached ✓" : ""}
              </span>
            </div>
            {suggestions.map((s, i) => {
              const ql = query.toLowerCase();
              const sl = s.toLowerCase();
              const ml2 = sl.startsWith(ql) ? query.length : 0;
              const freq = DATASET.find(([w]) => w === s)?.[1] || "";
              return (
                <div
                  key={s}
                  onMouseDown={e => { e.preventDefault(); selectWord(s); }}
                  onMouseEnter={() => setSelIdx(i)}
                  style={{
                    padding: "9px 16px", cursor: "pointer", fontSize: 13,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: i === selIdx ? "#0e1f14" : "transparent",
                    borderLeft: `2px solid ${i === selIdx ? "#00e676" : "transparent"}`,
                    transition: "background 0.07s",
                  }}
                >
                  <span>
                    <span style={{ color: "#00e676" }}>{s.slice(0, ml2)}</span>
                    <span style={{ color: "#484848" }}>{s.slice(ml2)}</span>
                  </span>
                  <span style={{ fontSize: 9, color: "#2a2a2a", marginLeft: 12 }}>{freq}</span>
                </div>
              );
            })}
            <div style={{ padding: "5px 16px", fontSize: 9, color: "#1e1e1e", borderTop: "1px solid #0f0f0f" }}>
              ↑↓ navigate · enter select · esc close
            </div>
          </div>
        )}
      </div>

      {/* Trie panel */}
      <div style={{ border: "1px solid #131313", borderRadius: 8, marginBottom: 14, overflow: "hidden" }}>
        <div style={{
          padding: "7px 16px", borderBottom: "1px solid #0f0f0f",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 9, color: "#282828", letterSpacing: "0.1em" }}>
            TRIE TRAVERSAL  {query && `· prefix="${query}"`}
          </span>
          <div style={{ display: "flex", gap: 14, fontSize: 9, color: "#252525" }}>
            <span><span style={{ color: "#00e676" }}>●</span> path</span>
            <span><span style={{ color: "#ffab40" }}>●</span> word</span>
            <span><span style={{ color: "#1e1e1e" }}>●</span> node</span>
          </div>
        </div>
        <TrieViz data={vizData} prefix={debouncedQ} />
        <div style={{ padding: "5px 16px 9px", borderTop: "1px solid #0e0e0e",
          fontSize: 9, color: "#202020", letterSpacing: "0.04em" }}>
          {query
            ? `walk O(${query.length}) → heap top_k O(N log K) → lru O(1) on cache hit`
            : "insert O(L)  ·  top_k O(N log K)  ·  lru O(1)  ·  levenshtein O(m×n)"}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="latency"        value={`${stats.latency}ms`} />
        <StatCard label="cached"         value={stats.cached ? "yes" : "no"} accent={stats.cached} />
        <StatCard label="hit rate"       value={`${hitRate}%`} accent={hitRate > 50} />
        <StatCard label="queries"        value={stats.totalQueries} />
        <StatCard label="words"          value={DATASET.length} />
        <StatCard label="mode"           value={mode} accent={mode === "api"} />
      </div>
    </div>
  );
}
