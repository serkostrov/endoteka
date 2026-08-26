#!/bin/sh
set -eu

escape() {
  printf '%s' "$1" | awk 'BEGIN { ORS="" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\r/, "\\r"); gsub(/\n/, "\\n"); print }'
}

url=$(escape "${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}")
key=$(escape "${VITE_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}")

cat > /usr/share/nginx/html/env.js <<EOF
window.__ENDOTEKA_ENV__={VITE_SUPABASE_URL:"${url}",VITE_SUPABASE_ANON_KEY:"${key}"};
EOF
