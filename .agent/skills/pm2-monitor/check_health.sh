#!/bin/bash
echo "--- Current PM2 Process Status ---"
pm2 jlist | jq '.[] | {name: .name, status: .pm2_env.status, restarts: .pm2_env.restart_time, memory: .monit.memory}'

echo "--- System Resources ---"
top -l 1 | grep "CPU usage"