# ─────────────────────────────────────────────────────────────
#  Makefile  —  Autocomplete Engine
# ─────────────────────────────────────────────────────────────
#
#  Targets
#  ───────
#    make lib        Build libtrie.so  (used by Flask)
#    make run        Build & run the standalone C++ demo
#    make test       Run Python tests against the .so
#    make install    pip-install Python dependencies
#    make clean      Remove build artifacts
#
#  Usage
#  ─────
#    make lib && make install && python app.py
# ─────────────────────────────────────────────────────────────

CXX      = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra

# ── shared library (Flask uses this) ─────────────────────────

lib: libtrie.so

libtrie.so: trie_lib.cpp trie.hpp
	$(CXX) $(CXXFLAGS) -shared -fPIC -o libtrie.so trie_lib.cpp
	@echo "Built libtrie.so"

# ── standalone C++ demo ───────────────────────────────────────

run: trie_demo
	./trie_demo

trie_demo: trie.cpp trie.hpp
	$(CXX) $(CXXFLAGS) -o trie_demo trie.cpp
	@echo "Built trie_demo"

# ── Python dependencies ───────────────────────────────────────

install:
	pip install flask flask-limiter flask-cors --break-system-packages

# ── clean ─────────────────────────────────────────────────────

clean:
	rm -f libtrie.so trie_demo *.o

.PHONY: lib run install clean
