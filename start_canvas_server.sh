#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "Script directory: $SCRIPT_DIR" >&2

# Print startup message (directed to stderr so it doesn't interfere with JSON)
echo "Starting Canvas MCP Server..." >&2

# Load environment variables from .env file
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading environment variables from .env file: $ENV_FILE" >&2
    # KEY=VALUE lines only, exported verbatim: no word splitting or globbing of
    # secret values (the old `export $(… | xargs)` split and expanded them),
    # and never `source`, which would execute whatever the file contains.
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in ''|'#'*) continue ;; esac
        line="${line#export }"
        key="${line%%=*}"
        value="${line#*=}"
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        [ "$key" = "$line" ] && continue
        if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
            value="${BASH_REMATCH[1]}"
        fi
        export "$key=$value"
    done < "$ENV_FILE"
else
    echo "Error: .env file not found at $ENV_FILE. Please create one with CANVAS_API_TOKEN and CANVAS_API_URL" >&2
    exit 1
fi

# Verify required environment variables are set
if [ -z "$CANVAS_API_TOKEN" ] || [ -z "$CANVAS_API_URL" ]; then
    echo "Error: CANVAS_API_TOKEN and CANVAS_API_URL must be set in .env file" >&2
    exit 1
fi

# Go to the script directory
cd "$SCRIPT_DIR"
echo "Changed directory to: $(pwd)" >&2

# Run the server using the repo-local venv if present (preferred)
VENV_SERVER="$SCRIPT_DIR/.venv/bin/canvas-mcp-server"
if [ -x "$VENV_SERVER" ]; then
    echo "Starting server with $VENV_SERVER ..." >&2
    "$VENV_SERVER"
else
    echo "Starting server with canvas-mcp-server from PATH..." >&2
    canvas-mcp-server
fi

# Exit message
echo "Server stopped" >&2