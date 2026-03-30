#!/bin/bash
# Notification hook: speaks when Claude needs user attention
SOCKET="/tmp/ralph-tts.sock"
[ ! -S "$SOCKET" ] && exit 0

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')
[ -z "$MESSAGE" ] && exit 0

python3 -c "
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('$SOCKET')
s.sendall(sys.stdin.buffer.read())
s.close()
" <<< "$MESSAGE" &
exit 0
