// extern "C" wrapper exposing the C++ Trie as a shared library (libtrie.so).
// Python loads this via ctypes. Compile: g++ -std=c++17 -O2 -shared -fPIC -o libtrie.so trie_lib.cpp

#include "trie.hpp"
#include <cstring>
#include <cstdlib>

extern "C" {

void* trie_create(int cache_capacity) {
    return new Trie(cache_capacity);
}

void trie_destroy(void* handle) {
    delete static_cast<Trie*>(handle);
}

void trie_insert(void* handle, const char* word, int frequency) {
    static_cast<Trie*>(handle)->insert(word, frequency);
}

int trie_search(void* handle, const char* word) {
    return static_cast<Trie*>(handle)->search(word) ? 1 : 0;
}

int trie_starts_with(void* handle, const char* prefix) {
    return static_cast<Trie*>(handle)->starts_with(prefix) ? 1 : 0;
}

int trie_increment_frequency(void* handle, const char* word, int delta) {
    return static_cast<Trie*>(handle)->increment_frequency(word, delta) ? 1 : 0;
}

// Returns results as a newline-separated string. Caller must free with trie_free_result().
char* trie_top_k(void* handle, const char* prefix, int k) {
    auto results = static_cast<Trie*>(handle)->top_k(prefix, k);

    std::string joined;
    for (auto& w : results) { joined += w; joined += '\n'; }
    return strdup(joined.c_str());
}

void trie_free_result(char* s) {
    free(s);
}

void trie_build_max_freq_cache(void* handle) {
    static_cast<Trie*>(handle)->build_max_freq_cache();
}

int trie_remove(void* handle, const char* word) {
    return static_cast<Trie*>(handle)->remove(word) ? 1 : 0;
}

int trie_size(void* handle) {
    return static_cast<Trie*>(handle)->size();
}

int trie_cache_size(void* handle) {
    return static_cast<Trie*>(handle)->cache_size();
}

int trie_levenshtein(const char* s, const char* t) {
    return levenshtein(std::string(s), std::string(t));
}

}  // extern "C"
