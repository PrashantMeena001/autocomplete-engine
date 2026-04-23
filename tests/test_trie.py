"""
tests/test_trie.py  —  Autocomplete Engine test suite

Tests the Python ctypes wrapper around libtrie.so.
Run with:  pytest tests/ -v

CI runs these on every push via .github/workflows/ci.yml.
"""

import ctypes
import os
import pathlib
import sys
import pytest

# ─────────────────────────────────────────────────────────────
#  Locate and load the shared library
#
#  CI builds it fresh before running tests (see ci.yml).
#  Locally:  make lib  then  pytest tests/
# ─────────────────────────────────────────────────────────────

LIB_PATH = pathlib.Path(__file__).parent.parent / "libtrie.so"

if not LIB_PATH.exists():
    pytest.exit(
        f"libtrie.so not found at {LIB_PATH}.\n" "Run 'make lib' first.",
        returncode=1,
    )

_lib = ctypes.CDLL(str(LIB_PATH))

# ── ctypes signatures ─────────────────────────────────────────

_lib.trie_create.argtypes = [ctypes.c_int]
_lib.trie_create.restype = ctypes.c_void_p

_lib.trie_destroy.argtypes = [ctypes.c_void_p]
_lib.trie_destroy.restype = None

_lib.trie_insert.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
_lib.trie_insert.restype = None

_lib.trie_search.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_search.restype = ctypes.c_int

_lib.trie_starts_with.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_starts_with.restype = ctypes.c_int

_lib.trie_top_k.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
_lib.trie_top_k.restype = ctypes.c_void_p

_lib.trie_free_result.argtypes = [ctypes.c_void_p]
_lib.trie_free_result.restype = None

_lib.trie_increment_frequency.argtypes = [
    ctypes.c_void_p,
    ctypes.c_char_p,
    ctypes.c_int,
]
_lib.trie_increment_frequency.restype = ctypes.c_int

_lib.trie_remove.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
_lib.trie_remove.restype = ctypes.c_int

_lib.trie_size.argtypes = [ctypes.c_void_p]
_lib.trie_size.restype = ctypes.c_int

_lib.trie_cache_size.argtypes = [ctypes.c_void_p]
_lib.trie_cache_size.restype = ctypes.c_int

_lib.trie_build_max_freq_cache.argtypes = [ctypes.c_void_p]
_lib.trie_build_max_freq_cache.restype = None

_lib.trie_levenshtein.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
_lib.trie_levenshtein.restype = ctypes.c_int

# ─────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────


def _top_k(handle, prefix: str, k: int = 10) -> list[str]:
    raw = _lib.trie_top_k(handle, prefix.encode(), ctypes.c_int(k))
    if not raw:
        return []
    results = [r for r in ctypes.string_at(raw).decode().split("\n") if r]
    _lib.trie_free_result(raw)
    return results


# ─────────────────────────────────────────────────────────────
#  Fixtures
# ─────────────────────────────────────────────────────────────


@pytest.fixture
def trie():
    """Fresh Trie for each test — created and destroyed cleanly."""
    handle = _lib.trie_create(500)
    yield handle
    _lib.trie_destroy(handle)


@pytest.fixture
def loaded_trie():
    """Trie pre-loaded with a standard dataset."""
    handle = _lib.trie_create(500)
    words = [
        ("apple", 120),
        ("application", 340),
        ("apply", 85),
        ("appetite", 42),
        ("appreciate", 210),
        ("approach", 175),
        ("april", 60),
        ("app", 500),
        ("machine learning", 890),
        ("machine translation", 410),
        ("machine", 300),
        ("map", 230),
        ("maps", 195),
    ]
    for word, freq in words:
        _lib.trie_insert(handle, word.encode(), ctypes.c_int(freq))
    _lib.trie_build_max_freq_cache(handle)
    yield handle
    _lib.trie_destroy(handle)


# ─────────────────────────────────────────────────────────────
#  Test: insert + search
# ─────────────────────────────────────────────────────────────


class TestInsertSearch:

    def test_search_existing_word(self, loaded_trie):
        assert _lib.trie_search(loaded_trie, b"apple") == 1

    def test_search_missing_word(self, loaded_trie):
        assert _lib.trie_search(loaded_trie, b"xyz") == 0

    def test_prefix_is_not_word(self, loaded_trie):
        # "ap" is a prefix but not an inserted word
        assert _lib.trie_search(loaded_trie, b"ap") == 0

    def test_starts_with_valid_prefix(self, loaded_trie):
        assert _lib.trie_starts_with(loaded_trie, b"app") == 1

    def test_starts_with_missing_prefix(self, loaded_trie):
        assert _lib.trie_starts_with(loaded_trie, b"xyz") == 0

    def test_case_insensitive_insert(self, trie):
        _lib.trie_insert(trie, b"APPLE", ctypes.c_int(10))
        assert _lib.trie_search(trie, b"apple") == 1
        assert _lib.trie_search(trie, b"APPLE") == 1

    def test_empty_word_ignored(self, trie):
        _lib.trie_insert(trie, b"", ctypes.c_int(1))
        assert _lib.trie_size(trie) == 0

    def test_word_count_accurate(self, loaded_trie):
        assert _lib.trie_size(loaded_trie) == 13

    def test_single_char_word(self, trie):
        _lib.trie_insert(trie, b"a", ctypes.c_int(5))
        assert _lib.trie_search(trie, b"a") == 1
        assert _lib.trie_size(trie) == 1

    def test_multiword_phrase(self, loaded_trie):
        assert _lib.trie_search(loaded_trie, b"machine learning") == 1


# ─────────────────────────────────────────────────────────────
#  Test: top_k
# ─────────────────────────────────────────────────────────────


class TestTopK:

    def test_returns_correct_count(self, loaded_trie):
        results = _top_k(loaded_trie, "app", 5)
        assert len(results) == 5

    def test_sorted_by_frequency_descending(self, loaded_trie):
        results = _top_k(loaded_trie, "app", 5)
        # "app" has freq=500, should be first
        assert results[0] == "app"

    def test_prefix_filters_correctly(self, loaded_trie):
        results = _top_k(loaded_trie, "ma", 10)
        assert all(w.startswith("ma") for w in results)

    def test_empty_prefix_returns_empty(self, loaded_trie):
        results = _top_k(loaded_trie, "", 5)
        assert results == []

    def test_no_match_returns_empty(self, loaded_trie):
        results = _top_k(loaded_trie, "xyz", 5)
        assert results == []

    def test_k_larger_than_matches(self, loaded_trie):
        # Only 3 words start with "ma" (machine, map, maps, machine learning, machine translation)
        results = _top_k(loaded_trie, "ma", 100)
        assert len(results) == 5  # all of them, no crash

    def test_k_equals_one(self, loaded_trie):
        results = _top_k(loaded_trie, "app", 1)
        assert len(results) == 1
        assert results[0] == "app"  # highest frequency

    def test_exact_word_match_in_results(self, loaded_trie):
        results = _top_k(loaded_trie, "apple", 5)
        assert "apple" in results

    def test_all_results_start_with_prefix(self, loaded_trie):
        prefix = "app"
        results = _top_k(loaded_trie, prefix, 10)
        for word in results:
            assert word.startswith(prefix), f"'{word}' doesn't start with '{prefix}'"


# ─────────────────────────────────────────────────────────────
#  Test: LRU cache
# ─────────────────────────────────────────────────────────────


class TestLRUCache:

    def test_cache_populated_after_query(self, loaded_trie):
        before = _lib.trie_cache_size(loaded_trie)
        _top_k(loaded_trie, "app", 5)
        after = _lib.trie_cache_size(loaded_trie)
        assert after == before + 1

    def test_repeated_query_hits_cache(self, loaded_trie):
        _top_k(loaded_trie, "app", 5)
        size_before = _lib.trie_cache_size(loaded_trie)
        _top_k(loaded_trie, "app", 5)  # second call — should hit cache
        size_after = _lib.trie_cache_size(loaded_trie)
        assert size_after == size_before  # no new entry = cache hit

    def test_cache_invalidated_after_frequency_update(self, loaded_trie):
        _top_k(loaded_trie, "app", 5)
        size_before = _lib.trie_cache_size(loaded_trie)
        # incrementing "apple" should bust "a", "ap", "app", "appl", "apple"
        _lib.trie_increment_frequency(loaded_trie, b"apple", ctypes.c_int(1))
        size_after = _lib.trie_cache_size(loaded_trie)
        assert size_after < size_before

    def test_cache_respects_capacity(self):
        """A cache with capacity=2 should never exceed 2 entries."""
        handle = _lib.trie_create(2)  # tiny cache
        words = [("alpha", 1), ("beta", 2), ("gamma", 3), ("delta", 4)]
        for w, f in words:
            _lib.trie_insert(handle, w.encode(), ctypes.c_int(f))
        for prefix in ["a", "b", "g", "d", "al", "be"]:
            _top_k(handle, prefix, 3)
        assert _lib.trie_cache_size(handle) <= 2
        _lib.trie_destroy(handle)


# ─────────────────────────────────────────────────────────────
#  Test: frequency + ranking
# ─────────────────────────────────────────────────────────────


class TestFrequency:

    def test_increment_changes_ranking(self, loaded_trie):
        before = _top_k(loaded_trie, "app", 3)
        assert before[0] == "app"  # app(500) > application(340)

        # boost apple way above app
        _lib.trie_increment_frequency(loaded_trie, b"apple", ctypes.c_int(10000))
        after = _top_k(loaded_trie, "app", 3)
        assert after[0] == "apple"

    def test_increment_nonexistent_word_returns_false(self, loaded_trie):
        result = _lib.trie_increment_frequency(
            loaded_trie, b"notaword", ctypes.c_int(1)
        )
        assert result == 0

    def test_increment_existing_word_returns_true(self, loaded_trie):
        result = _lib.trie_increment_frequency(loaded_trie, b"apple", ctypes.c_int(1))
        assert result == 1


# ─────────────────────────────────────────────────────────────
#  Test: delete / remove
# ─────────────────────────────────────────────────────────────


class TestDelete:

    def test_remove_existing_word(self, loaded_trie):
        assert _lib.trie_remove(loaded_trie, b"apply") == 1
        assert _lib.trie_search(loaded_trie, b"apply") == 0

    def test_remove_reduces_word_count(self, loaded_trie):
        before = _lib.trie_size(loaded_trie)
        _lib.trie_remove(loaded_trie, b"apply")
        assert _lib.trie_size(loaded_trie) == before - 1

    def test_remove_preserves_prefix_sibling(self, loaded_trie):
        # removing "apply" should NOT remove "application" or "apple"
        _lib.trie_remove(loaded_trie, b"apply")
        assert _lib.trie_search(loaded_trie, b"application") == 1
        assert _lib.trie_search(loaded_trie, b"apple") == 1

    def test_remove_nonexistent_returns_false(self, loaded_trie):
        assert _lib.trie_remove(loaded_trie, b"notaword") == 0

    def test_removed_word_absent_from_top_k(self, loaded_trie):
        _lib.trie_remove(loaded_trie, b"apply")
        results = _top_k(loaded_trie, "appl", 10)
        assert "apply" not in results

    def test_double_remove_returns_false(self, loaded_trie):
        _lib.trie_remove(loaded_trie, b"apply")
        assert _lib.trie_remove(loaded_trie, b"apply") == 0


# ─────────────────────────────────────────────────────────────
#  Test: Levenshtein distance
# ─────────────────────────────────────────────────────────────


class TestLevenshtein:

    def test_identical_strings(self):
        assert _lib.trie_levenshtein(b"apple", b"apple") == 0

    def test_one_substitution(self):
        assert _lib.trie_levenshtein(b"apple", b"applo") == 1

    def test_one_deletion(self):
        assert _lib.trie_levenshtein(b"apple", b"appl") == 1

    def test_one_insertion(self):
        assert _lib.trie_levenshtein(b"appl", b"apple") == 1

    def test_transposition(self):
        # appel vs apple: 2 ops (not a transposition in standard Levenshtein)
        assert _lib.trie_levenshtein(b"appel", b"apple") == 2

    def test_completely_different(self):
        assert _lib.trie_levenshtein(b"hello", b"world") == 4

    def test_empty_string(self):
        assert _lib.trie_levenshtein(b"", b"abc") == 3

    def test_both_empty(self):
        assert _lib.trie_levenshtein(b"", b"") == 0

    def test_symmetric(self):
        a, b = b"kitten", b"sitting"
        assert _lib.trie_levenshtein(a, b) == _lib.trie_levenshtein(b, a)


# ─────────────────────────────────────────────────────────────
#  Test: edge cases
# ─────────────────────────────────────────────────────────────


class TestEdgeCases:

    def test_single_character_prefix(self, loaded_trie):
        results = _top_k(loaded_trie, "a", 5)
        assert all(w.startswith("a") for w in results)

    def test_full_word_as_prefix(self, loaded_trie):
        # "apple" as prefix should return "apple" itself
        results = _top_k(loaded_trie, "apple", 5)
        assert "apple" in results

    def test_large_k_never_crashes(self, loaded_trie):
        results = _top_k(loaded_trie, "a", 10000)
        assert isinstance(results, list)

    def test_insert_same_word_twice(self, trie):
        _lib.trie_insert(trie, b"apple", ctypes.c_int(10))
        _lib.trie_insert(trie, b"apple", ctypes.c_int(99))
        # second insert overwrites frequency, count stays 1
        assert _lib.trie_size(trie) == 1

    def test_multiword_prefix_search(self, loaded_trie):
        results = _top_k(loaded_trie, "machine", 5)
        assert "machine" in results
        assert "machine learning" in results
