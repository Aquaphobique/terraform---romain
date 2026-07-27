# ======== REPRODUCTIBILITY AND HARDENING =========
SHELL := /bin/bash
SHELLFLAGS := -eu -o pipefail -c
# ======== COLOR ANSI =============
INFO_COLOR := \033[36;1m
WARNING_COLOR := \033[33;1m
ERROR_COLOR := \033[31;1m
RESET_COLOR := \033[0m


.PHONY: help
help: ##show this help
	@grep -E "^[a-z0-9A-Z._-]+:.*?$$" $(MAKEFILE_LIST) |\
	sort | awk 'BEGIN {FS=":.*?##"} {printf "$(INFO_COLOR)%s$(RESET_COLOR)%s\n", $$1, $$2}'

ansible: ##show ansible version
	@ansible --version
terraform: ##shows terraform version
	@terraform -V