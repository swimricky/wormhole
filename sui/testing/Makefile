-include ../Makefile.help

.PHONY: clean
clean:
	rm -rf node_modules

node_modules:
	yarn

.PHONY: test
## Run tests
test: node_modules
	bash run_integration_test.sh
