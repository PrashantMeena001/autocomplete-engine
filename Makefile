CXX      = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra

lib: libtrie.so

libtrie.so: trie_lib.cpp trie.hpp
	$(CXX) $(CXXFLAGS) -shared -fPIC -o libtrie.so trie_lib.cpp
	@echo "Built libtrie.so"

run: trie_demo
	./trie_demo

trie_demo: trie.cpp trie.hpp
	$(CXX) $(CXXFLAGS) -o trie_demo trie.cpp
	@echo "Built trie_demo"

test: lib
	pytest tests/ -v

install:
	pip install flask flask-limiter flask-cors --break-system-packages

clean:
	rm -f libtrie.so trie_demo *.o

.PHONY: lib run test install clean
