#pragma once

/*
 * trie.hpp  —  TrieNode, LRUCache, Trie, levenshtein
 *
 * Identical logic to trie.cpp, refactored into a header so that:
 *   - trie_lib.cpp  can wrap it with an extern "C" C API
 *   - main.cpp      can use it directly for CLI benchmarks
 */

#include <unordered_map>
#include <vector>
#include <string>
#include <queue>
#include <algorithm>
#include <functional>
#include <memory>
#include <list>
#include <optional>

// ─────────────────────────────────────────────────────────────
//  TrieNode
// ─────────────────────────────────────────────────────────────

struct TrieNode {
    std::unordered_map<char, std::unique_ptr<TrieNode>> children;
    bool        is_end    = false;
    int         frequency = 0;
    int         max_freq  = 0;
    std::string word;
};

// ─────────────────────────────────────────────────────────────
//  LRUCache   O(1) get / put / invalidate
// ─────────────────────────────────────────────────────────────

class LRUCache {
    using Value  = std::vector<std::string>;
    using KVPair = std::pair<std::string, Value>;
    using ListIt = std::list<KVPair>::iterator;

public:
    explicit LRUCache(int capacity = 1000) : capacity_(capacity) {}

    const Value* get(const std::string& key) {
        auto it = map_.find(key);
        if (it == map_.end()) return nullptr;
        list_.splice(list_.begin(), list_, it->second);
        return &it->second->second;
    }

    void put(const std::string& key, Value value) {
        auto it = map_.find(key);
        if (it != map_.end()) {
            it->second->second = std::move(value);
            list_.splice(list_.begin(), list_, it->second);
            return;
        }
        list_.emplace_front(key, std::move(value));
        map_[key] = list_.begin();
        if ((int)map_.size() > capacity_) {
            map_.erase(list_.back().first);
            list_.pop_back();
        }
    }

    void invalidate(const std::string& key) {
        auto it = map_.find(key);
        if (it != map_.end()) {
            list_.erase(it->second);
            map_.erase(it);
        }
    }

    int  size()  const { return (int)map_.size(); }
    void clear()       { list_.clear(); map_.clear(); }

private:
    int                                     capacity_;
    std::list<KVPair>                       list_;
    std::unordered_map<std::string,ListIt>  map_;
};

// ─────────────────────────────────────────────────────────────
//  Trie
// ─────────────────────────────────────────────────────────────

class Trie {
public:
    explicit Trie(int cache_capacity = 1000)
        : root_(std::make_unique<TrieNode>()),
          word_count_(0),
          cache_(cache_capacity) {}

    // ── insert  O(L) ─────────────────────────────────────────

    void insert(const std::string& word, int frequency = 1) {
        if (word.empty()) return;
        std::string lower = to_lower(word);
        TrieNode* node    = root_.get();
        for (char c : lower) {
            if (!node->children.count(c))
                node->children[c] = std::make_unique<TrieNode>();
            node = node->children[c].get();
        }
        if (!node->is_end) ++word_count_;
        node->is_end    = true;
        node->frequency = frequency;
        node->word      = lower;
        invalidate_prefix_cache(lower);
    }

    // ── increment  O(L) ──────────────────────────────────────

    bool increment_frequency(const std::string& word, int delta = 1) {
        TrieNode* node = find_node(to_lower(word));
        if (!node || !node->is_end) return false;
        node->frequency += delta;
        invalidate_prefix_cache(to_lower(word));
        return true;
    }

    // ── search / starts_with  O(L) ───────────────────────────

    bool search(const std::string& word) const {
        const TrieNode* n = find_node(to_lower(word));
        return n && n->is_end;
    }

    bool starts_with(const std::string& prefix) const {
        return find_node(to_lower(prefix)) != nullptr;
    }

    // ── top_k  O(L + N log K) ────────────────────────────────

    std::vector<std::string> top_k(const std::string& prefix_raw, int k = 10) {
        std::string prefix = to_lower(prefix_raw);
        if (prefix.empty()) return {};

        if (const auto* cached = cache_.get(prefix)) return *cached;

        TrieNode* start = find_node(prefix);
        if (!start) return {};

        using FW = std::pair<int, std::string>;
        std::priority_queue<FW, std::vector<FW>, std::greater<FW>> heap;

        std::function<void(TrieNode*)> dfs = [&](TrieNode* node) {
            if (node->is_end) {
                if ((int)heap.size() < k)
                    heap.push({node->frequency, node->word});
                else if (node->frequency > heap.top().first) {
                    heap.pop();
                    heap.push({node->frequency, node->word});
                }
            }
            for (auto& [ch, child] : node->children) dfs(child.get());
        };
        dfs(start);

        std::vector<FW> tmp;
        while (!heap.empty()) { tmp.push_back(heap.top()); heap.pop(); }
        std::sort(tmp.begin(), tmp.end(), [](const FW& a, const FW& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
        });

        std::vector<std::string> result;
        for (auto& [f, w] : tmp) result.push_back(w);
        cache_.put(prefix, result);
        return result;
    }

    // ── build_max_freq_cache  O(N) ───────────────────────────

    void build_max_freq_cache() { build_max_freq(root_.get()); }

    // ── remove  O(L) ─────────────────────────────────────────

    bool remove(const std::string& word_raw) {
        std::string word = to_lower(word_raw);
        std::vector<std::pair<TrieNode*, char>> path;
        TrieNode* node = root_.get();
        for (char c : word) {
            if (!node->children.count(c)) return false;
            path.push_back({node, c});
            node = node->children[c].get();
        }
        if (!node->is_end) return false;
        node->is_end = false; node->frequency = 0; node->word.clear();
        --word_count_;
        invalidate_prefix_cache(word);
        for (int i = (int)path.size() - 1; i >= 0; --i) {
            auto [parent, ch] = path[i];
            TrieNode* child   = parent->children[ch].get();
            if (!child->is_end && child->children.empty())
                parent->children.erase(ch);
            else break;
        }
        return true;
    }

    int  size()       const { return word_count_; }
    int  cache_size() const { return cache_.size(); }

private:
    static std::string to_lower(std::string s) {
        std::transform(s.begin(), s.end(), s.begin(), ::tolower);
        return s;
    }

    TrieNode* find_node(const std::string& p) const {
        TrieNode* node = root_.get();
        for (char c : p) {
            auto it = node->children.find(c);
            if (it == node->children.end()) return nullptr;
            node = it->second.get();
        }
        return node;
    }

    int build_max_freq(TrieNode* node) {
        int m = node->is_end ? node->frequency : 0;
        for (auto& [ch, child] : node->children)
            m = std::max(m, build_max_freq(child.get()));
        node->max_freq = m;
        return m;
    }

    void invalidate_prefix_cache(const std::string& word) {
        std::string p;
        for (char c : word) { p += c; cache_.invalidate(p); }
    }

    std::unique_ptr<TrieNode> root_;
    int                       word_count_;
    mutable LRUCache          cache_;
};

// ─────────────────────────────────────────────────────────────
//  Levenshtein distance  O(m × n) time, O(min(m,n)) space
// ─────────────────────────────────────────────────────────────

inline int levenshtein(const std::string& s, const std::string& t) {
    int m = (int)s.size(), n = (int)t.size();
    if (m < n) return levenshtein(t, s);
    std::vector<int> prev(n + 1), curr(n + 1);
    for (int j = 0; j <= n; ++j) prev[j] = j;
    for (int i = 1; i <= m; ++i) {
        curr[0] = i;
        for (int j = 1; j <= n; ++j) {
            curr[j] = (s[i-1] == t[j-1])
                ? prev[j-1]
                : 1 + std::min({prev[j-1], prev[j], curr[j-1]});
        }
        std::swap(prev, curr);
    }
    return prev[n];
}
