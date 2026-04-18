/*
 * trie.cpp  —  Real-Time Autocomplete Engine (core DSA)
 *
 * Data structures
 * ───────────────
 *   Trie          prefix tree for O(L) insert / lookup
 *   top_k         min-heap DFS  →  O(N log K)  vs  O(N log N) sort
 *   LRUCache      doubly-linked list + unordered_map  →  O(1) get/put
 *
 * Compile & run
 * ─────────────
 *   g++ -std=c++17 -O2 -Wall -o trie trie.cpp && ./trie
 */

#include <iostream>
#include <unordered_map>
#include <vector>
#include <string>
#include <queue>          // priority_queue
#include <algorithm>      // transform, sort
#include <functional>     // greater<>
#include <memory>         // unique_ptr
#include <list>           // std::list for LRU doubly-linked list
#include <optional>
#include <cassert>

// ═══════════════════════════════════════════════════════════════
//  TrieNode
// ═══════════════════════════════════════════════════════════════

struct TrieNode {
    std::unordered_map<char, std::unique_ptr<TrieNode>> children;
    bool        is_end    = false;
    int         frequency = 0;
    int         max_freq  = 0;   // max frequency in subtree (for pruning)
    std::string word;            // full word stored at end-node
                                 // avoids reconstructing during DFS
};

// ═══════════════════════════════════════════════════════════════
//  LRU Cache
//  ───────────────────────────────────────────────────────────────
//  Key   : query prefix (string)
//  Value : top-K result vector
//
//  Internals
//  ─────────
//  A std::list<pair<key, value>> is the actual storage.
//  An unordered_map<key, list::iterator> gives O(1) access to
//  any node in the list so we can splice it to the front in O(1).
//
//  get  →  O(1)   (map lookup + splice)
//  put  →  O(1)   (map insert + splice + optional pop_back)
// ═══════════════════════════════════════════════════════════════

class LRUCache {
    using Value   = std::vector<std::string>;
    using KVPair  = std::pair<std::string, Value>;
    using ListIt  = std::list<KVPair>::iterator;

public:
    explicit LRUCache(int capacity = 1000) : capacity_(capacity) {}

    // Returns nullptr on miss.
    const Value* get(const std::string& key) {
        auto it = map_.find(key);
        if (it == map_.end()) return nullptr;

        // Move to front (most recently used).
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
            // Evict least recently used (back of list).
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

    int  size()     const { return (int)map_.size(); }
    bool empty()    const { return map_.empty(); }

private:
    int                                       capacity_;
    std::list<KVPair>                         list_;
    std::unordered_map<std::string, ListIt>   map_;
};

// ═══════════════════════════════════════════════════════════════
//  Trie
// ═══════════════════════════════════════════════════════════════

class Trie {
public:
    explicit Trie(int cache_capacity = 1000)
        : root_(std::make_unique<TrieNode>()),
          word_count_(0),
          cache_(cache_capacity)
    {}

    // ── insert ────────────────────────────────────────────────
    // Complexity: O(L)  L = word length

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

        // Invalidate cache entries that are prefixes of this word,
        // so stale results aren't served after a frequency change.
        invalidate_prefix_cache(lower);
    }

    // ── increment_frequency ───────────────────────────────────
    // Called when a user selects a suggestion.  O(L)

    bool increment_frequency(const std::string& word, int delta = 1) {
        TrieNode* node = find_node(to_lower(word));
        if (!node || !node->is_end) return false;

        node->frequency += delta;
        invalidate_prefix_cache(to_lower(word));
        return true;
    }

    // ── search / starts_with ──────────────────────────────────

    bool search(const std::string& word) const {
        const TrieNode* node = find_node(to_lower(word));
        return node && node->is_end;
    }

    bool starts_with(const std::string& prefix) const {
        return find_node(to_lower(prefix)) != nullptr;
    }

    // ── top_k ─────────────────────────────────────────────────
    //
    // Returns the K most frequent words that start with `prefix`.
    //
    // Algorithm
    // ─────────
    // 1. Walk Trie to prefix end-node.               O(L)
    // 2. DFS subtree with a MIN-heap of capacity K.
    //      heap stores  (frequency, word)
    //      min-heap  →  heap.top() is the LOWEST frequency so far
    //      When a new word arrives:
    //        - heap not full  →  push
    //        - heap full, new_freq > heap.top().freq  →  pop + push
    //    This keeps exactly K best candidates, never more.  O(N log K)
    // 3. Drain and sort heap descending.              O(K log K)
    //
    // Total: O(L + N log K)
    //
    // Checks LRU cache first.  On hit: O(1).  On miss: runs DFS.

    std::vector<std::string> top_k(const std::string& prefix_raw, int k = 10) {
        std::string prefix = to_lower(prefix_raw);
        if (prefix.empty()) return {};

        // ── cache hit ─────────────────────────────────────────
        if (const auto* cached = cache_.get(prefix))
            return *cached;

        // ── cache miss: run DFS ───────────────────────────────
        TrieNode* start = find_node(prefix);
        if (!start) return {};

        // Min-heap: smallest frequency at top.
        // pair<int, string> — default comparison on first element (freq).
        using FreqWord = std::pair<int, std::string>;
        std::priority_queue<
            FreqWord,
            std::vector<FreqWord>,
            std::greater<FreqWord>   // min-heap
        > heap;

        // DFS lambda (recursive via std::function for readability).
        std::function<void(TrieNode*)> dfs = [&](TrieNode* node) {
            if (node->is_end) {
                int freq = node->frequency;

                if ((int)heap.size() < k) {
                    heap.push({freq, node->word});
                } else if (freq > heap.top().first) {
                    heap.pop();
                    heap.push({freq, node->word});
                }
            }
            for (auto& [ch, child] : node->children)
                dfs(child.get());
        };

        dfs(start);

        // Drain heap and sort descending by frequency.
        std::vector<FreqWord> tmp;
        tmp.reserve(heap.size());
        while (!heap.empty()) {
            tmp.push_back(heap.top());
            heap.pop();
        }
        // Sort: highest frequency first; ties broken alphabetically.
        std::sort(tmp.begin(), tmp.end(), [](const FreqWord& a, const FreqWord& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
        });

        std::vector<std::string> result;
        result.reserve(tmp.size());
        for (auto& [freq, word] : tmp)
            result.push_back(word);

        // Write to cache.
        cache_.put(prefix, result);
        return result;
    }

    // ── top_k with subtree pruning ────────────────────────────
    //
    // Each node stores max_freq = max frequency in its subtree.
    // If the heap is full and a node's max_freq ≤ heap minimum,
    // the entire subtree is skipped — guaranteed to produce nothing
    // better than what we already have.
    //
    // Requires calling build_max_freq_cache() after bulk inserts.
    // Best case: O(L + K log K).  Worst case same as top_k.

    std::vector<std::string> top_k_pruned(const std::string& prefix_raw, int k = 10) {
        std::string prefix = to_lower(prefix_raw);
        if (prefix.empty()) return {};

        if (const auto* cached = cache_.get(prefix))
            return *cached;

        TrieNode* start = find_node(prefix);
        if (!start) return {};

        using FreqWord = std::pair<int, std::string>;
        std::priority_queue<FreqWord, std::vector<FreqWord>, std::greater<FreqWord>> heap;

        std::function<void(TrieNode*)> dfs = [&](TrieNode* node) {
            // Pruning: entire subtree cannot beat heap minimum.
            if ((int)heap.size() == k && node->max_freq <= heap.top().first)
                return;

            if (node->is_end) {
                int freq = node->frequency;
                if ((int)heap.size() < k)
                    heap.push({freq, node->word});
                else if (freq > heap.top().first) {
                    heap.pop();
                    heap.push({freq, node->word});
                }
            }
            for (auto& [ch, child] : node->children)
                dfs(child.get());
        };

        dfs(start);

        std::vector<FreqWord> tmp;
        while (!heap.empty()) { tmp.push_back(heap.top()); heap.pop(); }
        std::sort(tmp.begin(), tmp.end(), [](const FreqWord& a, const FreqWord& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
        });

        std::vector<std::string> result;
        for (auto& [f, w] : tmp) result.push_back(w);
        cache_.put(prefix, result);
        return result;
    }

    // ── build_max_freq_cache ──────────────────────────────────
    // Post-order DFS: annotate every node with the max frequency
    // in its subtree.  Call once after bulk inserts.  O(total nodes).

    void build_max_freq_cache() {
        build_max_freq(root_.get());
    }

    // ── delete ────────────────────────────────────────────────
    // Removes word and prunes orphaned nodes.  O(L)

    bool remove(const std::string& word_raw) {
        std::string word = to_lower(word_raw);
        // Walk the path, keeping a stack of (parent, char) to prune later.
        std::vector<std::pair<TrieNode*, char>> path;
        TrieNode* node = root_.get();

        for (char c : word) {
            if (!node->children.count(c)) return false;
            path.push_back({node, c});
            node = node->children[c].get();
        }

        if (!node->is_end) return false;

        node->is_end    = false;
        node->frequency = 0;
        node->word.clear();
        --word_count_;

        invalidate_prefix_cache(word);

        // Prune orphaned nodes walking back up the path.
        for (int i = (int)path.size() - 1; i >= 0; --i) {
            auto [parent, ch] = path[i];
            TrieNode* child   = parent->children[ch].get();
            if (!child->is_end && child->children.empty()) {
                parent->children.erase(ch);
            } else {
                break;
            }
        }
        return true;
    }

    // ── all_words ─────────────────────────────────────────────

    std::vector<std::string> all_words() const {
        std::vector<std::string> result;
        std::function<void(const TrieNode*)> dfs = [&](const TrieNode* node) {
            if (node->is_end) result.push_back(node->word);
            for (auto& [ch, child] : node->children) dfs(child.get());
        };
        dfs(root_.get());
        std::sort(result.begin(), result.end());
        return result;
    }

    int  size()                  const { return word_count_; }
    int  cache_size()            const { return cache_.size(); }
    bool contains(const std::string& w) const { return search(w); }

private:

    // ── helpers ───────────────────────────────────────────────

    static std::string to_lower(std::string s) {
        std::transform(s.begin(), s.end(), s.begin(), ::tolower);
        return s;
    }

    TrieNode* find_node(const std::string& prefix) const {
        TrieNode* node = root_.get();
        for (char c : prefix) {
            auto it = node->children.find(c);
            if (it == node->children.end()) return nullptr;
            node = it->second.get();
        }
        return node;
    }

    int build_max_freq(TrieNode* node) {
        int local_max = node->is_end ? node->frequency : 0;
        for (auto& [ch, child] : node->children)
            local_max = std::max(local_max, build_max_freq(child.get()));
        node->max_freq = local_max;
        return local_max;
    }

    // Invalidate all cache keys that are prefixes of `word`.
    void invalidate_prefix_cache(const std::string& word) {
        std::string prefix;
        for (char c : word) {
            prefix += c;
            cache_.invalidate(prefix);
        }
    }

    std::unique_ptr<TrieNode> root_;
    int                       word_count_;
    mutable LRUCache          cache_;
};

// ═══════════════════════════════════════════════════════════════
//  Levenshtein distance  (for typo tolerance)
// ═══════════════════════════════════════════════════════════════
//
//  Classic DP.  dp[i][j] = edit distance between s[0..i] and t[0..j].
//  Complexity: O(m × n) time, O(min(m, n)) space (rolling rows).

int levenshtein(const std::string& s, const std::string& t) {
    int m = (int)s.size(), n = (int)t.size();
    if (m < n) return levenshtein(t, s);     // ensure m >= n

    std::vector<int> prev(n + 1), curr(n + 1);
    for (int j = 0; j <= n; ++j) prev[j] = j;

    for (int i = 1; i <= m; ++i) {
        curr[0] = i;
        for (int j = 1; j <= n; ++j) {
            if (s[i-1] == t[j-1])
                curr[j] = prev[j-1];
            else
                curr[j] = 1 + std::min({prev[j-1],   // replace
                                         prev[j],      // delete
                                         curr[j-1]});  // insert
        }
        std::swap(prev, curr);
    }
    return prev[n];
}

// ═══════════════════════════════════════════════════════════════
//  Helper: print a result vector
// ═══════════════════════════════════════════════════════════════

void print_results(const std::string& prefix, const std::vector<std::string>& results) {
    std::cout << "top_k(\"" << prefix << "\"):\n";
    if (results.empty()) { std::cout << "  (no results)\n"; return; }
    for (int i = 0; i < (int)results.size(); ++i)
        std::cout << "  " << (i+1) << ". " << results[i] << "\n";
}

// ═══════════════════════════════════════════════════════════════
//  main  —  demo + assertions
// ═══════════════════════════════════════════════════════════════

int main() {
    Trie trie;

    // ── bulk insert ───────────────────────────────────────────
    std::vector<std::pair<std::string, int>> dataset = {
        {"apple",               120},
        {"application",         340},
        {"apply",                85},
        {"appetite",             42},
        {"appreciate",          210},
        {"approach",            175},
        {"april",                60},
        {"app",                 500},
        {"appetizer",            30},
        {"applicable",           95},
        {"machine",             300},
        {"machine learning",    890},
        {"machine translation", 410},
        {"map",                 230},
        {"maps",                195},
        {"matrix",              140},
    };

    for (auto& [word, freq] : dataset)
        trie.insert(word, freq);

    trie.build_max_freq_cache();

    std::cout << "Words loaded: " << trie.size() << "\n\n";

    // ── exact search ──────────────────────────────────────────
    std::cout << "search(\"apple\")   : " << std::boolalpha << trie.search("apple")    << "\n";
    std::cout << "search(\"ap\")      : " << trie.search("ap")        << "\n";
    std::cout << "starts_with(\"ap\") : " << trie.starts_with("ap")   << "\n\n";

    // ── top_k ─────────────────────────────────────────────────
    print_results("app", trie.top_k("app", 5));
    std::cout << "\n";
    print_results("ma", trie.top_k("ma", 5));
    std::cout << "\n";

    // ── cache hit ─────────────────────────────────────────────
    std::cout << "Cache size after 2 queries: " << trie.cache_size() << "\n";
    auto r1 = trie.top_k("app", 5);   // should hit cache now
    std::cout << "Second call top_k(\"app\") (cached): " << r1[0] << "\n\n";

    // ── frequency increment ───────────────────────────────────
    std::cout << "Incrementing \"apple\" frequency by 500...\n";
    trie.increment_frequency("apple", 500);
    print_results("app", trie.top_k("app", 3));
    std::cout << "\n";

    // ── pruned top_k ──────────────────────────────────────────
    trie.build_max_freq_cache();
    std::cout << "top_k_pruned(\"app\", 5):\n";
    for (auto& w : trie.top_k_pruned("app", 5))
        std::cout << "  " << w << "\n";
    std::cout << "\n";

    // ── delete ────────────────────────────────────────────────
    std::cout << "Deleting \"apply\"...\n";
    bool del = trie.remove("apply");
    std::cout << "remove(\"apply\")     : " << del                   << "\n";
    std::cout << "search(\"apply\")     : " << trie.search("apply")  << "\n";
    std::cout << "search(\"applicable\"): " << trie.search("applicable") << "\n\n";

    // ── levenshtein ───────────────────────────────────────────
    std::cout << "levenshtein(\"apple\", \"appel\")   = " << levenshtein("apple", "appel")   << "\n";
    std::cout << "levenshtein(\"machine\", \"machin\") = " << levenshtein("machine", "machin") << "\n";
    std::cout << "levenshtein(\"hello\", \"world\")   = " << levenshtein("hello", "world")   << "\n\n";

    // ── all words ─────────────────────────────────────────────
    std::cout << "All words in Trie:\n  ";
    for (auto& w : trie.all_words()) std::cout << w << "  ";
    std::cout << "\n\n";

    // ── assertions ────────────────────────────────────────────
    assert(trie.search("apple")       == true);
    assert(trie.search("apply")       == false);   // deleted
    assert(trie.search("applicable")  == true);
    assert(trie.starts_with("mac")    == true);
    assert(trie.starts_with("xyz")    == false);
    assert(trie.top_k("app", 1)[0]    == "apple");  // highest after +500
    assert(levenshtein("apple","apple") == 0);
    assert(levenshtein("","abc")        == 3);

    std::cout << "All assertions passed.\n";
    return 0;
}
