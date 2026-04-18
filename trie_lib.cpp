/*
 * trie_lib.cpp  —  C-compatible API wrapper around the C++ Trie
 *
 * Why extern "C"?
 * ───────────────
 * C++ mangles function names (e.g. insert becomes _Z6insertPKci) so
 * Python ctypes can't find them by their plain names.  extern "C" tells
 * the compiler to use C linkage — no mangling — so ctypes can load them
 * by their exact names: "trie_insert", "trie_top_k", etc.
 *
 * Compile to shared library:
 *   g++ -std=c++17 -O2 -shared -fPIC -o libtrie.so trie_lib.cpp
 *
 * The -fPIC flag (Position Independent Code) is required for shared
 * libraries — the code must work regardless of where it's loaded in memory.
 */

#include "trie.hpp"
#include <cstring>    // strncpy
#include <cstdlib>    // malloc / free

// ─────────────────────────────────────────────────────────────
//  Opaque handle
//
//  Python only sees a void* pointer to the Trie object.
//  It can't inspect or modify the internals — it just passes
//  the handle back on every call. This is the standard pattern
//  for exposing C++ objects through a C API.
// ─────────────────────────────────────────────────────────────

extern "C" {

// ── lifecycle ────────────────────────────────────────────────

void* trie_create(int cache_capacity) {
    return new Trie(cache_capacity);
}

void trie_destroy(void* handle) {
    delete static_cast<Trie*>(handle);
}

// ── insert ────────────────────────────────────────────────────

void trie_insert(void* handle, const char* word, int frequency) {
    static_cast<Trie*>(handle)->insert(word, frequency);
}

// ── search ────────────────────────────────────────────────────

int trie_search(void* handle, const char* word) {
    return static_cast<Trie*>(handle)->search(word) ? 1 : 0;
}

int trie_starts_with(void* handle, const char* prefix) {
    return static_cast<Trie*>(handle)->starts_with(prefix) ? 1 : 0;
}

// ── increment_frequency ───────────────────────────────────────

int trie_increment_frequency(void* handle, const char* word, int delta) {
    return static_cast<Trie*>(handle)->increment_frequency(word, delta) ? 1 : 0;
}

// ── top_k ─────────────────────────────────────────────────────
//
// Returns results as a single heap-allocated string with words
// separated by newlines: "machine learning\nmachine\nmap\n"
//
// Python decodes and splits on '\n' — zero pointer arithmetic,
// one free() call via trie_free_result().

char* trie_top_k(void* handle, const char* prefix, int k) {
    auto results = static_cast<Trie*>(handle)->top_k(prefix, k);

    std::string joined;
    for (auto& w : results) { joined += w; joined += '\n'; }
    return strdup(joined.c_str());   // Python calls trie_free_result()
}

void trie_free_result(char* s) {
    free(s);
}

// ── build_max_freq_cache ──────────────────────────────────────

void trie_build_max_freq_cache(void* handle) {
    static_cast<Trie*>(handle)->build_max_freq_cache();
}

// ── remove ────────────────────────────────────────────────────

int trie_remove(void* handle, const char* word) {
    return static_cast<Trie*>(handle)->remove(word) ? 1 : 0;
}

// ── stats ─────────────────────────────────────────────────────

int trie_size(void* handle) {
    return static_cast<Trie*>(handle)->size();
}

int trie_cache_size(void* handle) {
    return static_cast<Trie*>(handle)->cache_size();
}

// ── levenshtein (standalone, no handle needed) ────────────────

int trie_levenshtein(const char* s, const char* t) {
    return levenshtein(std::string(s), std::string(t));
}

}  // extern "C"
