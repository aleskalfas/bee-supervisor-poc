#!/bin/bash

# Default number of operators if not specified
OPERATORS_COUNT=${1:-2}

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "tmux is not installed. Please install it first."
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t agent_system 2>/dev/null

# Create logs directory if it doesn't exist
mkdir -p logs

# Start a new session
tmux new-session -d -s agent_system -n 'Agent System'

# First split horizontally at 66% for the top section
tmux split-window -v -p 34

# Now work on the top section (pane 0)
# Split top section vertically
tmux select-pane -t 0
tmux split-window -h -p 50

# Split top-left pane horizontally
tmux select-pane -t 0
tmux split-window -v -p 50

# Split top-right pane horizontally
tmux select-pane -t 2
tmux split-window -v -p 50

# Now we have our 2x2 grid in the top section:
# 0: Interactive (top-left)
# 1: Supervisor Log (bottom-left)
# 2: Agent Registry (top-right)
# 3: Task Manager (bottom-right)

# Configure the top section panes
tmux select-pane -t 0
tmux send-keys 'echo "🤖 Starting supervisor interaction..." && sleep 2 && NODE_ENV=development node start' C-m

tmux select-pane -t 1
tmux send-keys 'tail -f logs/supervisor_agents.log | pino-pretty' C-m

tmux select-pane -t 2
tmux send-keys 'tail -f logs/agent_registry.log | pino-pretty' C-m

tmux select-pane -t 3
tmux send-keys 'tail -f logs/task_manager.log | pino-pretty' C-m

# Now handle the bottom section for operators
# Split the bottom pane horizontally for each operator
tmux select-pane -t 4
for ((i=1; i<OPERATORS_COUNT; i++))
do
    tmux split-window -h -p $((100/(OPERATORS_COUNT-i)))
done

# Configure operator panes
for ((i=0; i<OPERATORS_COUNT; i++))
do
    tmux select-pane -t $((i + 4))
    tmux send-keys "tail -f logs/operator_$((i+1))_agents.log | pino-pretty" C-m
done

# Set up styling
tmux set-option -g status on
tmux set-option -g status-position top
tmux set-window-option -g window-status-current-style bg=red,fg=white

# Add pane borders with titles
tmux set-option -g pane-border-status top
tmux set-option -g pane-border-format "#{?pane_active,#[reverse],}#{pane_index}#[default] #{pane_title}"

# Set titles for each pane
tmux select-pane -t 0 -T "Interactive"
tmux select-pane -t 1 -T "Supervisor Log"
tmux select-pane -t 2 -T "Agent Registry"
tmux select-pane -t 3 -T "Task Manager"
for ((i=0; i<OPERATORS_COUNT; i++))
do
    tmux select-pane -t $((i + 4)) -T "Operator $((i+1))"
done

# Return to interactive pane
tmux select-pane -t 0

# Attach to the session
tmux attach-session -t agent_system