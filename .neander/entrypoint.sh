#!/bin/sh
set -eu
exec node --import /app/.neander/load-environment.mjs "$@"
