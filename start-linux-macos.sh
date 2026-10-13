#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
echo "Open http://127.0.0.1:3000"
exec npm start
