#!/bin/bash

set -a
source "$(dirname "$0")/.env"
set +a

for arg in "$@"; do
    if [ "$arg" = "--dev" ] || [ "$arg" = "-d" ]; then
        export DEV_MODE=1
        break
    fi
done

python src/main.py "$@"
